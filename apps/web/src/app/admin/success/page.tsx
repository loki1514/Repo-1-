import type { Metadata } from "next";
import Link from "next/link";
import { requireSection } from "@/lib/platform-admin";
import { listPortfolio } from "@/lib/os/success";

export const metadata: Metadata = { title: "Customer Success" };
export const dynamic = "force-dynamic";

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

const RISK: Record<string, { label: string; bg: string; fg: string }> = {
  ok: { label: "On track", bg: "rgb(79 191 106 / 0.14)", fg: "var(--ok)" },
  watch: { label: "Watch", bg: "rgb(242 169 59 / 0.16)", fg: "var(--warn)" },
  at_risk: { label: "At risk", bg: "rgb(226 86 75 / 0.12)", fg: "var(--danger)" },
};

/**
 * Day 3 §4.2 + §14 — the portfolio and the health view, which are the same
 * list read two ways: who am I carrying, and which of them needs me today.
 */
export default async function SuccessPage() {
  await requireSection("success");
  const rows = await listPortfolio();

  const atRisk = rows.filter((r) => r.risk === "at_risk").length;
  const watch = rows.filter((r) => r.risk === "watch").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-h1">Customer Success</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          Every customer with an onboarding under way, and what each of them is waiting on.
          Sorted so the ones needing you today are first.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Customers", value: rows.length, tone: "var(--ink)" },
          { label: "Needs attention", value: watch, tone: "var(--warn)" },
          { label: "At risk", value: atRisk, tone: "var(--danger)" },
        ].map((s) => (
          <div key={s.label} className="glass rounded-[var(--r-xl)] p-5">
            <div className="relative z-10 flex items-center gap-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.tone }} />
              <span className="t-label text-muted">{s.label}</span>
              <span className="tnum ml-auto text-[24px] font-extrabold leading-none tracking-[-0.04em]">
                {s.value}
              </span>
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="glass rounded-[var(--r-2xl)] px-6 py-16 text-center">
          <div className="relative z-10">
            <h2 className="t-h2">No customers onboarding</h2>
            <p className="mt-2 text-[15px] text-muted">
              A customer appears here the moment a won deal becomes an organization.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {[...rows]
            .sort((a, b) => {
              const rank = { at_risk: 0, watch: 1, ok: 2 } as const;
              return rank[a.risk] - rank[b.risk];
            })
            .map((r) => {
              const risk = RISK[r.risk];
              return (
                <Link
                  key={r.id}
                  href={`/admin/success/${r.id}`}
                  className="press glass block rounded-[var(--r-lg)] p-4"
                >
                  <div className="relative z-10 flex flex-wrap items-center gap-3">
                    <span className="text-[15px] font-bold">{r.name}</span>
                    <span className="rounded-full bg-[rgb(18_21_15_/_0.07)] px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide text-muted">
                      {r.stage ? (STAGE_LABEL[r.stage] ?? r.stage) : "—"}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide"
                      style={{ background: risk.bg, color: risk.fg }}
                    >
                      {risk.label}
                    </span>
                    <span className="ml-auto flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
                      <span className="tnum">{r.openWork} open</span>
                      {r.overdue > 0 && (
                        <span className="tnum font-bold text-[var(--danger)]">{r.overdue} overdue</span>
                      )}
                      {r.unvalidatedRequirements > 0 && (
                        <span className="tnum">{r.unvalidatedRequirements} unvalidated</span>
                      )}
                      {r.openFeedback > 0 && <span className="tnum">{r.openFeedback} feedback</span>}
                      {r.readinessTotal > 0 && (
                        <span className="tnum">
                          readiness {r.readinessPassed}/{r.readinessTotal}
                        </span>
                      )}
                    </span>
                  </div>
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}
