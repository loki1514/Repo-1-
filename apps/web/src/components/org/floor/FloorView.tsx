"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, RefreshCw, Users, Wallet } from "lucide-react";
import type { Area, ServiceRequest, TableState } from "@/lib/ops";
import { inr } from "@/lib/bill";
import { haptic } from "@/lib/haptics";
import { ServiceRail } from "./ServiceRail";
import { STATE_META, STATE_ORDER, TableCard } from "./TableCard";

/** How often the board goes back to the server. Fast enough that a table never
 *  lies for longer than a walk across the room, slow enough to be free. */
const REFRESH_MS = 15_000;

export function FloorView({
  areas,
  tables,
  requests,
  serverNow,
}: {
  areas: Area[];
  tables: TableState[];
  requests: ServiceRequest[];
  serverNow: number;
}) {
  const router = useRouter();

  // Starting from the server's clock keeps the first client render byte-identical;
  // the effect below immediately replaces it with the browser's own.
  const [now, setNow] = React.useState(serverNow);
  const [stamp, setStamp] = React.useState<string | null>(null);

  const beat = React.useCallback(() => {
    const t = Date.now();
    setNow(t);
    setStamp(
      new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(t),
    );
  }, []);

  React.useEffect(() => {
    // The first beat is deferred by a tick rather than run inline, so hydration
    // completes against the server's clock before the browser's replaces it.
    const first = setTimeout(beat, 0);
    const id = setInterval(() => {
      beat();
      router.refresh();
    }, REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [beat, router]);

  // Areas come back in the floor plan's own sort order; anything the plan does
  // not place (the "Other" bucket) falls to the bottom rather than jumping to
  // the top alphabetically.
  const groups = React.useMemo(() => {
    const rank = new Map(areas.map((a, i) => [a.name, i]));
    const byArea = new Map<string, TableState[]>();
    for (const t of tables) {
      const list = byArea.get(t.areaName);
      if (list) list.push(t);
      else byArea.set(t.areaName, [t]);
    }
    return [...byArea.entries()].sort(([a], [b]) => {
      const d = (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER);
      return d !== 0 ? d : a.localeCompare(b);
    });
  }, [areas, tables]);

  const occupied = tables.filter((t) => t.state !== "blank");
  const covers = occupied.reduce((s, t) => s + t.guestCount, 0);
  // "Open on the floor" is money not yet collected, so a settled table must
  // drop out of it the moment it is paid — otherwise the figure only ever
  // climbs through the night.
  const openAmount = tables.reduce((s, t) => (t.state === "paid" ? s : s + t.amount), 0);

  const counts = React.useMemo(() => {
    const c = new Map<TableState["state"], number>();
    for (const t of tables) c.set(t.state, (c.get(t.state) ?? 0) + 1);
    return c;
  }, [tables]);

  return (
    <div className="pt-2">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <p className="t-label text-muted">Live floor</p>
          <h1 className="t-h2">Tables</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Deliberately not a live region: a screen reader announcing a fresh
              timestamp every 15 seconds would drown out the board itself. */}
          <span className="glass-inset flex items-center gap-2 rounded-[var(--r-sm)] px-2.5 py-1.5 text-[12px] font-semibold text-muted">
            <span
              aria-hidden
              className="pulse-dot h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--ok)" }}
            />
            <span className="tnum">Updated {stamp ?? "—"}</span>
          </span>
          <button
            type="button"
            aria-label="Refresh the floor now"
            onPointerDown={() => haptic("light")}
            onClick={() => {
              beat();
              router.refresh();
            }}
            className="press glass flex h-9 w-9 items-center justify-center rounded-[var(--r-sm)] text-ink-2"
          >
            <RefreshCw size={15} strokeWidth={2.4} />
          </button>
        </div>
      </header>

      {tables.length === 0 ? (
        <EmptyFloor />
      ) : (
        <>
          <section
            aria-label="Floor summary"
            className="dim mt-4 grid grid-cols-3 divide-x rounded-[var(--r-lg)]"
          >
            <Tile icon={Users} label="Covers seated" value={String(covers)} />
            <Tile
              icon={LayoutGrid}
              label="Tables running"
              value={`${occupied.length} / ${tables.length}`}
            />
            <Tile icon={Wallet} label="Open on the floor" value={inr(openAmount)} />
          </section>

          <ServiceRail requests={requests} now={now} />

          <ul
            aria-label="What the colours mean"
            className="rail mt-4 flex gap-2 overflow-x-auto pb-1"
          >
            {STATE_ORDER.map((s) => {
              const meta = STATE_META[s];
              return (
                <li
                  key={s}
                  title={meta.hint}
                  className="glass-inset flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold text-ink-2"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: meta.tone }}
                  />
                  {meta.label}
                  <span className="tnum font-semibold text-muted">{counts.get(s) ?? 0}</span>
                </li>
              );
            })}
          </ul>

          {groups.map(([area, list]) => {
            const busy = list.filter((t) => t.state !== "blank").length;
            return (
              <section key={area} className="mt-6">
                <div className="mb-2.5 flex items-baseline gap-2">
                  <h2 className="t-label text-ink-2">{area}</h2>
                  <span className="tnum text-[11.5px] font-semibold text-muted">
                    {busy} of {list.length} running
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-[var(--line)]" />
                </div>
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {list.map((t) => (
                    <TableCard key={t.id} table={t} now={now} />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="px-3.5 py-3">
      <p className="t-label flex items-center gap-1.5 text-muted">
        <Icon size={13} strokeWidth={2.4} />
        <span className="truncate">{label}</span>
      </p>
      <p className="tnum mt-1 text-[19px] font-extrabold leading-none tracking-[-0.025em]">
        {value}
      </p>
    </div>
  );
}

/**
 * No tables at all is a setup problem, not an empty shift — so it points at the
 * floor plan instead of showing a grid with nothing in it.
 */
function EmptyFloor() {
  return (
    <div className="dim mt-4 rounded-[var(--r-lg)] px-5 py-8 text-center">
      <LayoutGrid size={26} strokeWidth={1.8} className="mx-auto text-muted" />
      <h2 className="t-h3 mt-3">No tables on this floor plan yet</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-ink-2">
        The board draws itself from the dining areas and tables set up for this outlet.
        Add an area and its tables — each one gets its own QR — and every seating will
        appear here the moment a guest scans in.
      </p>
    </div>
  );
}
