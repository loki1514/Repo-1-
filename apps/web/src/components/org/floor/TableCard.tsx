"use client";

import Link from "next/link";
import { QrCode } from "lucide-react";
import type { TableState } from "@/lib/ops";
import { elapsed, inr } from "@/lib/bill";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

/**
 * The floor legend, in one place.
 *
 * Every state carries a word as well as a colour, because colour alone is not
 * legible here: red-green deficiency is common enough on any given roster to
 * collapse amber "printed" into green "food ready", and nobody reading the
 * board from across the room resolves a tint at all. Colour accelerates the
 * scan; the word carries the meaning.
 */
export const STATE_META: Record<
  TableState["state"],
  { label: string; tone: string; hint: string }
> = {
  blank: { label: "Blank", tone: "var(--muted)", hint: "Free to seat" },
  seated: { label: "Seated", tone: "var(--info)", hint: "Guests down, nothing ordered" },
  running: { label: "Running", tone: "var(--lime-deep)", hint: "Order open with the kitchen" },
  food_ready: { label: "Food ready", tone: "var(--ok)", hint: "Waiting to be run" },
  printed: { label: "Printed", tone: "var(--warn)", hint: "Bill out, money not in" },
  paid: { label: "Paid", tone: "var(--muted)", hint: "Settled, awaiting clear-down" },
};

export const STATE_ORDER: TableState["state"][] = [
  "blank",
  "seated",
  "running",
  "food_ready",
  "printed",
  "paid",
];

/** A wash of the state colour, light enough to leave text at full contrast. */
function tint(tone: string, pct: number): string {
  return `color-mix(in srgb, ${tone} ${pct}%, transparent)`;
}

export function TableCard({ table, now }: { table: TableState; now: number }) {
  const meta = STATE_META[table.state];
  const occupied = table.state !== "blank";
  const urgent = table.readyItems > 0;

  // Only a table with a bill on it can be opened; a seated-but-unordered table
  // has nothing to show the biller yet.
  const billHref = table.orderId ? `/org/bills/${table.orderId}` : null;

  const age = table.openedAt ? elapsed(table.openedAt, now) : null;
  const facts = [
    age,
    table.itemCount > 0 ? `${table.itemCount} item${table.itemCount === 1 ? "" : "s"}` : null,
    table.guestCount > 0 ? `${table.guestCount} cover${table.guestCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean) as string[];

  const spoken = [
    `Table ${table.label}`,
    meta.label,
    table.orderId ? inr(table.amount) : null,
    ...facts,
    urgent ? `${table.readyItems} ready to run` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li
      className={cn(
        "press relative isolate overflow-hidden rounded-[var(--r-lg)]",
        // Occupied tables are objects sitting on the floor plan; free ones are
        // holes in it. The tier of surface does that work before any colour.
        occupied ? "dim" : "glass-inset border border-[var(--line)]",
        urgent && "urgent-ring",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: occupied ? tint(meta.tone, 8) : "transparent" }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px]"
        style={{ background: meta.tone, opacity: occupied ? 1 : 0.4 }}
      />

      {/* Stretched link: the whole card is the target, which is what a thumb
          on a wall-mounted screen actually hits. */}
      {billHref && (
        <Link
          href={billHref}
          aria-label={spoken}
          onPointerDown={() => haptic("medium")}
          className="absolute inset-0 z-10 rounded-[var(--r-lg)]"
        />
      )}

      {table.qrToken && (
        <a
          href={`/t/${table.qrToken}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open the guest menu for table ${table.label} in a new tab`}
          title="Guest QR menu"
          onPointerDown={() => haptic("light")}
          className="press absolute right-1.5 top-2.5 z-20 flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-muted hover:text-ink"
        >
          <QrCode size={14} strokeWidth={2.4} />
        </a>
      )}

      <div className="relative flex flex-col gap-1.5 px-3 pb-3 pt-3">
        <div className="flex items-baseline gap-1.5 pr-8">
          <span className="truncate text-[17px] font-extrabold leading-none tracking-[-0.02em]">
            {table.label}
          </span>
          <span className="tnum shrink-0 text-[11px] font-semibold text-muted">
            {table.seats} seats
          </span>
        </div>

        <span
          className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={{ background: tint(meta.tone, 16), color: "var(--ink-2)" }}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: meta.tone }}
          />
          {meta.label}
        </span>

        {occupied ? (
          <>
            <p className="tnum text-[17px] font-extrabold leading-none tracking-[-0.02em]">
              {table.orderId ? inr(table.amount) : "No order yet"}
            </p>
            {facts.length > 0 && (
              <p className="tnum truncate text-[11.5px] font-semibold text-muted">
                {facts.join(" · ")}
              </p>
            )}
            {urgent && (
              <p
                className="tnum text-[11.5px] font-extrabold"
                style={{ color: "var(--ok)" }}
              >
                {table.readyItems} ready to run
              </p>
            )}
            {/* The PIN is what a guest reads out to join this bill from their
                own phone, so the captain needs it without opening the table. */}
            {table.pin && !urgent && (
              <p className="tnum text-[11.5px] font-semibold text-muted">PIN {table.pin}</p>
            )}
          </>
        ) : (
          <p className="text-[11.5px] font-semibold text-muted">{meta.hint}</p>
        )}
      </div>
    </li>
  );
}
