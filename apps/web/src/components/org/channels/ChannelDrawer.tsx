"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Plug, Store, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";
import { setChannelAcceptingAction } from "@/app/org/channels/actions";

export type StoreChannel = {
  id: string;
  channel: string;
  displayName: string;
  connected: boolean;
  accepting: boolean;
  nextOpenAt: string | null;
  commissionPct: number;
};

// ---------------------------------------------------------------------------
// Shared bits for this screen. They live here rather than in a fifth file
// because both halves of /org/channels are the same control in two sizes.
// ---------------------------------------------------------------------------

type Tone = "danger" | "warn" | "ok" | "info";

/** A chip painted in a state token — keeps colour out of the markup. */
export function tint(tone: Tone, strength = 12): React.CSSProperties {
  return {
    background: `color-mix(in srgb, var(--${tone}) ${strength}%, transparent)`,
    color: `var(--${tone})`,
  };
}

/**
 * Off | On, spelled out.
 *
 * The reference uses two labelled halves instead of a switch and it is right
 * to: a switch carries its state in a knob position, and a misread on this
 * screen means an evening of aggregator orders that never arrive. The word is
 * the state.
 *
 * The "on" half is painted in the org accent, so it themes itself. The "off"
 * half is a danger ring rather than a danger fill because no token defines an
 * ink that sits on --danger — a solid red pill with borrowed ink is how a
 * control ends up unreadable in exactly one of the two themes.
 */
export function OnOff({
  on,
  onChange,
  label,
  size = "md",
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  /** Names the thing being switched, for anyone hearing this instead of seeing it. */
  label: string;
  size?: "sm" | "md";
}) {
  const md = size === "md";
  return (
    <div
      role="group"
      aria-label={`${label} — availability`}
      className={cn(
        "glass-inset flex shrink-0 items-center gap-1 rounded-[10px] p-1",
        md ? "h-9 w-[108px]" : "h-8 w-[96px]",
      )}
    >
      <Seg tone="off" active={!on} md={md} onClick={() => onChange(false)}>
        Off
      </Seg>
      <Seg tone="on" active={on} md={md} onClick={() => onChange(true)}>
        On
      </Seg>
    </div>
  );
}

function Seg({
  tone,
  active,
  md,
  onClick,
  children,
}: {
  tone: "off" | "on";
  active: boolean;
  md: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onPointerDown={() => haptic(tone === "off" ? "medium" : "light")}
      onClick={onClick}
      className={cn(
        "press flex flex-1 items-center justify-center rounded-[7px] font-extrabold",
        md ? "h-7 text-[12.5px]" : "h-6 text-[12px]",
        !active && "text-muted",
      )}
      style={
        active
          ? tone === "on"
            ? { background: "var(--lime)", color: "var(--lime-ink)" }
            : { ...tint("danger", 14), boxShadow: "inset 0 0 0 1.5px var(--danger)" }
          : undefined
      }
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Store on / off
// ---------------------------------------------------------------------------

/** "1:32 AM, Aug 21" — the line the reference prints under a closed store. */
const TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const DATE_FMT = new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" });

function whenLabel(iso: string): string {
  const d = new Date(iso);
  return `${TIME_FMT.format(d).toUpperCase()}, ${DATE_FMT.format(d)}`;
}

type Duration = { id: string; label: string; reopen: (nowMs: number) => string | null };

const STORE_DURATIONS: Duration[] = [
  { id: "30m", label: "30 minutes", reopen: (n) => new Date(n + 30 * 60_000).toISOString() },
  { id: "1h", label: "1 hour", reopen: (n) => new Date(n + 60 * 60_000).toISOString() },
  { id: "2h", label: "2 hours", reopen: (n) => new Date(n + 120 * 60_000).toISOString() },
  {
    // Midnight, not a guessed opening hour: when the outlet actually opens is
    // the outlet's business, and the date boundary is the only reading of
    // "rest of day" nobody can argue with.
    id: "day",
    label: "Rest of day",
    reopen: (n) => {
      const d = new Date(n);
      d.setHours(24, 0, 0, 0);
      return d.toISOString();
    },
  },
  { id: "open", label: "Indefinitely", reopen: () => null },
];

type RowState = { accepting: boolean; nextOpenAt: string | null };

/**
 * Store status for every sales channel.
 *
 * The reference hides this in a right-hand drawer; here it is the top panel,
 * because on this screen it is the headline and not a setting — a shut store
 * is the single most expensive state in the product.
 */
export function ChannelDrawer({ channels }: { channels: StoreChannel[] }) {
  const router = useRouter();
  // Only the rows this session has touched are held locally; everything else
  // reads straight off the server props. That is what keeps the optimistic
  // state from having to be re-seeded — and from masking a refresh.
  const [edits, setEdits] = useState<Map<string, RowState>>(() => new Map());
  const [sheet, setSheet] = useState<StoreChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const stateOf = (c: StoreChannel): RowState =>
    edits.get(c.channel) ?? { accepting: c.accepting, nextOpenAt: c.nextOpenAt };

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5_000);
    return () => clearTimeout(id);
  }, [error]);

  function commit(c: StoreChannel, accepting: boolean, reopenAtIso: string | null) {
    const previous = stateOf(c);
    setEdits((m) =>
      new Map(m).set(c.channel, { accepting, nextOpenAt: accepting ? null : reopenAtIso }),
    );
    setSheet(null);
    haptic(accepting ? "success" : "warn");

    start(async () => {
      const res = await setChannelAcceptingAction(c.channel, accepting, reopenAtIso);
      if (!res.ok) {
        setEdits((m) => new Map(m).set(c.channel, previous));
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const live = channels.filter((c) => stateOf(c).accepting).length;

  return (
    <section className="dim rounded-[var(--r-xl)] p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-[12px]"
          style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
        >
          <Store size={17} strokeWidth={2.4} />
        </span>
        <div className="min-w-0">
          <h2 className="t-h3">Store status</h2>
          <p className="t-small text-muted">
            Switching a channel off stops new orders from it. Anything already placed still cooks.
          </p>
        </div>
        {channels.length > 0 && (
          <span
            className="tnum ml-auto rounded-full px-3 py-1 text-[12px] font-extrabold"
            style={tint(live === channels.length ? "ok" : "warn", 14)}
          >
            {live}/{channels.length} accepting
          </span>
        )}
      </header>

      {channels.length === 0 ? (
        <p className="mt-4 rounded-[var(--r-md)] border border-dashed border-[var(--line-strong)] px-5 py-8 text-center text-[13.5px] text-muted">
          No sales channels are set up for this outlet yet.
        </p>
      ) : (
        <ul className="mt-4">
          {channels.map((c) => {
            const s = stateOf(c);
            return (
              <li
                key={c.id}
                className="flex items-center gap-3 border-t border-[var(--line)] py-3 first:border-t-0 first:pt-0"
              >
                <span
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.accepting && "pulse-dot")}
                  style={{ background: s.accepting ? "var(--ok)" : "var(--danger)" }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-extrabold leading-tight">
                    {c.displayName}
                  </p>
                  {/* Wall-clock time is the browser's to format: the server has
                      no idea which timezone this outlet sits in, so the two
                      renders legitimately disagree until hydration. */}
                  <p className="t-small truncate text-muted" suppressHydrationWarning>
                    {s.accepting
                      ? c.connected
                        ? "Accepting orders"
                        : "Accepting orders · not connected yet"
                      : s.nextOpenAt
                        ? `Next opens at ${whenLabel(s.nextOpenAt)}`
                        : "Off until you switch it back on"}
                  </p>
                </div>
                {c.commissionPct > 0 && (
                  <span className="tnum hidden text-[12px] font-bold text-muted sm:block">
                    {c.commissionPct}% commission
                  </span>
                )}
                <OnOff
                  on={s.accepting}
                  label={c.displayName}
                  onChange={(next) => {
                    // Coming back on is harmless and immediate. Going off is
                    // the one that costs money, so it goes through the sheet.
                    if (next) commit(c, true, null);
                    else setSheet(c);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

      {sheet && (
        <StoreOffSheet
          channel={sheet}
          onCancel={() => setSheet(null)}
          onConfirm={(reopenAtIso) => commit(sheet, false, reopenAtIso)}
        />
      )}

      {error && (
        <p
          role="alert"
          className="fade-in mt-3 flex items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-[13px] font-bold"
          style={tint("danger", 12)}
        >
          <TriangleAlert size={14} strokeWidth={2.5} />
          {error}
        </p>
      )}

      {pending && (
        <p className="t-small mt-2 text-muted" aria-live="polite">
          Saving…
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function StoreOffSheet({
  channel,
  onCancel,
  onConfirm,
}: {
  channel: StoreChannel;
  onCancel: () => void;
  onConfirm: (reopenAtIso: string | null) => void;
}) {
  // The timestamp is frozen when the duration is picked, not recomputed on
  // render — otherwise "back on at 7:45" quietly slides while the manager
  // reads the confirmation they are about to agree to.
  const [choice, setChoice] = useState<{ label: string; reopenAt: string | null } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Turn ${channel.displayName} off`}
    >
      <button
        type="button"
        aria-label="Cancel"
        className="fade-in absolute inset-0 bg-black/55"
        onClick={onCancel}
      />
      <div className="sheet-up dim relative w-full max-w-[440px] rounded-t-[var(--r-xl)] p-5 sm:rounded-[var(--r-xl)]">
        <div className="flex items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
            style={tint("danger", 14)}
          >
            <Plug size={17} strokeWidth={2.4} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-extrabold leading-tight">
              Turn {channel.displayName} off
            </h3>
            <p className="t-small text-muted">
              {choice ? "Confirm before it goes dark." : "How long should it stay off?"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="press flex h-8 w-8 items-center justify-center rounded-full text-muted"
          >
            <X size={17} strokeWidth={2.6} />
          </button>
        </div>

        {!choice ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {STORE_DURATIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                onPointerDown={() => haptic("light")}
                onClick={() => setChoice({ label: d.label, reopenAt: d.reopen(Date.now()) })}
                className="glass-inset press flex h-12 items-center justify-center rounded-[var(--r-md)] px-3 text-[13.5px] font-bold last:col-span-2"
              >
                {d.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-[14px] font-extrabold leading-snug">
              {channel.displayName} will stop accepting new orders.
            </p>
            <p className="t-small mt-1 text-muted">
              Orders already placed are unaffected — the kitchen keeps cooking them.
            </p>
            <p
              className="mt-3 flex items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-[13px] font-bold"
              style={tint("warn", 14)}
              suppressHydrationWarning
            >
              <Clock size={14} strokeWidth={2.5} />
              {choice.reopenAt
                ? `Back on at ${whenLabel(choice.reopenAt)}`
                : "Stays off until you switch it back on"}
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="ghost"
                size="md"
                className="flex-1"
                onClick={() => setChoice(null)}
              >
                Back
              </Button>
              <Button
                variant="dark"
                size="md"
                feedback="heavy"
                className="flex-[1.4]"
                onClick={() => onConfirm(choice.reopenAt)}
              >
                Turn {channel.displayName} off
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
