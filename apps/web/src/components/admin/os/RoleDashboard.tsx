import Link from "next/link";
import type { Dashboard } from "@/lib/os/dashboard";

const TONE: Record<string, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
};

/**
 * One dashboard component, four PRD dashboards. Each role gets its own
 * headline, its own question and its own numbers — see lib/os/dashboard.ts,
 * where the questions come from the Day 1 pack §4 and Day 3 §5.
 */
export function RoleDashboard({ data }: { data: Dashboard }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-h1">{data.headline}</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">{data.question}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.tiles.map((t) => (
          <div key={t.label} className="glass rounded-[var(--r-xl)] p-5">
            <div className="relative z-10">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: t.tone ? TONE[t.tone] : "var(--ink)" }}
                />
                <span className="t-label text-muted">{t.label}</span>
              </div>
              <p
                className="tnum mt-2 text-[26px] font-extrabold leading-none tracking-[-0.04em]"
                style={t.tone ? { color: TONE[t.tone] } : undefined}
              >
                {t.value}
              </p>
              {t.hint && <p className="mt-1 text-[12px] text-muted">{t.hint}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.lists.map((list) => (
          <div key={list.title} className="glass rounded-[var(--r-xl)] p-4">
            <div className="relative z-10">
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-extrabold">{list.title}</h2>
                <span className="tnum rounded-full bg-[rgb(18_21_15_/_0.08)] px-1.5 py-0.5 text-[10.5px] font-extrabold">
                  {list.rows.length}
                </span>
              </div>
              {list.rows.length === 0 ? (
                <p className="t-small mt-3 py-4 text-center text-muted">{list.empty}</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {list.rows.map((r) => (
                    <Link
                      key={r.id}
                      href={r.href}
                      className="press glass-inset block rounded-[12px] p-3"
                    >
                      <p className="text-[13.5px] font-bold">{r.title}</p>
                      <p
                        className="text-[12px]"
                        style={{ color: r.late ? "var(--danger)" : "var(--muted)" }}
                      >
                        {r.meta}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
