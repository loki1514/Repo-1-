"use client";

import { Ban, Bike, Check, CheckCheck, Circle, Flame, Utensils, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { KotCard, KotLine } from "@/lib/ops";
import { elapsed } from "@/lib/bill";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";

/** Everything the pass can move something *to*. There is no way back on this screen. */
export type BumpStatus = "preparing" | "ready" | "delivered";

/**
 * How late a ticket is. The kitchen is not asking "which section is this?" —
 * it is asking "which of these is about to become a complaint?", so age is the
 * only thing allowed to colour a card.
 */
type Age = "fresh" | "due" | "late";

const DUE_MINUTES = 10;
const LATE_MINUTES = 20;

const AGE_EDGE: Record<Age, string> = {
  fresh: "var(--line-strong)",
  due: "var(--warn)",
  late: "var(--danger)",
};

const AGE_INK: Record<Age, string> = {
  fresh: "var(--ink)",
  due: "var(--warn)",
  late: "var(--danger)",
};

export function ageOf(createdAt: string, now: number): Age {
  const mins = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  if (mins >= LATE_MINUTES) return "late";
  if (mins >= DUE_MINUTES) return "due";
  return "fresh";
}

/**
 * Station keys are free text on kot_tickets (`main`, `tandoor`, `beverages`).
 * The per-org display names live in kitchen_stations, which the board does not
 * load — the filter is built from the tickets actually on screen, so a key that
 * has no ticket cannot produce a chip anyway. Prettifying the key is enough.
 */
export function stationLabel(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const CHANNEL_LABEL: Record<string, string> = {
  dine_in: "Dine in",
  delivery: "Delivery",
  pickup: "Pick up",
  online: "Online",
  swiggy: "Swiggy",
  zomato: "Zomato",
  other: "Counter",
};

/** What the cook is cooking *for* — a table, or an aggregator that has none. */
function destination(ticket: KotCard): { label: string; icon: LucideIcon } {
  if (ticket.tableLabel) return { label: `Table ${ticket.tableLabel}`, icon: Utensils };
  return { label: CHANNEL_LABEL[ticket.channel] ?? stationLabel(ticket.channel), icon: Bike };
}

const LINE_NEXT: Partial<Record<KotLine["status"], BumpStatus>> = {
  pending: "preparing",
  preparing: "ready",
  ready: "delivered",
};

const LINE_MARK: Record<KotLine["status"], { icon: LucideIcon; colour: string; spent: boolean }> = {
  pending: { icon: Circle, colour: "var(--muted)", spent: false },
  preparing: { icon: Flame, colour: "var(--lime-deep)", spent: false },
  ready: { icon: Check, colour: "var(--ok)", spent: true },
  delivered: { icon: CheckCheck, colour: "var(--muted)", spent: true },
  cancelled: { icon: Ban, colour: "var(--danger)", spent: true },
};

const TICKET_NEXT: Record<
  KotCard["status"],
  { next: BumpStatus; label: string; icon: LucideIcon } | null
> = {
  new: { next: "preparing", label: "Start cooking", icon: Flame },
  preparing: { next: "ready", label: "Food is ready", icon: Check },
  ready: { next: "delivered", label: "Handed over", icon: CheckCheck },
  delivered: null,
};

export function TicketCard({
  ticket,
  now,
  busyId,
  onBumpTicket,
  onBumpLine,
}: {
  ticket: KotCard;
  /** Ticker value from the board, so every card ages on the same beat. */
  now: number;
  busyId: string | null;
  onBumpTicket: (ticket: KotCard, next: BumpStatus) => void;
  onBumpLine: (lineId: string, next: BumpStatus) => void;
}) {
  const age = ageOf(ticket.created_at, now);
  const dest = destination(ticket);
  const DestIcon = dest.icon;
  const foot = TICKET_NEXT[ticket.status];
  const FootIcon = foot?.icon;

  const plated = ticket.lines.filter((l) => LINE_MARK[l.status].spent).length;

  return (
    <article
      className={cn(
        "dim ticket-in flex flex-col rounded-[var(--r-lg)]",
        age === "late" && "urgent-ring",
      )}
      // Border width is constant so a card does not shift by a pixel when it
      // crosses into late — movement on this board should mean something.
      style={{ borderColor: AGE_EDGE[age], borderWidth: 2 }}
    >
      <header className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="tnum text-[26px] font-extrabold leading-none tracking-tight">
              #{ticket.kot_no}
            </h3>
            {ticket.priority === "urgent" && (
              <span
                className="inline-flex items-center gap-1 rounded-[var(--r-sm)] px-1.5 py-1 text-[11px] font-extrabold uppercase tracking-widest"
                style={{
                  background: "color-mix(in srgb, var(--danger) 16%, transparent)",
                  color: "var(--danger)",
                }}
              >
                <Zap size={12} strokeWidth={2.8} />
                Rush
              </span>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[15px] font-bold text-ink-2">
            <DestIcon size={15} strokeWidth={2.4} className="shrink-0 text-muted" />
            <span className="truncate">{dest.label}</span>
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p
            className="tnum text-[20px] font-extrabold leading-none"
            style={{ color: AGE_INK[age] }}
          >
            {elapsed(ticket.created_at, now)}
          </p>
          <p className="t-label mt-2 text-muted">{stationLabel(ticket.station)}</p>
        </div>
      </header>

      <ul className="border-t border-[var(--line)]">
        {ticket.lines.map((line) => {
          const mark = LINE_MARK[line.status];
          const MarkIcon = mark.icon;
          const next = LINE_NEXT[line.status];
          const busy = busyId === line.id;

          return (
            <li key={line.id}>
              <button
                type="button"
                disabled={!next || busy}
                onPointerDown={() => next && haptic("light")}
                onClick={() => next && onBumpLine(line.id, next)}
                aria-label={
                  next
                    ? `${line.qty} ${line.name}${line.variant_name ? ` ${line.variant_name}` : ""} — mark ${next}`
                    : `${line.qty} ${line.name} — ${line.status}`
                }
                className={cn(
                  "press flex min-h-[56px] w-full items-center gap-3 border-b border-[var(--line)] px-4 py-2.5 text-left",
                  // A finished line still has to be readable across the room, so
                  // it dims rather than greys out the way a disabled control would.
                  "disabled:pointer-events-none disabled:opacity-100",
                  busy && "opacity-60",
                )}
              >
                <span className="glass-inset tnum flex h-9 min-w-9 items-center justify-center rounded-[var(--r-sm)] px-1.5 text-[16px] font-extrabold">
                  {line.qty}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[17px] font-bold leading-tight",
                      mark.spent && "text-muted line-through",
                    )}
                  >
                    {line.name}
                  </span>
                  {line.variant_name && (
                    <span className="block text-[14px] font-semibold text-muted">
                      {line.variant_name}
                    </span>
                  )}
                  {line.notes && (
                    <span
                      className="mt-1.5 block rounded-[var(--r-sm)] px-2 py-1 text-[14px] font-bold leading-snug"
                      style={{
                        background: "color-mix(in srgb, var(--warn) 14%, transparent)",
                        boxShadow: "inset 2px 0 0 var(--warn)",
                      }}
                    >
                      {line.notes}
                    </span>
                  )}
                </span>

                <MarkIcon
                  size={22}
                  strokeWidth={2.4}
                  style={{ color: mark.colour }}
                  className="shrink-0"
                />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto px-3 pb-3 pt-3">
        <p className="tnum mb-2 px-1 text-[12.5px] font-bold uppercase tracking-wider text-muted">
          {plated} of {ticket.lines.length} done
        </p>
        {foot && FootIcon && (
          <button
            type="button"
            disabled={busyId === ticket.id}
            onPointerDown={() => haptic("heavy")}
            onClick={() => onBumpTicket(ticket, foot.next)}
            className="btn-lime press flex h-14 w-full items-center justify-center gap-2.5 rounded-[var(--r-md)] text-[17px] font-extrabold"
          >
            <FootIcon size={20} strokeWidth={2.6} />
            {foot.label}
          </button>
        )}
      </div>
    </article>
  );
}
