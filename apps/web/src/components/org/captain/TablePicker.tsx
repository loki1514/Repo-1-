"use client";

import { useSyncExternalStore } from "react";
import type { TableState } from "@/lib/ops";
import { elapsed, inrShort } from "@/lib/bill";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

/**
 * Colour carries the same meaning here as on the floor view, because a captain
 * and a manager standing next to each other must not read the same table two
 * different ways. States come pre-derived from listFloor().
 */
const STATE: Record<TableState["state"], { label: string; colour: string; busy: boolean }> = {
  blank: { label: "Free", colour: "var(--muted)", busy: false },
  seated: { label: "Seated", colour: "var(--info)", busy: true },
  running: { label: "Running", colour: "var(--lime-deep)", busy: true },
  food_ready: { label: "Food ready", colour: "var(--ok)", busy: true },
  printed: { label: "Bill printed", colour: "var(--warn)", busy: true },
  paid: { label: "Paid", colour: "var(--muted)", busy: false },
};

const LEGEND: TableState["state"][] = ["blank", "seated", "running", "food_ready", "printed"];

/**
 * Table age is the one number here that moves on its own, so it is read from a
 * clock React subscribes to rather than from Date.now() at render. The server
 * snapshot is deliberately null: both passes render a table with no age, the
 * age appears on mount, and there is no hydration mismatch on a table that
 * happens to tick over a minute between the two.
 */
const TICK_MS = 30_000;
const subscribeToClock = (onChange: () => void) => {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
};
// The snapshot is the timestamp itself, rounded down to the tick, so it stays
// identical between ticks — a snapshot that changed on every read would spin.
const clockTick = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noClock = () => null;

export function TablePicker({
  tables,
  selectedId,
  onPick,
}: {
  tables: TableState[];
  selectedId: string | null;
  onPick: (table: TableState) => void;
}) {
  const now = useSyncExternalStore<number | null>(subscribeToClock, clockTick, noClock);

  // Areas keep the order listFloor gave them, which is the floor's own sort.
  const areas: { name: string; tables: TableState[] }[] = [];
  for (const t of tables) {
    const last = areas.find((a) => a.name === t.areaName);
    if (last) last.tables.push(t);
    else areas.push({ name: t.areaName, tables: [t] });
  }

  const free = tables.filter((t) => !STATE[t.state].busy).length;

  return (
    <div className="pb-4">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="t-h3">Pick a table</h2>
        <p className="tnum text-[13px] font-semibold text-muted">
          {free} of {tables.length} free
        </p>
      </div>

      <div className="rail mt-2.5 flex gap-2 overflow-x-auto px-1 pb-1">
        {LEGEND.map((s) => (
          <span
            key={s}
            className="dim flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-bold text-ink-2"
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ background: STATE[s].colour }}
            />
            {STATE[s].label}
          </span>
        ))}
      </div>

      {areas.map((area) => (
        <section key={area.name} className="mt-4">
          <h3 className="t-label px-1 text-muted">{area.name}</h3>
          <div className="mt-2 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {area.tables.map((t) => {
              const meta = STATE[t.state];
              const selected = t.id === selectedId;
              const mins = now && t.openedAt ? elapsed(t.openedAt, now) : null;

              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  aria-label={
                    meta.busy
                      ? `Table ${t.label}, ${meta.label}, ${inrShort(t.amount)} running`
                      : `Table ${t.label}, free, ${t.seats} seats`
                  }
                  onClick={() => {
                    haptic("medium");
                    onPick(t);
                  }}
                  className={cn(
                    "press flex min-h-[92px] flex-col items-start justify-between rounded-[var(--r-md)] p-2.5 text-left",
                    selected ? "raise-accent" : "dim",
                  )}
                  style={
                    selected ? { background: "var(--lime)", color: "var(--lime-ink)" } : undefined
                  }
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn("h-2.5 w-2.5 shrink-0 rounded-full", t.readyItems > 0 && "pulse-dot")}
                      style={{ background: selected ? "var(--lime-ink)" : meta.colour }}
                    />
                    <span className="truncate text-[17px] font-extrabold leading-none">{t.label}</span>
                  </span>

                  {meta.busy ? (
                    <span className="w-full">
                      <span className="tnum block text-[14.5px] font-extrabold leading-tight">
                        {inrShort(t.amount)}
                      </span>
                      <span
                        className={cn(
                          "tnum block truncate text-[11.5px] font-semibold",
                          !selected && "text-muted",
                        )}
                      >
                        {mins ?? meta.label}
                      </span>
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "tnum text-[11.5px] font-semibold",
                        !selected && "text-muted",
                      )}
                    >
                      {t.seats} seats
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {tables.length === 0 && (
        <p className="py-20 text-center text-[14px] text-muted">
          No tables are set up on this floor yet.
        </p>
      )}
    </div>
  );
}
