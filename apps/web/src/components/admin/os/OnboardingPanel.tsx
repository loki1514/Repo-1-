"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleDot,
  History,
  ListChecks,
  LoaderCircle,
  MapPin,
  Plus,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { Activity, Handoff, Requirement, WorkItem } from "@/lib/os/kernel";
import {
  addEvidenceAction,
  completeWorkAction,
  createLocationAction,
  decideRequirementAction,
} from "@/app/admin/organizations/[id]/os-actions";
import type { RequirementDisposition, RequirementStatus } from "@/lib/os/kernel";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

const STAGES = [
  "new_handoff",
  "contacted",
  "requirements_in_progress",
  "requirements_confirmed",
  "ready_for_demo",
  "demo_done",
  "training",
  "active",
] as const;

const STAGE_LABEL: Record<string, string> = {
  new_handoff: "New handoff",
  assigned: "Assigned",
  contacted: "Contacted",
  information_pending: "Info pending",
  requirements_in_progress: "Requirements",
  requirements_confirmed: "Confirmed",
  preparation: "Preparation",
  ready_for_demo: "Demo ready",
  demo_done: "Demo done",
  training: "Training",
  ready_for_go_live: "Go-live ready",
  active: "Active",
};

const EVIDENCE_PROMPT: Record<string, string> = {
  verification: "Who did you speak to, and what did you confirm?",
  demo_scheduled: "When is the demo, and who is attending?",
  demo_feedback: "What did the customer actually say during the demo?",
  training: "Who was trained, and on which screens?",
  readiness: "Data isolation, audit trail, GST fields — what did you check?",
};

const TEAM_LABEL: Record<string, string> = {
  sales: "Sales",
  onboarding: "Onboarding",
  customer_success: "Customer Success",
  operations: "Operations",
  platform: "Platform",
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dueLabel(iso: string | null): { text: string; late: boolean } {
  if (!iso) return { text: "", late: false };
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (ms < 0) return { text: `${Math.abs(days)}d overdue`, late: true };
  return { text: days === 0 ? "due today" : `due in ${days}d`, late: false };
}

export function OnboardingPanel({
  organizationId,
  stage,
  work,
  requirements,
  handoffs,
  activities,
  locations,
  evidenceNeeded,
  evidenceHave,
}: {
  organizationId: string;
  stage: string | null;
  work: WorkItem[];
  requirements: Requirement[];
  handoffs: Handoff[];
  activities: Activity[];
  locations: { id: string; name: string; kind: string; city: string | null; franchisee_name: string | null }[];
  /** work item id -> the evidence kind it still expects, from the orchestrator. */
  evidenceNeeded: Record<string, string | null>;
  /** work item ids that already have their evidence. */
  evidenceHave: string[];
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [cascade, setCascade] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [evidenceText, setEvidenceText] = useState("");
  const [locName, setLocName] = useState("");
  const [locKind, setLocKind] = useState("outlet");
  const [locCity, setLocCity] = useState("");
  const [locFranchisee, setLocFranchisee] = useState("");
  const [reqNote, setReqNote] = useState<Record<string, string>>({});

  async function run(key: string, fn: () => Promise<{ ok: boolean; cascade?: string[]; error?: string }>) {
    haptic("medium");
    setPending(key);
    setError(null);
    setCascade(null);
    const res = await fn();
    setPending(null);
    if (!res.ok) { setError(res.error ?? "Something went wrong."); return false; }
    haptic("success");
    setCascade(res.cascade ?? []);
    return true;
  }

  if (!stage) {
    return (
      <div className="glass rounded-[var(--r-xl)] p-5">
        <div className="relative z-10">
          <h2 className="t-h3">Onboarding</h2>
          <p className="mt-2 text-[14px] text-muted">
            This organization was created before the OS kernel existed, so it has no onboarding
            chain attached. Organizations converted from a won deal start one automatically.
          </p>
        </div>
      </div>
    );
  }

  const open = work.filter((w) => w.status !== "done" && w.status !== "cancelled");
  const done = work.filter((w) => w.status === "done");
  const stageIndex = STAGES.indexOf(stage as (typeof STAGES)[number]);

  async function complete(id: string) {
    haptic("medium");
    setPending(id);
    setError(null);
    setCascade(null);
    const res = await completeWorkAction(id, organizationId);
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    haptic("success");
    setCascade(res.cascade);
  }

  return (
    <div className="glass rounded-[var(--r-xl)] p-5">
      <div className="relative z-10 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="t-h3">Onboarding</h2>
          <span className="rounded-full bg-[rgb(180_238_42_/_0.18)] px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[var(--lime-deep)]">
            {STAGE_LABEL[stage] ?? stage}
          </span>
        </div>

        {/* the chain, as a rail */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGES.map((s, i) => (
            <span
              key={s}
              className={cn(
                "rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                i < stageIndex && "bg-[rgb(79_191_106_/_0.16)] text-[var(--ok)]",
                i === stageIndex && "bg-[var(--ink)] text-[var(--paper)]",
                i > stageIndex && "bg-[rgb(18_21_15_/_0.06)] text-muted",
              )}
            >
              {STAGE_LABEL[s]}
            </span>
          ))}
        </div>

        {/* what the OS just did */}
        {cascade && cascade.length > 0 && (
          <div
            className="rounded-[13px] px-4 py-3"
            style={{
              background: "rgb(180 238 42 / 0.12)",
              border: "1px solid rgb(180 238 42 / 0.3)",
            }}
          >
            <p className="flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-wide text-[var(--lime-deep)]">
              <Sparkles size={12} /> The OS did this, without you
            </p>
            <ul className="mt-2 space-y-1">
              {cascade.map((c, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-ink-2">
                  <ArrowRight size={13} className="mt-1 shrink-0 text-[var(--lime-deep)]" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--danger)]">
            <TriangleAlert size={14} /> {error}
          </p>
        )}

        {/* open work */}
        <div>
          <p className="t-label flex items-center gap-1.5 text-muted">
            <ListChecks size={11} /> Open work
          </p>
          {open.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-muted">
              Nothing open. The chain has run to the end.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {open.map((w) => {
                const due = dueLabel(w.due_at);
                return (
                  <div key={w.id} className="glass-inset rounded-[13px] p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <CircleDot size={14} className="shrink-0 text-[var(--lime-deep)]" />
                      <span className="text-[14px] font-bold">{w.title}</span>
                      <span className="rounded-full bg-[rgb(18_21_15_/_0.07)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-muted">
                        {TEAM_LABEL[w.team] ?? w.team}
                      </span>
                      {w.origin === "system" && (
                        <span className="text-[10.5px] font-bold uppercase tracking-wide text-[var(--lime-deep)]">
                          auto-created
                        </span>
                      )}
                      {due.text && (
                        <span
                          className={cn(
                            "tnum ml-auto text-[12px]",
                            due.late ? "font-bold text-[var(--danger)]" : "text-muted",
                          )}
                        >
                          {due.text}
                        </span>
                      )}
                    </div>
                    {w.detail && (
                      <p className="mt-1.5 pl-[22px] text-[12.5px] text-muted">{w.detail}</p>
                    )}
                    {w.blocked_reason && (
                      <p className="mt-1.5 pl-[22px] text-[12.5px] font-bold text-[var(--warn)]">
                        Blocked: {w.blocked_reason}
                      </p>
                    )}
                    <div className="mt-2.5 space-y-2 pl-[22px]">
                      {evidenceNeeded[w.id] && !evidenceHave.includes(w.id) && (
                        <div className="rounded-[11px] border border-dashed border-[var(--line)] p-2.5">
                          <p className="text-[12px] font-bold text-[var(--warn)]">
                            This step needs evidence before it can be completed.
                          </p>
                          {evidenceFor === w.id ? (
                            <div className="mt-2 space-y-2">
                              <textarea
                                value={evidenceText}
                                onChange={(e) => setEvidenceText(e.target.value)}
                                rows={2}
                                placeholder={EVIDENCE_PROMPT[evidenceNeeded[w.id] ?? ""] ?? "What happened?"}
                                className="glass-inset h-auto w-full resize-none rounded-[11px] px-3 py-2 text-[13px] outline-none"
                              />
                              <Button
                                variant="glass"
                                size="sm"
                                disabled={pending === `ev-${w.id}` || !evidenceText.trim()}
                                onClick={async () => {
                                  const ok = await run(`ev-${w.id}`, () =>
                                    addEvidenceAction(w.id, organizationId, evidenceNeeded[w.id]!, {
                                      note: evidenceText.trim(),
                                    }),
                                  );
                                  if (ok) { setEvidenceText(""); setEvidenceFor(null); }
                                }}
                              >
                                {pending === `ev-${w.id}` ? (
                                  <LoaderCircle size={13} className="animate-spin" />
                                ) : (
                                  <Check size={13} strokeWidth={2.8} />
                                )}
                                Record it
                              </Button>
                            </div>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => setEvidenceFor(w.id)}>
                              <Plus size={13} strokeWidth={2.8} /> Record what happened
                            </Button>
                          )}
                        </div>
                      )}
                      <Button
                        variant="glass"
                        size="sm"
                        disabled={pending === w.id}
                        onClick={() => complete(w.id)}
                      >
                        {pending === w.id ? (
                          <LoaderCircle size={13} className="animate-spin" />
                        ) : (
                          <Check size={13} strokeWidth={2.8} />
                        )}
                        Mark done
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* requirements — decided, not just displayed */}
        {requirements.length > 0 && (
          <div>
            <p className="t-label text-muted">
              Requirements · carried from the scoping brief
            </p>
            <div className="mt-2 space-y-2">
              {requirements.map((r) => {
                const settled = r.status === "confirmed" || r.status === "rejected" || r.status === "delivered";
                return (
                  <div key={r.id} className="glass-inset rounded-[12px] p-3">
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          r.status === "confirmed" ? "bg-[var(--ok)]"
                            : r.status === "rejected" ? "bg-[var(--danger)]"
                            : r.status === "clarification_required" ? "bg-[var(--warn)]"
                            : "bg-[rgb(18_21_15_/_0.25)]",
                        )}
                      />
                      <span className="flex-1 text-[13px] text-ink-2">
                        {r.title}
                        <span className="ml-2 text-[10.5px] uppercase tracking-wide text-muted">
                          {r.source} · {r.status.replace(/_/g, " ")}
                          {r.disposition ? ` · ${r.disposition.replace(/_/g, " ")}` : ""}
                        </span>
                      </span>
                    </div>
                    {!settled && (
                      <div className="mt-2 space-y-2 pl-[14px]">
                        <input
                          value={reqNote[r.id] ?? ""}
                          onChange={(e) => setReqNote({ ...reqNote, [r.id]: e.target.value })}
                          placeholder="What did the customer say? (required to send back to Sales)"
                          className="glass-inset h-9 w-full rounded-[10px] px-3 text-[12.5px] outline-none"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {([
                            ["confirmed", "configuration", "Confirmed — configuration"],
                            ["confirmed", "training", "Confirmed — training"],
                            ["confirmed", "product_gap", "Confirmed — product gap"],
                            ["clarification_required", null, "Ask Sales"],
                            ["rejected", null, "Reject"],
                          ] as [RequirementStatus, RequirementDisposition | null, string][]).map(
                            ([status, disp, label]) => (
                              <Button
                                key={label}
                                variant={status === "rejected" ? "ghost" : "glass"}
                                size="sm"
                                disabled={pending === r.id}
                                onClick={() =>
                                  run(r.id, () =>
                                    decideRequirementAction(
                                      r.id,
                                      organizationId,
                                      status,
                                      disp,
                                      reqNote[r.id] ?? "",
                                    ),
                                  )
                                }
                              >
                                {label}
                              </Button>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* locations — Day 2 FR-03 */}
        <div>
          <p className="t-label flex items-center gap-1.5 text-muted">
            <MapPin size={11} /> Locations
          </p>
          {locations.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {locations.map((l) => (
                <li key={l.id} className="text-[13px] text-ink-2">
                  <strong>{l.name}</strong>
                  <span className="ml-2 text-[10.5px] uppercase tracking-wide text-muted">{l.kind}</span>
                  {l.city && <span className="text-muted"> · {l.city}</span>}
                  {l.franchisee_name && <span className="text-muted"> · franchisee {l.franchisee_name}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-muted">
              None yet. A group like Annapurna needs one per outlet.
            </p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Outlet name"
              className="glass-inset h-9 w-full rounded-[10px] px-3 text-[12.5px] outline-none" />
            <select value={locKind} onChange={(e) => setLocKind(e.target.value)}
              className="glass-inset h-9 w-full rounded-[10px] px-3 text-[12.5px] outline-none">
              <option value="outlet">Outlet</option>
              <option value="branch">Branch</option>
              <option value="franchise">Franchise</option>
              <option value="warehouse">Warehouse</option>
              <option value="office">Office</option>
            </select>
            <input value={locCity} onChange={(e) => setLocCity(e.target.value)} placeholder="City"
              className="glass-inset h-9 w-full rounded-[10px] px-3 text-[12.5px] outline-none" />
            <input value={locFranchisee} onChange={(e) => setLocFranchisee(e.target.value)} placeholder="Franchisee"
              className="glass-inset h-9 w-full rounded-[10px] px-3 text-[12.5px] outline-none" />
          </div>
          <div className="mt-2">
            <Button variant="glass" size="sm" disabled={pending === "loc" || !locName.trim()}
              onClick={async () => {
                const ok = await run("loc", () =>
                  createLocationAction(organizationId, {
                    name: locName, kind: locKind, city: locCity, franchiseeName: locFranchisee,
                  }),
                );
                if (ok) { setLocName(""); setLocCity(""); setLocFranchisee(""); }
              }}
            >
              {pending === "loc" ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} strokeWidth={2.8} />}
              Add location
            </Button>
          </div>
        </div>

        {/* handoffs */}
        {handoffs.length > 0 && (
          <div>
            <p className="t-label text-muted">Handoffs</p>
            <ul className="mt-2 space-y-1.5">
              {handoffs.map((h) => (
                <li key={h.id} className="text-[13px] text-ink-2">
                  <span className="tnum text-muted">{when(h.created_at)}</span>{" · "}
                  <span className="font-bold">
                    {TEAM_LABEL[h.from_team]} → {TEAM_LABEL[h.to_team]}
                  </span>
                  <span className="text-muted">
                    {" "}· {Object.keys(h.context ?? {}).length} fields of context carried
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* completed work + timeline */}
        {(done.length > 0 || activities.length > 0) && (
          <details className="rounded-[13px] border border-[var(--line)] p-3.5">
            <summary className="press cursor-pointer text-[13px] font-bold text-muted">
              <span className="inline-flex items-center gap-1.5">
                <History size={12} /> Timeline ({activities.length})
              </span>
            </summary>
            <ol className="mt-3 space-y-1.5">
              {activities.map((a) => (
                <li key={a.id} className="text-[12.5px] leading-snug text-ink-2">
                  <span className="tnum text-muted">{when(a.created_at)}</span>
                  {" · "}
                  {a.summary}
                  <span
                    className={cn(
                      "ml-2 text-[10.5px] font-bold uppercase tracking-wide",
                      a.actor_label === "system" ? "text-[var(--lime-deep)]" : "text-muted",
                    )}
                  >
                    {a.actor_label}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}
