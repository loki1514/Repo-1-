"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Armchair,
  BellRing,
  ChefHat,
  ClipboardList,
  IndianRupee,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { inrShort } from "@/lib/bill";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import type { LiveSnapshot } from "@/lib/ops";
import { ChannelSplit } from "./ChannelSplit";
import { Timeline } from "./Timeline";

/** Fast enough that a KOT firing shows up before anyone asks about it. */
const REFRESH_MS = 12_000;

/**
 * Two refreshes missed and the board is quietly lying. A wrong number on a
 * screen people trust at a glance is worse than an absent one, so past this
 * age the header stops claiming to be live.
 */
const STALE_AFTER_MS = 30_000;

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export function LiveBoard({
  snapshot,
  orgName,
}: {
  snapshot: LiveSnapshot;
  orgName: string;
}) {
  const router = useRouter();

  // Nothing here may read the wall clock during render: the server would
  // answer with its own time and timezone and the browser would disagree on
  // hydration. Seeded after mount instead, at the cost of one placeholder paint.
  const [now, setNow] = useState<number | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Relative times are derived from this rather than recomputed at render:
  // the board sits untouched for twelve seconds at a time, and "2 min ago"
  // must not still read "2 min ago" a minute later.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const frame = requestAnimationFrame(tick);
    const id = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  // A new `snapshot` object means the server actually answered. Stamping after
  // it lands — rather than when the request went out — is what makes staleness
  // honest when the network, not the restaurant, went quiet. A timer and not a
  // frame: requestAnimationFrame is parked while the tab is in the background,
  // which would leave syncedAt null and the header claiming "Live" indefinitely.
  useEffect(() => {
    const id = setTimeout(() => {
      setSyncedAt(Date.now());
      setRefreshing(false);
    }, 0);
    return () => clearTimeout(id);
  }, [snapshot]);

  // A spinner that never stops reads as "still working" when nothing is. If
  // the refresh does not land, the stale badge is the honest signal, not this.
  useEffect(() => {
    if (!refreshing) return;
    const id = setTimeout(() => setRefreshing(false), 6_000);
    return () => clearTimeout(id);
  }, [refreshing]);

  const stale = now !== null && syncedAt !== null && now - syncedAt > STALE_AFTER_MS;

  const asOf =
    syncedAt === null
      ? "--:--:--"
      : new Date(syncedAt).toLocaleTimeString("en-IN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

  function refreshNow() {
    haptic("medium");
    setRefreshing(true);
    router.refresh();
  }

  return (
    <div className="pt-1">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="t-h1">Live operations</h1>
          <p className="t-small mt-1 text-muted">
            {orgName} — the floor, the pass and the till, right now.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="dim flex items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5">
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 shrink-0 rounded-full", !stale && "pulse-dot")}
              style={{ background: stale ? "var(--warn)" : "var(--ok)" }}
            />
            <span className="text-[12px] font-extrabold">{stale ? "Stale" : "Live"}</span>
            <span className="tnum text-[11.5px] font-semibold text-muted">as of {asOf}</span>
          </span>

          <button
            type="button"
            onClick={refreshNow}
            aria-label="Refresh now"
            title="Refresh now"
            className="dim press flex h-10 w-10 items-center justify-center rounded-full text-ink-2"
          >
            <RefreshCw
              size={16}
              strokeWidth={2.4}
              className={refreshing ? "animate-spin" : undefined}
            />
          </button>
        </div>
      </header>

      {/* Announced once when the board goes stale — the pulse dot is no use to
          anyone reading this with a screen reader. */}
      <p className="sr-only" aria-live="polite">
        {stale ? "This board has stopped updating. The numbers may be out of date." : ""}
      </p>

      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Today so far">
        <Kpi
          icon={IndianRupee}
          label="Today's sales"
          value={inrShort(snapshot.salesToday)}
          hint="settled bills"
        />
        <Kpi
          icon={ClipboardList}
          label="Orders"
          value={String(snapshot.ordersToday)}
          hint="opened today"
        />
        <Kpi icon={Users} label="Covers" value={String(snapshot.covers)} hint="guests seated" />
        <Kpi
          icon={TrendingUp}
          label="Average bill"
          value={inrShort(snapshot.averageBill)}
          hint="per settled bill"
        />
      </section>

      <section className="dim mt-3 rounded-[var(--r-xl)] p-2.5" aria-label="Right now">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <NowCell
            icon={ChefHat}
            label="Preparing"
            tone="var(--warn)"
            value={<span className="tnum">{snapshot.preparing}</span>}
            hint="items on the range"
          />
          {/* Food on the pass is food going cold. This is the one cell allowed
              to shout, and only while there is something to shout about. */}
          <NowCell
            icon={BellRing}
            label="On the pass"
            tone="var(--danger)"
            loud={snapshot.ready > 0}
            value={<span className="tnum">{snapshot.ready}</span>}
            hint={snapshot.ready > 0 ? "run these now" : "nothing waiting"}
          />
          <NowCell
            icon={ReceiptText}
            label="Awaiting payment"
            tone="var(--info)"
            value={<span className="tnum">{snapshot.awaitingPayment}</span>}
            hint="bills printed"
          />
          <NowCell
            icon={Armchair}
            label="Tables occupied"
            tone="var(--lime-deep)"
            value={
              <>
                <span className="tnum">{snapshot.tablesOccupied}</span>
                <span className="tnum text-[0.62em] font-bold text-muted">
                  {" "}
                  of {snapshot.tablesTotal}
                </span>
              </>
            }
            hint="open sessions"
          />
        </div>
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <ChannelSplit slices={snapshot.byChannel} />
        </div>
        <div className="lg:col-span-7">
          <Timeline events={snapshot.timeline} now={now} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Read from across a desk: the number carries the tile, the words apologise. */
function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: Icon;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="dim rounded-[var(--r-lg)] p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={2.5} className="shrink-0 text-[var(--lime-deep)]" />
        <p className="t-label truncate text-muted">{label}</p>
      </div>
      <p className="tnum mt-2.5 text-[clamp(1.75rem,3.6vw,2.5rem)] font-extrabold leading-none tracking-tight">
        {value}
      </p>
      <p className="t-small mt-1.5 text-muted">{hint}</p>
    </div>
  );
}

function NowCell({
  icon: Icon,
  label,
  tone,
  value,
  hint,
  loud = false,
}: {
  icon: Icon;
  label: string;
  tone: string;
  value: ReactNode;
  hint: string;
  loud?: boolean;
}) {
  return (
    <div
      className={cn("glass-inset rounded-[var(--r-md)] px-3.5 py-3", loud && "urgent-ring")}
      // Inline rather than a utility class: .glass-inset is unlayered CSS and
      // would out-cascade any Tailwind border/background utility put here.
      style={
        loud
          ? {
              background: `color-mix(in srgb, ${tone} 13%, transparent)`,
              borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`,
            }
          : undefined
      }
    >
      <div className="flex items-center gap-1.5">
        <span className="flex shrink-0 items-center" style={{ color: tone }}>
          <Icon size={13} strokeWidth={2.5} />
        </span>
        <p className="text-[11.5px] font-extrabold uppercase tracking-wide text-muted">
          {label}
        </p>
      </div>
      <p
        className="mt-1.5 text-[28px] font-extrabold leading-none tracking-tight"
        style={loud ? { color: tone } : undefined}
      >
        {value}
      </p>
      <p className="t-small mt-1 text-muted">{hint}</p>
    </div>
  );
}
