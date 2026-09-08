"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Check,
  CircleDot,
  LoaderCircle,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { OsTeam, WorkItem } from "@/lib/os/kernel";
import { completeWorkAction } from "@/app/admin/organizations/[id]/os-actions";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

const TEAMS: { key: OsTeam; label: string }[] = [
  { key: "onboarding", label: "Onboarding" },
  { key: "customer_success", label: "Customer Success" },
  { key: "operations", label: "Operations" },
  { key: "sales", label: "Sales" },
];

type Notification = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  team: string | null;
  created_at: string;
};

function dueLabel(iso: string | null): { text: string; late: boolean } {
  if (!iso) return { text: "", late: false };
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (ms < 0) return { text: `${Math.abs(days)}d overdue`, late: true };
  return { text: days === 0 ? "due today" : `due in ${days}d`, late: false };
}

export function WorkQueue({
  items,
  orgById,
  notifications,
  myTeam,
  myName,
}: {
  items: WorkItem[];
  orgById: Record<string, { name: string; stage: string | null }>;
  notifications: Notification[];
  /** The signed-in person's queue — shown first and labelled as theirs. */
  myTeam?: string;
  myName?: string;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [cascade, setCascade] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const teamsInOrder = useMemo(() => {
    if (!myTeam || myTeam === "platform") return TEAMS;
    return [...TEAMS].sort((a, b) =>
      Number(b.key === myTeam) - Number(a.key === myTeam),
    );
  }, [myTeam]);

  const byTeam = useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    for (const i of items) {
      if (doneIds.has(i.id)) continue;
      m.set(i.team, [...(m.get(i.team) ?? []), i]);
    }
    return m;
  }, [items, doneIds]);

  const overdue = items.filter((i) => !doneIds.has(i.id) && i.due_at && new Date(i.due_at) < new Date());

  async function complete(item: WorkItem) {
    if (!item.organization_id) return;
    haptic("medium");
    setPending(item.id);
    setError(null);
    setCascade(null);
    const res = await completeWorkAction(item.id, item.organization_id);
    setPending(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    haptic("success");
    setDoneIds((prev) => new Set(prev).add(item.id));
    setCascade(res.cascade);
  }

  const total = items.filter((i) => !doneIds.has(i.id)).length;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Open items", value: total, tone: "var(--ink)" },
          { label: "Overdue", value: overdue.length, tone: "var(--danger)" },
          { label: "Unread signals", value: notifications.length, tone: "var(--info)" },
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

      {cascade && cascade.length > 0 && (
        <div
          className="rounded-[var(--r-lg)] px-4 py-3"
          style={{ background: "rgb(180 238 42 / 0.12)", border: "1px solid rgb(180 238 42 / 0.3)" }}
        >
          <p className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-wide text-[var(--lime-deep)]">
            <Sparkles size={12} /> What the OS did in response
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

      {total === 0 ? (
        <div className="glass rounded-[var(--r-2xl)] px-6 py-16 text-center">
          <div className="relative z-10">
            <h2 className="t-h2">No open work</h2>
            <p className="mt-2 text-[15px] text-muted">
              Every chain has run to the end. New work appears here the moment a deal is won.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {teamsInOrder.map((t) => {
            const rows = byTeam.get(t.key) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={t.key} className="glass rounded-[var(--r-xl)] p-4">
                <div className="relative z-10">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[14px] font-extrabold">{t.label}</h2>
                    {t.key === myTeam && (
                      <span className="rounded-full bg-[rgb(180_238_42_/_0.22)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[var(--lime-deep)]">
                        {myName ? `${myName.split(" ")[0]}’s queue` : "yours"}
                      </span>
                    )}
                    <span className="tnum rounded-full bg-[rgb(18_21_15_/_0.08)] px-1.5 py-0.5 text-[10.5px] font-extrabold">
                      {rows.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {rows.map((w) => {
                      const org = w.organization_id ? orgById[w.organization_id] : null;
                      const due = dueLabel(w.due_at);
                      return (
                        <div key={w.id} className="glass-inset rounded-[13px] p-3.5">
                          <div className="flex items-start gap-2">
                            <CircleDot size={14} className="mt-1 shrink-0 text-[var(--lime-deep)]" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[14px] font-bold">{w.title}</p>
                              {org && w.organization_id && (
                                <Link
                                  href={`/admin/organizations/${w.organization_id}`}
                                  className="press text-[12.5px] font-semibold text-[var(--lime-deep)]"
                                >
                                  {org.name}
                                </Link>
                              )}
                            </div>
                            {due.text && (
                              <span
                                className={cn(
                                  "tnum shrink-0 text-[12px]",
                                  due.late ? "font-bold text-[var(--danger)]" : "text-muted",
                                )}
                              >
                                {due.text}
                              </span>
                            )}
                          </div>
                          <div className="mt-2.5 pl-[22px]">
                            <Button
                              variant="glass"
                              size="sm"
                              disabled={pending === w.id}
                              onClick={() => complete(w)}
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      {notifications.length > 0 && (
        <details className="glass rounded-[var(--r-lg)] p-4">
          <summary className="press cursor-pointer text-[13px] font-bold text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Bell size={12} /> Signals ({notifications.length})
            </span>
          </summary>
          <ul className="relative z-10 mt-3 space-y-2">
            {notifications.map((n) => (
              <li key={n.id} className="text-[13px] text-ink-2">
                <span className="tnum text-muted">
                  {new Date(n.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {" · "}
                <span className="font-bold">{n.title}</span>
                {n.team && <span className="text-muted"> → {n.team.replace(/_/g, " ")}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
