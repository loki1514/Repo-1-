"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Brush,
  CircleHelp,
  CupSoda,
  Home,
  Minus,
  Plus,
  Receipt,
  RotateCcw,
  ShoppingCart,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import type {
  GuestCategory,
  GuestMenuItem,
  GuestOrder,
  GuestSession,
  GuestTable,
  GuestVariant,
} from "@/lib/guest";
import { computeBill, inr, type BillCharges } from "@/lib/bill";
import { callWaiterAction, placeOrderAction } from "@/app/t/[token]/actions";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";
import { MenuBrowser } from "./MenuBrowser";
import { MyOrders } from "./MyOrders";
import { PayBill } from "./PayBill";
import { lineKey, linePrice, type CartLine } from "./types";

type View = "menu" | "waiter" | "repeat" | "orders" | "bill";

const NAV: { id: View; label: string; icon: typeof Home }[] = [
  { id: "menu", label: "Menu", icon: Home },
  { id: "waiter", label: "Call Waiter", icon: Bell },
  { id: "repeat", label: "Repeat", icon: RotateCcw },
  { id: "orders", label: "My Orders", icon: ShoppingCart },
  { id: "bill", label: "Pay Bill", icon: Receipt },
];

export function GuestApp({
  token,
  table,
  session,
  categories,
  items,
  orders,
  charges,
}: {
  token: string;
  table: GuestTable;
  session: GuestSession;
  categories: GuestCategory[];
  items: GuestMenuItem[];
  orders: GuestOrder[];
  charges: BillCharges;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("menu");
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const headerRef = useRef<HTMLElement>(null);

  // The sticky sub-tabs need to sit exactly under the header, which is a
  // different height on a notched phone than in a desktop preview. Measured
  // rather than guessed.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () =>
      document.documentElement.style.setProperty(
        "--guest-header-h",
        `${el.getBoundingClientRect().height}px`,
      );
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The kitchen is moving while the guest reads. A quiet refresh keeps the
  // dish states honest without ever yanking the scroll position.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const cartLines = useMemo(() => [...cart.values()], [cart]);
  const cartCount = cartLines.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cartLines.reduce((s, l) => s + l.qty * linePrice(l), 0);

  function add(item: GuestMenuItem, variant: GuestVariant | null) {
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

  function placeOrder() {
    haptic("heavy");
    start(async () => {
      const res = await placeOrderAction(
        token,
        cartLines.map((l) => ({
          menu_item_id: l.item.id,
          variant_id: l.variant?.id ?? null,
          qty: l.qty,
        })),
      );
      if (!res.ok) {
        setToast(res.error);
        return;
      }
      setCart(new Map());
      setCartOpen(false);
      setView("orders");
      setToast(`Order ${res.displayNo} sent to the kitchen`);
      router.refresh();
    });
  }

  /** "Repeat" re-stocks the cart from the last order rather than firing blind. */
  function repeatLast() {
    const last = orders[orders.length - 1];
    if (!last) {
      setToast("Nothing to repeat yet.");
      setView("menu");
      return;
    }
    const byId = new Map(items.map((i) => [i.id, i]));
    const next = new Map<string, CartLine>();
    for (const l of last.items) {
      const item = [...byId.values()].find((i) => i.name === l.name);
      if (!item) continue;
      const variant = item.variants.find((v) => v.name === l.variant_name) ?? null;
      const key = lineKey(item.id, variant?.id);
      const existing = next.get(key);
      next.set(key, existing ? { ...existing, qty: existing.qty + l.qty } : { key, item, variant, qty: l.qty });
    }
    if (next.size === 0) {
      setToast("Those dishes are off the menu right now.");
      setView("menu");
      return;
    }
    setCart(next);
    setView("menu");
    setCartOpen(true);
    haptic("success");
  }

  const lastOrder = orders[orders.length - 1];
  const serviceLabel = `${charges.service_charge_pct}%`;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      {/* Restaurant band */}
      <header
        ref={headerRef}
        className="sticky top-0 z-30 px-4 pb-2.5 pt-[max(env(safe-area-inset-top),10px)]"
        style={{ background: "var(--lime-deep)", color: "var(--lime-ink)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[17px] font-extrabold"
            style={{ background: "rgb(255 255 255 / 0.92)", color: "var(--lime-deep)" }}
          >
            {table.orgName.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-extrabold leading-tight">
              {table.orgName}
            </p>
            <p className="truncate text-[12px] font-semibold opacity-85">
              {lastOrder
                ? `Last order ${new Date(lastOrder.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
                : table.areaName ?? "Dine in"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-extrabold uppercase tracking-wide opacity-85">
              Table {table.label}
            </p>
            <p
              className="tnum mt-0.5 rounded-[7px] px-2 py-0.5 text-[13px] font-extrabold"
              style={{ background: "rgb(255 255 255 / 0.9)", color: "var(--lime-deep)" }}
            >
              PIN {session.pin}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pb-[132px]">
        {view === "menu" && (
          <MenuBrowser
            categories={categories}
            items={items}
            cart={cart}
            onAdd={add}
            onStep={step}
            pin={session.pin}
          />
        )}
        {view === "orders" && <MyOrders orders={orders} />}
        {view === "bill" && (
          <PayBill token={token} orders={orders} charges={charges} serviceChargeLabel={serviceLabel} />
        )}
        {view === "waiter" && (
          <CallWaiter
            token={token}
            onDone={(msg) => {
              setToast(msg);
              setView("menu");
            }}
          />
        )}
        {view === "repeat" && <RepeatGate onRun={repeatLast} lastOrder={lastOrder} />}
      </main>

      {/* Cart bar — only when there is something in it. */}
      {cartCount > 0 && !cartOpen && (
        <button
          type="button"
          onClick={() => {
            haptic("medium");
            setCartOpen(true);
          }}
          className="press raise-accent fixed inset-x-4 bottom-[86px] z-30 mx-auto flex max-w-[480px] items-center gap-3 rounded-[16px] px-4 py-3.5"
          style={{
            background: "linear-gradient(180deg, var(--lime-bright), var(--lime-deep))",
            color: "var(--lime-ink)",
          }}
        >
          <ShoppingCart size={18} strokeWidth={2.6} />
          <span className="tnum text-[14px] font-extrabold">
            {cartCount} item{cartCount === 1 ? "" : "s"}
          </span>
          <span className="tnum ml-auto text-[16px] font-extrabold">{inr(cartTotal)}</span>
          <span className="text-[14px] font-extrabold">View cart</span>
        </button>
      )}

      {/* Bottom navigation */}
      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--canvas)]/95 backdrop-blur-xl"
        aria-label="Table"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = view === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  haptic("light");
                  if (n.id === "repeat") repeatLast();
                  else setView(n.id);
                }}
                aria-current={active ? "page" : undefined}
                className="press relative flex flex-col items-center gap-1 py-2.5"
              >
                <span
                  className={cn(
                    "flex h-8 w-12 items-center justify-center rounded-[11px] transition-colors",
                    active && "raise-accent",
                  )}
                  style={active ? { background: "var(--lime)", color: "var(--lime-ink)" } : undefined}
                >
                  <Icon size={18} strokeWidth={2.3} className={active ? "" : "text-muted"} />
                </span>
                <span
                  className={cn(
                    "text-[10.5px] font-bold leading-none",
                    active ? "text-ink" : "text-muted",
                  )}
                >
                  {n.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {cartOpen && (
        <CartSheet
          lines={cartLines}
          charges={charges}
          busy={pending}
          onStep={step}
          onClear={() => {
            setCart(new Map());
            setCartOpen(false);
          }}
          onClose={() => setCartOpen(false)}
          onPlace={placeOrder}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fade-in raise fixed inset-x-4 bottom-[152px] z-40 mx-auto max-w-[480px] rounded-[14px] px-4 py-3 text-center text-[13.5px] font-bold"
          style={{ background: "#14170f", color: "#fff" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CartSheet({
  lines,
  charges,
  busy,
  onStep,
  onClear,
  onClose,
  onPlace,
}: {
  lines: CartLine[];
  charges: BillCharges;
  busy: boolean;
  onStep: (key: string, delta: number) => void;
  onClear: () => void;
  onClose: () => void;
  onPlace: () => void;
}) {
  // Guests are shown the all-in number before they commit, not a subtotal that
  // grows on the printed bill.
  const bill = computeBill(
    lines.map((l) => ({ qty: l.qty, unit_price: linePrice(l) })),
    charges,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-label="Your cart">
      <button aria-label="Close cart" className="fade-in absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="sheet-up dim relative flex max-h-[86vh] w-full flex-col rounded-t-[26px] pt-3">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--line-strong)]" />

        <div className="flex items-center gap-2 px-4 pb-3">
          <h2 className="text-[17px] font-extrabold">Your order</h2>
          <button
            type="button"
            onClick={onClear}
            className="press ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted"
          >
            <Trash2 size={13} strokeWidth={2.4} /> Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press flex h-8 w-8 items-center justify-center rounded-full text-muted"
          >
            <X size={17} strokeWidth={2.6} />
          </button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--line)]">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
              <span className={`food-mark food-mark-${l.item.food_type}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-bold leading-tight">{l.item.name}</p>
                <p className="tnum text-[12.5px] text-muted">
                  {l.variant ? `${l.variant.name} · ` : ""}
                  {inr(linePrice(l))}
                </p>
              </div>
              <div className="flex h-8 items-center gap-1 rounded-[10px] border border-[var(--line-strong)] px-1">
                <button
                  type="button"
                  aria-label="One less"
                  onClick={() => {
                    haptic("light");
                    onStep(l.key, -1);
                  }}
                  className="press flex h-6 w-6 items-center justify-center"
                >
                  <Minus size={13} strokeWidth={3} />
                </button>
                <span className="tnum w-5 text-center text-[13.5px] font-extrabold">{l.qty}</span>
                <button
                  type="button"
                  aria-label="One more"
                  onClick={() => {
                    haptic("light");
                    onStep(l.key, 1);
                  }}
                  className="press flex h-6 w-6 items-center justify-center"
                >
                  <Plus size={13} strokeWidth={3} />
                </button>
              </div>
              <span className="tnum w-[68px] shrink-0 text-right text-[14px] font-extrabold">
                {inr(l.qty * linePrice(l))}
              </span>
            </li>
          ))}
        </ul>

        <div className="pb-safe px-4 pb-4 pt-3">
          <dl className="space-y-1 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted">Item total</dt>
              <dd className="tnum font-bold">{inr(bill.itemTotal)}</dd>
            </div>
            {bill.serviceCharge > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">Service charge</dt>
                <dd className="tnum font-bold">{inr(bill.serviceCharge)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted">Taxes</dt>
              <dd className="tnum font-bold">{inr(bill.sgst + bill.cgst)}</dd>
            </div>
          </dl>

          <button
            type="button"
            disabled={busy || lines.length === 0}
            onClick={onPlace}
            className="press raise-accent mt-3 flex h-[56px] w-full items-center justify-center gap-3 rounded-[16px] text-[16px] font-extrabold disabled:opacity-60"
            style={{
              background: "linear-gradient(180deg, var(--lime-bright), var(--lime-deep))",
              color: "var(--lime-ink)",
            }}
          >
            {busy ? "Sending to the kitchen…" : "Place order"}
            {!busy && <span className="tnum">· {inr(bill.payable)}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const HELP = [
  { kind: "water", label: "Water", icon: CupSoda },
  { kind: "cutlery", label: "Cutlery", icon: Utensils },
  { kind: "clean_up", label: "Clean Up", icon: Brush },
  { kind: "assistance", label: "Others", icon: CircleHelp },
] as const;

function CallWaiter({
  token,
  onDone,
}: {
  token: string;
  onDone: (msg: string) => void;
}) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<string | null>(null);

  return (
    <div className="py-6">
      <h2 className="text-[19px] font-extrabold">What do you need?</h2>
      <p className="mt-1 text-[13.5px] text-muted">
        Someone will come by — no need to wave.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {HELP.map((h) => {
          const Icon = h.icon;
          return (
            <button
              key={h.kind}
              type="button"
              disabled={pending}
              onClick={() => {
                haptic("medium");
                setSent(h.kind);
                start(async () => {
                  const res = await callWaiterAction(token, h.kind);
                  onDone(res.ok ? `${h.label} — on the way` : "Could not reach the floor. Try again.");
                });
              }}
              className={cn(
                "dim press flex aspect-[4/3] flex-col items-center justify-center gap-2.5 rounded-[18px]",
                sent === h.kind && "raise-accent",
              )}
              style={sent === h.kind ? { background: "var(--lime)", color: "var(--lime-ink)" } : undefined}
            >
              <Icon size={26} strokeWidth={1.9} />
              <span className="text-[14px] font-extrabold">{h.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RepeatGate({ onRun, lastOrder }: { onRun: () => void; lastOrder?: GuestOrder }) {
  return (
    <div className="flex flex-col items-center px-6 py-24 text-center">
      <RotateCcw size={32} strokeWidth={1.7} className="text-[var(--lime-deep)]" />
      <p className="mt-4 text-[16px] font-extrabold">
        {lastOrder ? "Order the same again" : "Nothing to repeat yet"}
      </p>
      <p className="mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-muted">
        {lastOrder
          ? "We'll fill your cart with your last round so you can adjust before sending it."
          : "Once you've ordered once, this brings it straight back."}
      </p>
      {lastOrder && (
        <button
          type="button"
          onClick={onRun}
          className="press raise-accent mt-6 h-12 rounded-[14px] px-6 text-[15px] font-extrabold"
          style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
        >
          Fill my cart
        </button>
      )}
    </div>
  );
}
