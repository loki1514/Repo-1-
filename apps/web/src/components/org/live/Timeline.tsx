"use client";

import type { ComponentType } from "react";
import {
  BadgeIndianRupee,
  BellRing,
  ChefHat,
  CircleCheck,
  CircleDashed,
  CircleX,
  ClipboardList,
  Flame,
  HandPlatter,
  History,
  Moon,
  ReceiptText,
} from "lucide-react";
import { elapsed } from "@/lib/bill";
import type { LiveSnapshot } from "@/lib/ops";

type Event = LiveSnapshot["timeline"][number];
type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;

/**
 * Event kind → icon + state token.
 *
 * Kinds are free text in order_events, and ops.ts builds some of them by
 * template (`kot_${status}`, `item_${status}`), so this map cannot be
 * exhaustive by construction — an unrecognised kind gets the neutral dot
 * rather than crashing or vanishing from the feed.
 *
 * The colour ramp is the life of a dish: blue placed → amber cooking →
 * green ready → quiet delivered → accent paid.
 */
const KIND: Record<string, { icon: Icon; tone: string }> = {
  placed: { icon: ClipboardList, tone: "var(--info)" },
  kot_fired: { icon: Flame, tone: "var(--warn)" },
  kot_preparing: { icon: ChefHat, tone: "var(--warn)" },
  item_preparing: { icon: ChefHat, tone: "var(--warn)" },
  kot_ready: { icon: BellRing, tone: "var(--ok)" },
  item_ready: { icon: CircleCheck, tone: "var(--ok)" },
  kot_delivered: { icon: HandPlatter, tone: "var(--ink-2)" },
  item_delivered: { icon: HandPlatter, tone: "var(--ink-2)" },
  bill_requested: { icon: ReceiptText, tone: "var(--info)" },
  paid: { icon: BadgeIndianRupee, tone: "var(--lime-deep)" },
  cancelled: { icon: CircleX, tone: "var(--danger)" },
  item_cancelled: { icon: CircleX, tone: "var(--danger)" },
};

const NEUTRAL = { icon: CircleDashed, tone: "var(--muted)" };

/** Who moved the order. Anything unlisted keeps its raw name — see actorChip. */
const ACTOR: Record<string, { label: string; tone: string }> = {
  guest: { label: "Guest", tone: "var(--info)" },
  captain: { label: "Captain", tone: "var(--lime-deep)" },
  kitchen: { label: "Kitchen", tone: "var(--warn)" },
  pos: { label: "POS", tone: "var(--ink-2)" },
  biller: { label: "Biller", tone: "var(--ink-2)" },
  manager: { label: "Manager", tone: "var(--ink-2)" },
  swiggy: { label: "Swiggy", tone: "var(--warn)" },
  zomato: { label: "Zomato", tone: "var(--danger)" },
  integration: { label: "Integration", tone: "var(--muted)" },
};

/**
 * actor is free text on order_events, so an unmapped value still gets a chip
 * rather than silently losing the attribution — "who did this" is half the
 * value of an audit feed, and an unfamiliar name is still an answer.
 */
function actorChip(actor: string | null): { label: string; tone: string } | null {
  if (!actor) return null;
  return ACTOR[actor] ?? { label: actor, tone: "var(--muted)" };
}

/** A token at low alpha — never a second hardcoded colour to keep in sync. */
function tint(token: string, pct: number): string {
  return `color-mix(in srgb, ${token} ${pct}%, transparent)`;
}

/**
 * `now` is null until the board's ticker seeds itself after mount. Reading the
 * clock during render instead would have the server and the browser answering
 * with two different times, which React reports as a hydration mismatch — so
 * the first paint shows a dash and the ticker fills it in.
 */
function agoLabel(iso: string, now: number | null): string {
  if (now === null) return "—";
  const ago = elapsed(iso, now);
  // elapsed() floors to whole minutes, so anything under a minute old reads
  // "0 min". On a board that refreshes every 12 seconds that is the common
  // case, and "just now" is what a person standing there would actually say.
  return ago === "0 min" ? "just now" : `${ago} ago`;
}

export function Timeline({ events, now }: { events: Event[]; now: number | null }) {
  return (
    <section className="dim rounded-[var(--r-xl)] p-4 sm:p-5" aria-labelledby="timeline-h">
      <div className="flex items-center gap-2.5">
        <History size={16} strokeWidth={2.4} className="text-[var(--lime-deep)]" />
        <h2 id="timeline-h" className="t-h3">
          Ball by ball
        </h2>
        <span className="t-small ml-auto text-muted">newest first</span>
      </div>

      {events.length === 0 ? (
        <div className="mt-4 flex flex-col items-center rounded-[var(--r-md)] border border-dashed border-[var(--line-strong)] px-5 py-10 text-center">
          <Moon size={26} strokeWidth={1.8} className="text-muted" />
          <p className="mt-3 text-[14.5px] font-extrabold">All quiet</p>
          <p className="t-small mt-1 max-w-xs text-muted">
            Nothing has moved yet. The feed fills itself the moment a table orders.
          </p>
        </div>
      ) : (
        // Without tabIndex a keyboard user is locked out of the older half of
        // the feed: an overflow container is not focusable on its own.
        <ol className="scroll-thin mt-4 max-h-[560px] overflow-y-auto pr-1" tabIndex={0}>
          {events.map((e, i) => {
            const meta = KIND[e.kind] ?? NEUTRAL;
            const EventIcon = meta.icon;
            const actor = actorChip(e.actor);
            const isLast = i === events.length - 1;

            return (
              <li key={e.id} className="relative flex gap-3">
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-[13px] top-[28px] w-px"
                    style={{ background: "var(--line-strong)" }}
                  />
                )}

                <span
                  aria-hidden="true"
                  className="relative z-10 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: tint(meta.tone, 14),
                    color: meta.tone,
                    boxShadow: `inset 0 0 0 1px ${tint(meta.tone, 34)}`,
                  }}
                >
                  <EventIcon size={13} strokeWidth={2.5} />
                </span>

                <div className={`min-w-0 flex-1 ${isLast ? "pb-0.5" : "pb-4"}`}>
                  <p className="text-[13.5px] font-semibold leading-snug">{e.message}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <time
                      dateTime={e.created_at}
                      className="tnum text-[11.5px] font-bold text-muted"
                    >
                      {agoLabel(e.created_at, now)}
                    </time>
                    {actor && (
                      <span
                        className="rounded-[6px] px-1.5 py-[1px] text-[10.5px] font-extrabold uppercase tracking-wide"
                        style={{ background: tint(actor.tone, 15), color: actor.tone }}
                      >
                        {actor.label}
                      </span>
                    )}
                    {e.displayNo && (
                      <span className="tnum text-[11.5px] font-bold text-muted">
                        #{e.displayNo}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
