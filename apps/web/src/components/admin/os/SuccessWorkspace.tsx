"use client";

import { useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  ClipboardCheck,
  GraduationCap,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Plus,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { Activity, Requirement, WorkItem } from "@/lib/os/kernel";
import type {
  DemoPlan,
  DemoPlanItem,
  DiscoverySession,
  Feedback,
  FeedbackDisposition,
  ReadinessCheck,
  TrainingRecord,
} from "@/lib/os/success";
import type { BotRun } from "@/lib/os/bot";
import {
  addTraineeAction,
  buildDemoPlanAction,
  captureFeedbackAction,
  createDiscoveryAction,
  decideBotRunAction,
  disposeFeedbackAction,
  recordDiscoveryAction,
  runHandoffBotAction,
  seedReadinessAction,
  setReadinessAction,
  setTrainingCompleteAction,
  toggleDemoItemAction,
} from "@/app/admin/success/actions";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

const FIELD =
  "glass-inset h-10 w-full rounded-[11px] px-3 text-[13px] font-medium outline-none " +
  "placeholder:text-muted/70 focus:shadow-[inset_0_0_0_2px_var(--lime-deep)]";
const AREA = "glass-inset w-full resize-none rounded-[11px] px-3 py-2.5 text-[13px] outline-none";

const DISPOSITIONS: FeedbackDisposition[] = [
  "configuration", "training", "process_change", "product_gap", "development_issue", "accepted", "deferred",
];

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof Users;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass rounded-[var(--r-xl)] p-5">
      <div className="relative z-10">
        <div className="flex items-baseline gap-2">
          <Icon size={15} className="translate-y-[2px] text-[var(--lime-deep)]" />
          <h2 className="t-h3">{title}</h2>
        </div>
        {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </section>
  );
}

export function SuccessWorkspace({
  organizationId,
  stage,
  requirements,
  openWork,
  discovery,
  demoPlan,
  demoItems,
  feedback,
  training,
  readiness,
  activities,
  botRuns,
}: {
  organizationId: string;
  organizationName: string;
  stage: string | null;
  requirements: Requirement[];
  openWork: WorkItem[];
  discovery: DiscoverySession[];
  demoPlan: DemoPlan | null;
  demoItems: DemoPlanItem[];
  feedback: Feedback[];
  training: TrainingRecord[];
  readiness: ReadinessCheck[];
  activities: Activity[];
  botRuns: BotRun[];
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [cascade, setCascade] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [objective, setObjective] = useState("");
  const [participants, setParticipants] = useState("");
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [decisions, setDecisions] = useState("");
  const [questions, setQuestions] = useState("");
  const [fbBody, setFbBody] = useState("");
  const [fbWho, setFbWho] = useState("");
  const [fbScreen, setFbScreen] = useState("");
  const [traineeName, setTraineeName] = useState("");
  const [traineeRole, setTraineeRole] = useState("");
  const [traineeTopics, setTraineeTopics] = useState("");

  async function run(key: string, fn: () => Promise<{ ok: boolean; cascade?: string[]; error?: string }>) {
    haptic("medium");
    setPending(key);
    setError(null);
    setCascade(null);
    const res = await fn();
    setPending(null);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return false;
    }
    haptic("success");
    if (res.cascade?.length) setCascade(res.cascade);
    return true;
  }

  const confirmed = requirements.filter((r) => r.status === "confirmed");
  const unvalidated = requirements.filter(
    (r) => r.status === "captured" || r.status === "clarification_required",
  );
  const readyPassed = readiness.filter((r) => r.passed).length;
  const latestDraft = botRuns.find((b) => b.status === "draft");

  return (
    <div className="space-y-4">
      {cascade && cascade.length > 0 && (
        <div
          className="rounded-[var(--r-lg)] px-4 py-3"
          style={{ background: "rgb(180 238 42 / 0.12)", border: "1px solid rgb(180 238 42 / 0.3)" }}
        >
          <p className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-wide text-[var(--lime-deep)]">
            <Sparkles size={12} /> Recorded
          </p>
          <ul className="mt-2 space-y-1">
            {cascade.map((c, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-ink-2">
                <ArrowRight size={13} className="mt-1 shrink-0 text-[var(--lime-deep)]" /> {c}
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

      {/* at-a-glance */}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Stage", value: stage ? stage.replace(/_/g, " ") : "—" },
          { label: "Requirements", value: `${confirmed.length}/${requirements.length} confirmed` },
          { label: "Open feedback", value: String(feedback.filter((f) => !f.resolved).length) },
          { label: "Readiness", value: readiness.length ? `${readyPassed}/${readiness.length}` : "not started" },
        ].map((s) => (
          <div key={s.label} className="glass rounded-[var(--r-lg)] p-4">
            <div className="relative z-10">
              <p className="t-label text-muted">{s.label}</p>
              <p className="mt-1 text-[15px] font-bold capitalize">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* open work, for context */}
      {openWork.length > 0 && (
        <div className="glass rounded-[var(--r-lg)] p-4">
          <div className="relative z-10">
            <p className="t-label text-muted">Owed on this customer</p>
            <ul className="mt-2 space-y-1">
              {openWork.map((w) => (
                <li key={w.id} className="text-[13px] text-ink-2">
                  <strong>{w.title}</strong>
                  <span className="ml-2 text-[10.5px] uppercase tracking-wide text-muted">
                    {w.team.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* --- Day 1 §12 · the bot ------------------------------------------ */}
      <Section
        icon={Bot}
        title="Handoff brief"
        hint="Generated from the sales context only. A draft is not a fact until you approve it."
      >
        {latestDraft ? (
          <div className="glass-inset rounded-[13px] p-4">
            {latestDraft.output ? (
              <div className="space-y-2 text-[13px] text-ink-2">
                <p className="font-bold text-ink">{latestDraft.output.summary}</p>
                <p>{latestDraft.output.business_context}</p>
                {([
                  ["Requirements", latestDraft.output.requirements],
                  ["Promises made", latestDraft.output.promises_made],
                  ["Open questions", latestDraft.output.open_questions],
                  ["Risks", latestDraft.output.risks],
                  ["First actions", latestDraft.output.first_actions],
                  ["Missing information", latestDraft.output.missing_information],
                ] as [string, string[]][])
                  .filter(([, list]) => list.length > 0)
                  .map(([label, list]) => (
                    <div key={label}>
                      <p className="t-label mt-2 text-muted">{label}</p>
                      <ul className="mt-1 list-disc pl-4">
                        {list.map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--danger)]">{latestDraft.error}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="glass"
                size="sm"
                disabled={pending === "approve" || !latestDraft.output}
                onClick={() => run("approve", () => decideBotRunAction(organizationId, latestDraft.id, true))}
              >
                {pending === "approve" ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.8} />}
                Approve &amp; attach
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending === "reject"}
                onClick={() => run("reject", () => decideBotRunAction(organizationId, latestDraft.id, false))}
              >
                Reject
              </Button>
            </div>
            <p className="mt-2 text-[11.5px] text-muted">
              {latestDraft.bot} · {latestDraft.model} · draft, changes nothing until approved
            </p>
          </div>
        ) : (
          <Button
            variant="glass"
            size="sm"
            disabled={pending === "bot"}
            onClick={() => run("bot", () => runHandoffBotAction(organizationId))}
          >
            {pending === "bot" ? <LoaderCircle size={13} className="animate-spin" /> : <Bot size={13} />}
            Draft the handoff brief
          </Button>
        )}
        {botRuns.filter((b) => b.status !== "draft").length > 0 && (
          <p className="mt-2 text-[12px] text-muted">
            {botRuns.filter((b) => b.status === "approved").length} approved ·{" "}
            {botRuns.filter((b) => b.status === "rejected").length} rejected — every run is on the record
          </p>
        )}
      </Section>

      {/* --- §7 discovery ------------------------------------------------- */}
      <Section
        icon={Users}
        title="Discovery"
        hint="Validate how the customer actually works before showing them anything."
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What is this session for?" className={FIELD} />
          <input value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="Who is attending?" className={FIELD} />
          <Button
            variant="glass"
            size="sm"
            disabled={pending === "disc" || !objective.trim()}
            onClick={async () => {
              const ok = await run("disc", () => createDiscoveryAction(organizationId, objective, participants));
              if (ok) { setObjective(""); setParticipants(""); }
            }}
          >
            {pending === "disc" ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} strokeWidth={2.8} />}
            Schedule
          </Button>
        </div>

        {discovery.length > 0 && (
          <div className="mt-3 space-y-2">
            {discovery.map((d) => (
              <div key={d.id} className="glass-inset rounded-[12px] p-3">
                <p className="text-[13.5px] font-bold">{d.objective}</p>
                {d.participants && <p className="text-[12.5px] text-muted">{d.participants}</p>}
                {d.held_at ? (
                  <div className="mt-1.5 space-y-1 text-[12.5px] text-ink-2">
                    {d.decisions && <p><span className="text-muted">Decisions · </span>{d.decisions}</p>}
                    {d.open_questions && <p><span className="text-muted">Open · </span>{d.open_questions}</p>}
                    <p className={cn("text-[11.5px] font-bold uppercase tracking-wide", d.customer_confirmed ? "text-[var(--ok)]" : "text-[var(--warn)]")}>
                      {d.customer_confirmed ? "Customer confirmed" : "Not yet confirmed by the customer"}
                    </p>
                  </div>
                ) : outcomeFor === d.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea value={decisions} onChange={(e) => setDecisions(e.target.value)} rows={2} placeholder="What was decided?" className={AREA} />
                    <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={2} placeholder="What is still open?" className={AREA} />
                    <div className="flex flex-wrap gap-2">
                      {[true, false].map((confirmed) => (
                        <Button
                          key={String(confirmed)}
                          variant={confirmed ? "glass" : "ghost"}
                          size="sm"
                          disabled={pending === `out-${d.id}`}
                          onClick={async () => {
                            const ok = await run(`out-${d.id}`, () =>
                              recordDiscoveryAction(organizationId, d.id, decisions, questions, confirmed),
                            );
                            if (ok) { setDecisions(""); setQuestions(""); setOutcomeFor(null); }
                          }}
                        >
                          {confirmed ? "Record — customer confirmed" : "Record — not confirmed"}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setOutcomeFor(d.id)}>
                    <Plus size={13} strokeWidth={2.8} /> Record the outcome
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* --- §9 demo plan ------------------------------------------------- */}
      <Section
        icon={Monitor}
        title="Demo plan"
        hint="Built from the requirements this customer confirmed — never from a feature list."
      >
        {unvalidated.length > 0 && (
          <p className="mb-2 text-[13px] font-bold text-[var(--warn)]">
            {unvalidated.length} requirement{unvalidated.length === 1 ? " is" : "s are"} still unvalidated.
            Confirm them on the organization page first.
          </p>
        )}
        <Button
          variant="glass"
          size="sm"
          disabled={pending === "plan" || confirmed.length === 0}
          onClick={() => run("plan", () => buildDemoPlanAction(organizationId))}
        >
          {pending === "plan" ? <LoaderCircle size={13} className="animate-spin" /> : <Monitor size={13} />}
          {demoPlan ? "Rebuild from confirmed requirements" : "Build the demo plan"}
        </Button>

        {demoItems.length > 0 && (
          <ol className="mt-3 space-y-2">
            {demoItems.map((it) => (
              <li key={it.id} className="glass-inset flex items-start gap-3 rounded-[12px] p-3">
                <button
                  type="button"
                  aria-label={it.covered ? "Mark not covered" : "Mark covered"}
                  onClick={() => run(`di-${it.id}`, () => toggleDemoItemAction(organizationId, it.id, !it.covered))}
                  className={cn(
                    "press mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border",
                    it.covered
                      ? "border-transparent bg-[var(--ok)] text-white"
                      : "border-[var(--line-strong)] text-transparent",
                  )}
                >
                  <Check size={12} strokeWidth={3} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold">
                    {it.position}. {it.title}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    On <strong className="text-ink-2">{it.screen}</strong> · {it.success_criteria}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* --- §10 feedback ------------------------------------------------- */}
      <Section
        icon={MessageSquare}
        title="Feedback"
        hint="Captured on the screen it was said about, then dispositioned so it reaches whoever acts on it."
      >
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <input value={fbBody} onChange={(e) => setFbBody(e.target.value)} placeholder="What did they say?" className={FIELD} />
          <input value={fbWho} onChange={(e) => setFbWho(e.target.value)} placeholder="Who said it" className={FIELD} />
          <input value={fbScreen} onChange={(e) => setFbScreen(e.target.value)} placeholder="On which screen" className={FIELD} />
          <Button
            variant="glass"
            size="sm"
            disabled={pending === "fb" || !fbBody.trim()}
            onClick={async () => {
              const ok = await run("fb", () => captureFeedbackAction(organizationId, fbBody, fbWho, fbScreen));
              if (ok) { setFbBody(""); setFbWho(""); setFbScreen(""); }
            }}
          >
            {pending === "fb" ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} strokeWidth={2.8} />}
            Capture
          </Button>
        </div>

        {feedback.length > 0 && (
          <div className="mt-3 space-y-2">
            {feedback.map((f) => (
              <div key={f.id} className="glass-inset rounded-[12px] p-3">
                <p className="text-[13.5px] text-ink-2">&ldquo;{f.body}&rdquo;</p>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  {f.said_by || "unattributed"}
                  {f.screen ? ` · on ${f.screen}` : ""}
                  {f.disposition ? ` · ${f.disposition.replace(/_/g, " ")}` : ""}
                </p>
                {!f.disposition && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {DISPOSITIONS.map((d) => (
                      <Button
                        key={d}
                        variant="ghost"
                        size="sm"
                        disabled={pending === `fd-${f.id}`}
                        onClick={() => run(`fd-${f.id}`, () => disposeFeedbackAction(organizationId, f.id, d))}
                      >
                        {d.replace(/_/g, " ")}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* --- §11 training ------------------------------------------------- */}
      <Section icon={GraduationCap} title="Training" hint="Who has been trained, on what, and whether they finished.">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input value={traineeName} onChange={(e) => setTraineeName(e.target.value)} placeholder="Person" className={FIELD} />
          <input value={traineeRole} onChange={(e) => setTraineeRole(e.target.value)} placeholder="Their role" className={FIELD} />
          <input value={traineeTopics} onChange={(e) => setTraineeTopics(e.target.value)} placeholder="Topics / screens" className={FIELD} />
          <Button
            variant="glass"
            size="sm"
            disabled={pending === "tr" || !traineeName.trim()}
            onClick={async () => {
              const ok = await run("tr", () => addTraineeAction(organizationId, traineeName, traineeRole, traineeTopics));
              if (ok) { setTraineeName(""); setTraineeRole(""); setTraineeTopics(""); }
            }}
          >
            {pending === "tr" ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} strokeWidth={2.8} />}
            Add
          </Button>
        </div>

        {training.length > 0 && (
          <ul className="mt-3 space-y-2">
            {training.map((t) => (
              <li key={t.id} className="glass-inset flex items-center gap-3 rounded-[12px] p-3">
                <button
                  type="button"
                  aria-label={t.completed ? "Mark not complete" : "Mark complete"}
                  onClick={() => run(`tc-${t.id}`, () => setTrainingCompleteAction(organizationId, t.id, !t.completed))}
                  className={cn(
                    "press flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border",
                    t.completed ? "border-transparent bg-[var(--ok)] text-white" : "border-[var(--line-strong)] text-transparent",
                  )}
                >
                  <Check size={12} strokeWidth={3} />
                </button>
                <span className="text-[13.5px]">
                  <strong>{t.person_name}</strong>
                  {t.role_label && <span className="text-muted"> · {t.role_label}</span>}
                  {t.topics && <span className="text-muted"> · {t.topics}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* --- §12 readiness ------------------------------------------------ */}
      <Section
        icon={ClipboardCheck}
        title="Go-live readiness"
        hint="A fixed checklist, so “ready” means the same thing for every customer."
      >
        {readiness.length === 0 ? (
          <Button
            variant="glass"
            size="sm"
            disabled={pending === "rd"}
            onClick={() => run("rd", () => seedReadinessAction(organizationId))}
          >
            {pending === "rd" ? <LoaderCircle size={13} className="animate-spin" /> : <ClipboardCheck size={13} />}
            Open the readiness checklist
          </Button>
        ) : (
          <ul className="space-y-2">
            {readiness.map((r) => (
              <li key={r.id} className="glass-inset flex items-center gap-3 rounded-[12px] p-3">
                <button
                  type="button"
                  aria-label={r.passed ? "Mark not passed" : "Mark passed"}
                  onClick={() => run(`rc-${r.id}`, () => setReadinessAction(organizationId, r.id, !r.passed, ""))}
                  className={cn(
                    "press flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border",
                    r.passed ? "border-transparent bg-[var(--ok)] text-white" : "border-[var(--line-strong)] text-transparent",
                  )}
                >
                  <Check size={12} strokeWidth={3} />
                </button>
                <span className="text-[13.5px]">{r.item}</span>
              </li>
            ))}
          </ul>
        )}
        {readiness.length > 0 && readyPassed === readiness.length && (
          <p className="mt-3 text-[13px] font-bold text-[var(--ok)]">
            Every check passed — this customer is ready for go-live.
          </p>
        )}
      </Section>

      {/* timeline */}
      {activities.length > 0 && (
        <details className="glass rounded-[var(--r-lg)] p-4">
          <summary className="press cursor-pointer text-[13px] font-bold text-muted">
            Customer timeline ({activities.length})
          </summary>
          <ol className="relative z-10 mt-3 space-y-1.5">
            {activities.map((a) => (
              <li key={a.id} className="text-[12.5px] leading-snug text-ink-2">
                <span className="tnum text-muted">
                  {new Date(a.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
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
  );
}
