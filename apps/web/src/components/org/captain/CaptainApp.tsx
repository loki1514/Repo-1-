"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChefHat,
  ChevronDown,
  ChevronLeft,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";
import type { GuestCategory, GuestMenuItem, GuestVariant } from "@/lib/guest";
import type { TableState } from "@/lib/ops";
import { computeBill, inr, type BillCharges } from "@/lib/bill";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";
import { sendOrderAction } from "@/app/org/captain/actions";
import { TablePicker } from "./TablePicker";
import { QuickMenu, lineKey, linePrice, type CartLine } from "./QuickMenu";

type Sent = { kotNo: number; displayNo: string; tableLabel: string };

export function CaptainApp({
  orgName,
  captainName,
  tables,
  categories,
  items,
  charges,
}: {
  orgName: string;
  captainName: string;
  tables: TableState[];
  categories: GuestCategory[];
  items: GuestMenuItem[];
  charges: BillCharges;
}) {
  const router = useRouter();
  const [tableId, setTableId] = useState<string | null>(null);
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [pending, start] = useTransition();

  // Re-read by id rather than holding the row: a refresh replaces every table
  // object, and the captain would otherwise be looking at a frozen amount.
  const table = useMemo(
    () => tables.find((t) => t.id === tableId) ?? null,
    [tables, tableId],
  );

  // The floor moves under the captain while they stand at the pass. Refreshed
  // only on the picker — a refresh mid-order would repaint the menu for no
  // reason, and the cart is client state either way.
  useEffect(() => {
    if (tableId) return;
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [tableId, router]);

  const lines = useMemo(() => [...cart.values()], [cart]);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  // The captain gets asked "how much is that?" mid-order, so the bar quotes the
  // same arithmetic the printed bill will use rather than a bare item sum.
  const bill = computeBill(
    lines.map((l) => ({ qty: l.qty, unit_price: linePrice(l) })),
    charges,
  );

  function add(item: GuestMenuItem, variant: GuestVariant | null) {
    setError(null);
    const key = lineKey(item.id, variant?.id);
    setCart((prev) => {
      const next = new Map(prev);
      const line = next.get(key);
      next.set(key, line ? { ...line, qty: line.qty + 1 } : { key, item, variant, qty: 1 });
      return next;
    });
  }

  function step(key: string, delta: number) {
    setCart((prev) => {
      const next = new Map(prev);
      const line = next.get(key);
      if (!line) return prev;
      const qty = line.qty + delta;
      if (qty <= 0) next.delete(key);
      else next.set(key, { ...line, qty });
      return next;
    });
  }

  function send() {
    if (!table || lines.length === 0) return;
    haptic("heavy");
    setError(null);
    start(async () => {
      const res = await sendOrderAction(
        table.id,
        lines.map((l) => ({
          menu_item_id: l.item.id,
          variant_id: l.variant?.id ?? null,
          qty: l.qty,
        })),
      );
      if (!res.ok) {
        haptic("warn");
        setError(res.error);
        return;
      }
      haptic("success");
      setCart(new Map());
      setReviewing(false);
      setSent({ kotNo: res.kotNo, displayNo: res.displayNo, tableLabel: table.label });
      router.refresh();
    });
  }

  function backToFloor() {
    setTableId(null);
    setCart(new Map());
    setReviewing(false);
    setError(null);
    setSent(null);
  }

  return (
    <div className="mx-auto max-w-lg pb-[132px]">
      <header className="dim mt-4 flex items-center gap-3 rounded-[var(--r-lg)] px-3 py-2.5">
        {table && !sent && (
          <button
            type="button"
            aria-label="Back to the floor"
            onClick={() => {
              haptic("light");
              backToFloor();
            }}
            className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--r-md)] text-ink-2"
          >
            <ChevronLeft size={22} strokeWidth={2.6} />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold leading-tight">{captainName}</p>
          <p className="truncate text-[12px] font-semibold text-muted">{orgName} · Captain</p>
        </div>

        {table && (
          <div className="shrink-0 text-right">
            <p className="t-label text-muted">Table {table.label}</p>
            {table.pin ? (
              // Guests ask the captain for the PIN constantly — it is the only
              // way the rest of the party joins the same bill from their phones.
              <p
                className="tnum mt-0.5 rounded-[var(--r-sm)] px-2 py-0.5 text-[13.5px] font-extrabold"
                style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
              >
                PIN {table.pin}
              </p>
            ) : (
              <p className="mt-0.5 text-[12px] font-semibold text-muted">No guest session</p>
            )}
          </div>
        )}
      </header>

      <div className="mt-4">
        {sent ? (
          <SentPanel
            sent={sent}
            onAddMore={() => {
              haptic("medium");
              setSent(null);
            }}
            onAnotherTable={() => {
              haptic("light");
              backToFloor();
            }}
          />
        ) : table ? (
          <QuickMenu
            categories={categories}
            items={items}
            cart={cart}
            onAdd={add}
            onStep={step}
          />
        ) : (
          <TablePicker tables={tables} selectedId={tableId} onPick={(t) => setTableId(t.id)} />
        )}
      </div>

      {/* The send bar owns the bottom of the screen — the one thing that must
          always be under the thumb, wherever the menu is scrolled to. */}
      {table && !sent && (
        <div className="fixed inset-x-0 bottom-0 z-30 lg:left-[248px]">
          <div className="mx-auto max-w-lg px-4">
            {reviewing && lines.length > 0 && (
              <div className="dim raise scroll-thin max-h-[46vh] overflow-y-auto rounded-t-[var(--r-lg)]">
                <div className="flex items-center gap-2 px-4 py-2.5">
                  <h2 className="text-[14px] font-extrabold">This round</h2>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("medium");
                      setCart(new Map());
                      setReviewing(false);
                    }}
                    className="press ml-auto inline-flex h-9 items-center gap-1.5 text-[12.5px] font-bold text-muted"
                  >
                    <Trash2 size={14} strokeWidth={2.4} /> Clear
                  </button>
                </div>
                <ul>
                  {lines.map((l) => (
                    <li
                      key={l.key}
                      className="flex items-center gap-2.5 border-t border-[var(--line)] px-4 py-2"
                    >
                      <span className={`food-mark food-mark-${l.item.food_type}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold leading-tight">
                          {l.item.name}
                        </span>
                        <span className="tnum block text-[12px] font-semibold text-muted">
                          {l.variant ? `${l.variant.name} · ` : ""}
                          {inr(linePrice(l))}
                        </span>
                      </span>
                      <span className="flex h-12 items-center rounded-[var(--r-md)] border border-[var(--line-strong)]">
                        <button
                          type="button"
                          aria-label={`One less ${l.item.name}`}
                          onClick={() => {
                            haptic("light");
                            step(l.key, -1);
                          }}
                          className="press flex h-12 w-12 items-center justify-center"
                        >
                          <Minus size={15} strokeWidth={3} />
                        </button>
                        <span className="tnum w-7 text-center text-[14px] font-extrabold">
                          {l.qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`One more ${l.item.name}`}
                          onClick={() => {
                            haptic("light");
                            step(l.key, 1);
                          }}
                          className="press flex h-12 w-12 items-center justify-center"
                        >
                          <Plus size={15} strokeWidth={3} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div
              className={cn(
                "dim raise pb-safe px-3 pb-3 pt-2.5",
                reviewing && lines.length > 0
                  ? "rounded-none border-t-0"
                  : "rounded-t-[var(--r-lg)]",
              )}
            >
              {error && (
                <p
                  role="alert"
                  className="mb-2 flex items-start gap-2 rounded-[var(--r-sm)] px-3 py-2 text-[13px] font-semibold leading-snug"
                  style={{
                    background: "color-mix(in srgb, var(--danger) 14%, transparent)",
                    color: "var(--danger)",
                  }}
                >
                  <AlertTriangle size={15} strokeWidth={2.6} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={lines.length === 0}
                  aria-expanded={reviewing}
                  onClick={() => {
                    haptic("light");
                    setReviewing((v) => !v);
                  }}
                  className="press flex h-14 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--r-md)] px-1 text-left disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="tnum block text-[13px] font-bold leading-tight text-muted">
                      {count === 0 ? "Nothing added yet" : `${count} item${count === 1 ? "" : "s"}`}
                    </span>
                    <span className="tnum block text-[17px] font-extrabold leading-tight">
                      {inr(bill.itemTotal)}
                    </span>
                  </span>
                  {lines.length > 0 && (
                    <ChevronDown
                      size={17}
                      strokeWidth={2.6}
                      aria-hidden
                      className={cn("shrink-0 text-muted transition-transform", reviewing && "rotate-180")}
                    />
                  )}
                </button>

                <button
                  type="button"
                  disabled={pending || lines.length === 0}
                  onClick={send}
                  className="press raise-accent flex h-14 shrink-0 items-center gap-2 rounded-[var(--r-md)] px-5 text-[15.5px] font-extrabold disabled:opacity-45"
                  style={{
                    background: "linear-gradient(180deg, var(--lime-bright), var(--lime-deep))",
                    color: "var(--lime-ink)",
                  }}
                >
                  <ChefHat size={18} strokeWidth={2.5} />
                  {pending ? "Sending…" : "Send to kitchen"}
                </button>
              </div>

              {bill.payable > bill.itemTotal && (
                <p className="tnum mt-1.5 px-1 text-[11.5px] font-semibold text-muted">
                  {inr(bill.payable)} with taxes and charges
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The KOT number is the receipt of the whole interaction — it is what the
 * captain repeats to the kitchen when something goes missing, so it is the
 * largest thing on the screen.
 */
function SentPanel({
  sent,
  onAddMore,
  onAnotherTable,
}: {
  sent: Sent;
  onAddMore: () => void;
  onAnotherTable: () => void;
}) {
  return (
    <div className="dim ticket-in rounded-[var(--r-xl)] px-5 py-7 text-center">
      <ChefHat size={26} strokeWidth={1.9} className="mx-auto" style={{ color: "var(--lime-deep)" }} />
      <p className="t-label mt-3 text-muted">On the pass · Table {sent.tableLabel}</p>
      <p className="tnum t-h1 mt-1">KOT #{sent.kotNo}</p>
      <p className="tnum mt-1 text-[13px] font-semibold text-muted">{sent.displayNo}</p>

      {/* A captain almost never walks away after one round — the next tap is
          nearly always "and a plate of..." from the same table. */}
      <button
        type="button"
        onClick={onAddMore}
        className="press raise-accent mt-6 h-14 w-full rounded-[var(--r-md)] text-[15.5px] font-extrabold"
        style={{
          background: "linear-gradient(180deg, var(--lime-bright), var(--lime-deep))",
          color: "var(--lime-ink)",
        }}
      >
        Add more to this table
      </button>
      <button
        type="button"
        onClick={onAnotherTable}
        className="press dim mt-2.5 h-14 w-full rounded-[var(--r-md)] text-[15px] font-bold text-ink-2"
      >
        Pick another table
      </button>
    </div>
  );
}
