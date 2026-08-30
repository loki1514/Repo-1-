"use client";

import * as React from "react";
import { BellRing, Brush, Check, CupSoda, Receipt, Utensils } from "lucide-react";
import type { ServiceRequest } from "@/lib/ops";
import { elapsed } from "@/lib/bill";
import { haptic } from "@/lib/haptics";
import { resolveRequestAction } from "@/app/org/tables/actions";

type Meta = {
  label: string;
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number }>;
};

/** `kind` is a check constraint in the database, not a TS union — hence a fallback. */
const KINDS: Record<string, Meta> = {
  water: { label: "Water", icon: CupSoda },
  cutlery: { label: "Cutlery", icon: Utensils },
  clean_up: { label: "Clean up", icon: Brush },
  bill: { label: "Bill", icon: Receipt },
  assistance: { label: "Assistance", icon: BellRing },
  other: { label: "Assistance", icon: BellRing },
};

/**
 * Where the guest's Call Waiter tap lands.
 *
 * Deliberately renders nothing when the queue is empty: an always-present
 * "no requests" box teaches staff to stop looking at that strip, which is
 * exactly the habit that makes the next request go unseen for ten minutes.
 */
export function ServiceRail({
  requests,
  now,
}: {
  requests: ServiceRequest[];
  now: number;
}) {
  // Cleared locally so the chip leaves under the thumb; the server revalidate
  // that follows is what makes it stay gone.
  const [cleared, setCleared] = React.useState<ReadonlySet<string>>(new Set());
  // The pending flag is deliberately dropped: the chip has already left the
  // rail, so disabling the remaining buttons would only stop a captain from
  // clearing two requests in two taps.
  const [, start] = React.useTransition();

  const open = requests.filter((r) => !cleared.has(r.id));
  if (open.length === 0) return null;

  function resolve(id: string) {
    haptic("medium");
    setCleared((prev) => new Set(prev).add(id));
    start(async () => {
      try {
        await resolveRequestAction(id);
      } catch {
        // Put it back rather than swallow it — an unacknowledged guest request
        // that silently vanished from the board is worse than a stuck chip.
        setCleared((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  return (
    <section aria-label="Open service requests" className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <BellRing size={14} strokeWidth={2.6} style={{ color: "var(--danger)" }} />
        <h2 className="t-label text-ink-2">
          Guests calling · <span className="tnum">{open.length}</span>
        </h2>
      </div>

      <ul className="rail flex gap-2 overflow-x-auto pb-1">
        {open.map((r) => {
          const meta = KINDS[r.kind] ?? KINDS.other;
          const Icon = meta.icon;
          return (
            <li
              key={r.id}
              className="dim ticket-in flex shrink-0 items-center gap-2.5 rounded-[var(--r-md)] py-2 pl-3 pr-2"
              style={{ borderColor: "color-mix(in srgb, var(--danger) 34%, transparent)" }}
            >
              <Icon size={15} strokeWidth={2.4} />
              <p className="whitespace-nowrap text-[12.5px] font-bold">
                {r.tableLabel ? `Table ${r.tableLabel}` : "Counter"}
                <span className="text-muted"> · </span>
                {meta.label}
                <span className="text-muted"> · </span>
                <span className="tnum font-semibold text-muted">
                  {elapsed(r.created_at, now)}
                </span>
              </p>
              {r.note && (
                <span className="max-w-[180px] truncate text-[12px] text-muted">{r.note}</span>
              )}
              <button
                type="button"
                onClick={() => resolve(r.id)}
                aria-label={`Mark the ${meta.label.toLowerCase()} request for ${
                  r.tableLabel ? `table ${r.tableLabel}` : "the counter"
                } done`}
                className="press btn-lime inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2.5 text-[12px] font-extrabold"
              >
                <Check size={13} strokeWidth={3} />
                Done
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
