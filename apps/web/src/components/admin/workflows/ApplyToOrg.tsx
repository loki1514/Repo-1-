"use client";

import { useState, useTransition } from "react";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import type { ApplyPlan } from "@/lib/workflow-apply";
import { applyWorkflowAction, previewApplyAction } from "@/app/admin/workflows/actions";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

/**
 * "Apply to organization" — the step that makes the canvas the hub.
 *
 * Three deliberate gates between a drawing and live permissions:
 *   1. a diff the operator has to read,
 *   2. an explicit opt-in before anything is switched OFF,
 *   3. the builder passcode, the same second lock the permission matrix uses.
 *
 * The plan shown here is advisory. The server rebuilds it from the same
 * definition before writing, so a tampered payload cannot widen access beyond
 * what the flow actually draws.
 */
export function ApplyToOrg({
  organizationId,
  scopeLabel,
  definition,
  workflowName,
}: {
  organizationId: string;
  scopeLabel: string;
  definition: unknown;
  workflowName: string;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [prune, setPrune] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load(withPrune: boolean) {
    setError(null);
    start(async () => {
      const res = await previewApplyAction(organizationId, definition, withPrune);
      if (!res.ok) {
        setError(res.error);
        setPlan(null);
        return;
      }
      setPlan(res.plan);
    });
  }

  function openSheet() {
    haptic("medium");
    setOpen(true);
    setDone(null);
    setPasscode("");
    load(prune);
  }

  function apply() {
    haptic("heavy");
    setError(null);
    start(async () => {
      const res = await applyWorkflowAction(organizationId, definition, prune, passcode);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.applied);
      setPasscode("");
    });
  }

  const totalChanges = (plan?.modules.filter((m) => !m.blocked).length ?? 0) + (plan?.roles.length ?? 0);

  return (
    <>
      <Button variant="lime" size="sm" onClick={openSheet}>
        <Wand2 size={13} strokeWidth={2.6} />
        Apply to org
      </Button>

      {open && (
        <div className="fixed inset-0 z-[60] flex" role="dialog" aria-label="Apply this flow">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-[rgb(18_21_15_/_0.5)] backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="glass relative ml-auto flex h-full w-full max-w-lg flex-col overflow-y-auto p-5 sm:p-6">
            <div className="relative z-10 flex min-h-full flex-col">
              <header className="flex items-start gap-3">
                <div className="min-w-0">
                  <h2 className="t-h2">Apply to {scopeLabel}</h2>
                  <p className="mt-1 truncate text-[13px] font-bold text-muted">{workflowName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="press glass-inset ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-muted hover:text-ink"
                >
                  <X size={16} strokeWidth={2.6} />
                </button>
              </header>

              <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
                Module blocks on the canvas switch that module <strong>on</strong>. For each of
                those modules, the roles named on the block are the only roles that keep it —
                everyone else loses it. Modules the flow never mentions are left exactly as they
                are.
              </p>

              {done ? (
                <div className="glass-inset mt-6 rounded-[var(--r-lg)] p-5 text-center">
                  <CheckCircle2 size={26} className="mx-auto" style={{ color: "var(--ok)" }} />
                  <p className="mt-3 text-[15px] font-extrabold">Applied</p>
                  <p className="mt-1 text-[13.5px] text-muted">Updated {done}.</p>
                  <Button variant="glass" size="sm" className="mt-4" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                </div>
              ) : (
                <>
                  {pending && !plan && (
                    <p className="mt-6 flex items-center gap-2 text-[13.5px] text-muted">
                      <Loader2 size={14} className="animate-spin" />
                      Working out what would change…
                    </p>
                  )}

                  {plan && (
                    <div className="mt-5 space-y-4">
                      {plan.notes.map((n) => (
                        <p
                          key={n}
                          className="flex items-start gap-2 rounded-[12px] px-3 py-2.5 text-[12.5px] font-semibold leading-snug"
                          style={{ background: "rgb(242 169 59 / 0.14)", color: "var(--ink-2)" }}
                        >
                          <TriangleAlert size={14} style={{ color: "var(--warn)" }} className="mt-0.5 shrink-0" />
                          {n}
                        </p>
                      ))}

                      <Section title="Modules" count={plan.modules.length}>
                        {plan.modules.length === 0 ? (
                          <Empty>Every module this flow uses is already on.</Empty>
                        ) : (
                          plan.modules.map((m) => (
                            <Row
                              key={m.moduleKey}
                              label={m.moduleName}
                              from={m.from ? "On" : "Off"}
                              to={m.to ? "On" : "Off"}
                              positive={m.to}
                              blocked={m.blocked}
                            />
                          ))
                        )}
                      </Section>

                      <Section title="Who can see what" count={plan.roles.length}>
                        {plan.roles.length === 0 ? (
                          <Empty>Role visibility already matches this flow.</Empty>
                        ) : (
                          plan.roles.map((r) => (
                            <Row
                              key={`${r.roleId}:${r.moduleKey}`}
                              label={`${r.roleName} · ${r.moduleName}`}
                              from={r.from ? "Visible" : "Hidden"}
                              to={r.to ? "Visible" : "Hidden"}
                              positive={r.to}
                            />
                          ))
                        )}
                      </Section>

                      <label className="glass-inset flex cursor-pointer items-start gap-3 rounded-[var(--r-lg)] p-3.5">
                        <input
                          type="checkbox"
                          checked={prune}
                          onChange={(e) => {
                            setPrune(e.target.checked);
                            load(e.target.checked);
                          }}
                          className="mt-0.5 h-4 w-4 accent-[var(--lime-deep)]"
                        />
                        <span>
                          <span className="flex items-center gap-1.5 text-[13.5px] font-bold">
                            <Trash2 size={13} strokeWidth={2.5} />
                            Also switch off modules this flow doesn&rsquo;t use
                          </span>
                          <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                            Off by default. A flow describes one journey — the org almost
                            certainly has others that are not on this canvas. Core modules are
                            never switched off.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}

                  <div className="mt-auto pt-6">
                    {totalChanges > 0 && (
                      <label className="block">
                        <span className="t-label flex items-center gap-1.5 text-muted">
                          <KeyRound size={12} strokeWidth={2.8} />
                          Builder passcode
                        </span>
                        <input
                          type="password"
                          value={passcode}
                          onChange={(e) => setPasscode(e.target.value)}
                          autoComplete="off"
                          placeholder="Required — permissions are moving"
                          className="glass-inset mt-1.5 h-11 w-full rounded-[12px] px-3.5 text-[14px] font-semibold outline-none"
                        />
                      </label>
                    )}

                    {error && (
                      <p className="mt-3 flex items-start gap-2 text-[13px] font-bold text-[var(--danger)]">
                        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                        {error}
                      </p>
                    )}

                    <div className="mt-4 flex items-center gap-2">
                      <Button variant="ghost" size="md" onClick={() => setOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="lime"
                        size="md"
                        className="ml-auto"
                        feedback="heavy"
                        disabled={pending || totalChanges === 0 || passcode.length === 0}
                        onClick={apply}
                      >
                        {pending ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Wand2 size={14} strokeWidth={2.6} />
                        )}
                        {totalChanges === 0
                          ? "Nothing to apply"
                          : `Apply ${totalChanges} change${totalChanges === 1 ? "" : "s"}`}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <h3 className="t-label text-muted">{title}</h3>
        {count > 0 && (
          <span className="tnum rounded-full bg-[rgb(18_21_15_/_0.08)] px-1.5 text-[10.5px] font-extrabold">
            {count}
          </span>
        )}
      </div>
      <div className="mt-1.5 space-y-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="t-small px-1 text-muted">{children}</p>;
}

function Row({
  label,
  from,
  to,
  positive,
  blocked,
}: {
  label: string;
  from: string;
  to: string;
  positive: boolean;
  blocked?: string;
}) {
  return (
    <div
      className={cn(
        "glass-inset flex items-center gap-2 rounded-[11px] px-3 py-2",
        blocked && "opacity-55",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{label}</span>
      <span className="shrink-0 text-[11.5px] font-bold text-muted line-through">{from}</span>
      <ArrowRight size={12} className="shrink-0 text-muted" />
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold"
        style={{
          background: positive
            ? "color-mix(in srgb, var(--ok) 18%, transparent)"
            : "rgb(226 86 75 / 0.16)",
          color: positive ? "var(--ok)" : "var(--danger)",
        }}
      >
        {blocked ? "Blocked" : to}
      </span>
    </div>
  );
}
