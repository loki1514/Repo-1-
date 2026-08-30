"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ChefHat } from "lucide-react";
import type { KotCard } from "@/lib/ops";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import { bumpLineAction, bumpTicketAction } from "@/app/org/kds/actions";
import { TicketCard, stationLabel, type BumpStatus } from "./TicketCard";

/** Left to right is the life of a dish. Nothing on this board moves backwards. */
const COLUMNS = [
  { status: "new", label: "New", dot: "var(--info)", empty: "Nothing waiting" },
  { status: "preparing", label: "Cooking", dot: "var(--lime-deep)", empty: "Nothing on the range" },
  { status: "ready", label: "Ready", dot: "var(--ok)", empty: "Pass is clear" },
] as const;

/** The board and the ticker share one beat — see the effect below. */
const TICK_MS = 10_000;

// ---------------------------------------------------------------------------
// The station filter lives in localStorage, not in React state.
//
// A kitchen tablet reloads constantly — screensaver, kiosk watchdog, someone's
// elbow — and must come back to the same station. Reading it through
// useSyncExternalStore keeps the server snapshot ("All") separate from the
// browser's, so the choice survives without a hydration mismatch. Every access
// is wrapped: a kiosk profile with site data disabled throws on the getter
// itself, and the board must still work, just without remembering.
// ---------------------------------------------------------------------------

const STATION_KEY = "vini.kds.station";
const ALL = "all";

let stationCache: string | null = null;
let stationListeners: Array<() => void> = [];

function readStation(): string {
  if (stationCache !== null) return stationCache;
  try {
    stationCache = localStorage.getItem(STATION_KEY) ?? ALL;
  } catch {
    stationCache = ALL;
  }
  return stationCache;
}

function writeStation(next: string): void {
  // Cached first so the filter still holds for this session when the write fails.
  stationCache = next;
  try {
    localStorage.setItem(STATION_KEY, next);
  } catch {
    /* storage unavailable — the choice just will not survive the next reload */
  }
  for (const notify of stationListeners) notify();
}

function subscribeStation(onChange: () => void): () => void {
  stationListeners = [...stationListeners, onChange];
  // A second tablet on the same account changing station fires `storage` here.
  const external = () => {
    stationCache = null;
    onChange();
  };
  window.addEventListener("storage", external);
  return () => {
    stationListeners = stationListeners.filter((l) => l !== onChange);
    window.removeEventListener("storage", external);
  };
}

type Patch =
  | { kind: "ticket"; id: string; status: BumpStatus }
  | { kind: "line"; id: string; status: BumpStatus };

/**
 * Mirrors what ops.setKotStatus does server-side: bumping a ticket drags every
 * line with it. If the optimistic view guessed differently the card would
 * visibly correct itself a moment later, which on a wall screen reads as a bug.
 */
function applyPatch(tickets: KotCard[], patch: Patch): KotCard[] {
  if (patch.kind === "line") {
    return tickets.map((t) => ({
      ...t,
      lines: t.lines.map((l) => (l.id === patch.id ? { ...l, status: patch.status } : l)),
    }));
  }

  return tickets
    // listKotBoard only returns new/preparing/ready, so a handed-over ticket
    // has to leave the board here too rather than linger for one refresh.
    .filter((t) => !(t.id === patch.id && patch.status === "delivered"))
    .map((t) =>
      t.id === patch.id
        ? {
            ...t,
            status: patch.status,
            lines: t.lines.map((l) => ({ ...l, status: patch.status })),
          }
        : t,
    );
}

export function KdsBoard({
  tickets,
  serverNow,
}: {
  tickets: KotCard[];
  /** Rendered clock from the server, so the first paint hydrates cleanly. */
  serverNow: number;
}) {
  const router = useRouter();
  const [board, patch] = useOptimistic(tickets, applyPatch);
  const [, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(serverNow);
  const station = useSyncExternalStore(subscribeStation, readStation, () => ALL);

  // One heartbeat drives both halves of "is this board alive": the elapsed
  // clocks count up locally, and the data behind them is re-fetched. Split
  // across two timers they would drift apart, and a card would show 14 min
  // against a ticket the server no longer has.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(id);
  }, [error]);

  function pickStation(next: string) {
    haptic("light");
    writeStation(next);
  }

  const stations = useMemo(() => {
    const seen = new Map<string, number>();
    for (const t of board) seen.set(t.station, (seen.get(t.station) ?? 0) + 1);
    // Keep the selected station on screen even when its rail empties out —
    // otherwise the chip disappears and the cook is stranded on a blank board
    // with no way back to All.
    if (station !== ALL && !seen.has(station)) seen.set(station, 0);
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [board, station]);

  const visible = useMemo(
    () => (station === ALL ? board : board.filter((t) => t.station === station)),
    [board, station],
  );

  function bumpTicket(ticket: KotCard, next: BumpStatus) {
    setBusyId(ticket.id);
    start(async () => {
      patch({ kind: "ticket", id: ticket.id, status: next });
      const res = await bumpTicketAction(ticket.id, next);
      if (!res.ok) setError(res.error);
      setBusyId(null);
    });
  }

  function bumpLine(lineId: string, next: BumpStatus) {
    setBusyId(lineId);
    start(async () => {
      patch({ kind: "line", id: lineId, status: next });
      const res = await bumpLineAction(lineId, next);
      if (!res.ok) setError(res.error);
      setBusyId(null);
    });
  }

  return (
    <main className="pb-10">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-h1">Kitchen Display</h1>
          <p className="mt-2 text-[15.5px] text-muted">
            Tap a dish as it is plated. Bump the ticket when the whole order leaves the pass.
          </p>
        </div>
        <span className="glass inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5">
          <span
            className="pulse-dot relative z-10 h-2.5 w-2.5 rounded-full"
            style={{ background: "var(--ok)" }}
          />
          <span className="tnum relative z-10 text-[13px] font-bold">
            Live · {visible.length} open
          </span>
        </span>
      </div>

      <div className="rail -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
        <StationChip
          label="All"
          count={board.length}
          active={station === ALL}
          onPick={() => pickStation(ALL)}
        />
        {stations.map(([key, count]) => (
          <StationChip
            key={key}
            label={stationLabel(key)}
            count={count}
            active={station === key}
            onPick={() => pickStation(key)}
          />
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="dim fade-in mb-4 rounded-[var(--r-md)] px-4 py-3 text-[15px] font-bold"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="dim rounded-[var(--r-xl)] px-6 py-20 text-center">
          <ChefHat size={36} strokeWidth={1.8} className="mx-auto text-[var(--lime-deep)]" />
          <p className="mt-4 text-[20px] font-extrabold">All clear — nothing on the pass</p>
          <p className="mt-2 text-[15px] text-muted">
            {station === ALL
              ? "New tickets land here the moment the floor fires them."
              : `Nothing for ${stationLabel(station)} right now.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
          {COLUMNS.map((col) => {
            const list = visible.filter((t) => t.status === col.status);
            return (
              <section key={col.status} aria-label={col.label}>
                {/* Sticky under the org top bar, which is 92px of sticky chrome.
                    On a phone the three columns stack, and this header is the
                    only thing telling a cook which pile they are scrolling. */}
                <h2
                  className="sticky top-[92px] z-10 -mx-1 mb-3 flex items-center gap-2 rounded-[var(--r-md)] px-3 py-2.5"
                  style={{ background: "var(--canvas)" }}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: col.dot }}
                  />
                  <span className="text-[17px] font-extrabold">{col.label}</span>
                  <span className="tnum ml-auto text-[15px] font-extrabold text-muted">
                    {list.length}
                  </span>
                </h2>

                <div className="space-y-4">
                  {list.length === 0 ? (
                    <p className="rounded-[var(--r-lg)] border border-dashed border-[var(--line-strong)] px-4 py-8 text-center text-[14px] font-semibold text-muted">
                      {col.empty}
                    </p>
                  ) : (
                    list.map((ticket) => (
                      <TicketCard
                        key={ticket.id}
                        ticket={ticket}
                        now={now}
                        busyId={busyId}
                        onBumpTicket={bumpTicket}
                        onBumpLine={bumpLine}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

function StationChip({
  label,
  count,
  active,
  onPick,
}: {
  label: string;
  count: number;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      className={cn(
        "press inline-flex h-11 shrink-0 items-center gap-2 rounded-[var(--r-md)] px-4 text-[15px] font-extrabold",
        active ? "btn-lime raise-accent" : "dim text-ink-2",
      )}
    >
      <span className="relative z-10">{label}</span>
      <span className="tnum relative z-10 text-[13px] opacity-70">{count}</span>
    </button>
  );
}
