"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CalendarClock,
  ChefHat,
  CircleCheck,
  CreditCard,
  Printer,
  Smartphone,
  Split,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { elapsed, inr, inrShort } from "@/lib/bill";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import type { BillView } from "@/lib/ops";
import {
  fireKotAction,
  settleBillAction,
  type Tender,
  type TenderMethod,
} from "@/app/org/bills/[orderId]/actions";

/**
 * The counter screen: the bill on the left, the money on the right.
 *
 * Nothing here computes a total. `view.bill` came out of computeBill() on the
 * server and the same function runs again inside settleBill() before a rupee
 * is recorded, so the number the guest is shown, the number the printer prints
 * and the number the database stores cannot drift apart.
 */

export type SettledTender = {
  id: string;
  method: string;
  amount: number;
  reference: string | null;
  /** Pre-formatted on the server — a client-side clock would hydrate differently. */
  at: string;
};

const METHOD_TILES: { key: TenderMethod; label: string; icon: typeof Banknote }[] = [
  { key: "cash", label: "Cash", icon: Banknote },
  { key: "upi", label: "UPI", icon: Smartphone },
  { key: "card", label: "Card", icon: CreditCard },
  { key: "due", label: "Due", icon: CalendarClock },
  { key: "other", label: "Other", icon: Wallet },
];

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  wallet: "Wallet",
  due: "Due",
  other: "Other",
};

/** Cash comes in notes, so the shortcuts are notes. "Exact" ends the arithmetic. */
const QUICK_NOTES = [500, 1000];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** numeric(5,2) hands back 2.50; "SGST · 2.50%" reads like a typo on a bill. */
const pct = (n: number) => `${Number(n)}%`;

/** Tolerant of what a thumb actually types into a POS: "1,200", "₹500", "". */
function toAmount(raw: string): number {
  const n = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * How long the table has been open is the only number here that moves on its
 * own, so it comes from a clock React subscribes to. The server snapshot is
 * null on purpose: both passes render no age, it appears on mount, and a table
 * that ticks over a minute mid-hydration cannot mismatch.
 */
const TICK_MS = 30_000;
const subscribeToClock = (onChange: () => void) => {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
};
const clockTick = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const noClock = () => null;

export function BillPanel({
  view,
  tenders,
  canSettle,
  printHref,
}: {
  view: BillView;
  tenders: SettledTender[];
  canSettle: boolean;
  printHref: string;
}) {
  const router = useRouter();
  const { order, lines, charges, bill } = view;
  const total = bill.payable;
  const settled = order.status === "paid";

  const [method, setMethod] = useState<TenderMethod>("cash");
  const [second, setSecond] = useState<TenderMethod>("card");
  const [split, setSplit] = useState(false);
  const [tendered, setTendered] = useState("");
  const [legA, setLegA] = useState("");
  const [legB, setLegB] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const now = useSyncExternalStore<number | null>(subscribeToClock, clockTick, noClock);

  const cashIn = toAmount(tendered);
  const change = r2(cashIn - total);
  const cashShort = !split && method === "cash" && tendered !== "" && change < -0.005;

  const legTotal = r2(toAmount(legA) + toAmount(legB));
  const gap = r2(total - legTotal);
  // Over-tendering a split is refused rather than absorbed: settleBill caps
  // each tender at the total independently, so ₹400 + ₹200 against a ₹500 bill
  // would book ₹600 of revenue. Exact is the only safe split.
  const splitReady = Math.abs(gap) <= 0.005;

  const blocked = cashShort || (split && !splitReady) || lines.length === 0;

  function payload(): Tender[] {
    if (!split) return [{ method, amount: total }];
    return [
      { method, amount: r2(toAmount(legA)) },
      { method: second, amount: r2(toAmount(legB)) },
    ].filter((t) => t.amount > 0);
  }

  function settle() {
    haptic("heavy");
    setError(null);
    setNote(null);
    start(async () => {
      const res = await settleBillAction(order.id, payload());
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      // The server component re-renders into the settled state; no local
      // "paid" flag exists to disagree with it.
      router.refresh();
    });
  }

  function kot() {
    haptic("medium");
    setError(null);
    setNote(null);
    start(async () => {
      const res = await fireKotAction(order.id);
      if (!res.ok) setError(res.error);
      else {
        setNote(res.message);
        router.refresh();
      }
    });
  }

  function print() {
    haptic("light");
    window.open(printHref, "_blank", "noopener,noreferrer,width=420,height=760");
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(330px,400px)]">
      <section className="dim overflow-hidden rounded-[var(--r-xl)]">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--line)] px-4 py-3">
          <h2 className="t-h3">
            {order.tableLabel ? `Table ${order.tableLabel}` : "Counter"}
          </h2>
          <span className="tnum rounded-full border border-[var(--line-strong)] px-2.5 py-0.5 text-[11.5px] font-extrabold">
            {order.display_no}
          </span>
          <p className="t-small ml-auto text-muted">
            <span className="tnum">{order.guest_count}</span> cover
            {order.guest_count === 1 ? "" : "s"} · {order.channel.replace(/_/g, " ")}
            {now !== null && <> · {elapsed(order.created_at, now)}</>}
          </p>
        </header>

        <table className="w-full">
          <caption className="sr-only">Items on bill {order.display_no}</caption>
          <thead>
            <tr className="t-label text-muted">
              <th scope="col" className="px-4 pb-1.5 pt-2.5 text-left">
                Item
              </th>
              <th scope="col" className="px-2 pb-1.5 pt-2.5 text-right">
                Qty
              </th>
              <th scope="col" className="px-4 pb-1.5 pt-2.5 text-right">
                Amount
              </th>
            </tr>
          </thead>

          <tbody>
            {lines.length === 0 && (
              <tr className="border-t border-[var(--line)]">
                <td colSpan={3} className="px-4 py-8 text-center text-[13.5px] text-muted">
                  Nothing has been ordered on this table yet.
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-[var(--line)]">
                <td className="px-4 py-2.5">
                  <p className="text-[14.5px] font-bold leading-tight">
                    {l.name}
                    {l.variant_name && (
                      <span className="font-semibold text-muted"> · {l.variant_name}</span>
                    )}
                  </p>
                  <p className="tnum text-[12px] text-muted">{inr(l.unit_price)} each</p>
                </td>
                <td className="tnum px-2 py-2.5 text-right align-top text-[14px] font-bold">
                  {l.qty}
                </td>
                <td className="tnum px-4 py-2.5 text-right align-top text-[14.5px] font-extrabold">
                  {inr(l.qty * l.unit_price)}
                </td>
              </tr>
            ))}
          </tbody>

          {/* The breakdown belongs to the same numeric column as the lines it
              summarises, which is exactly what <tfoot> is for. */}
          <tfoot>
            <ChargeRow label="Item total" value={bill.itemTotal} bordered />
            {bill.discount > 0 && <ChargeRow label="Discount" value={-bill.discount} />}
            {bill.serviceCharge > 0 && (
              <ChargeRow
                label={`Service charge · ${pct(charges.service_charge_pct)}`}
                value={bill.serviceCharge}
              />
            )}
            <ChargeRow label={`SGST · ${pct(charges.sgst_pct)}`} value={bill.sgst} />
            <ChargeRow label={`CGST · ${pct(charges.cgst_pct)}`} value={bill.cgst} />
            {bill.roundOff !== 0 && <ChargeRow label="Round off" value={bill.roundOff} />}
            <tr className="border-t-2 border-[var(--line-strong)]">
              <th scope="row" colSpan={2} className="px-4 py-3 text-left text-[15px] font-extrabold">
                To pay
              </th>
              <td className="tnum px-4 py-3 text-right text-[22px] font-extrabold leading-none">
                {inr(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <aside className="dim rounded-[var(--r-xl)] p-4 lg:sticky lg:top-4">
        {settled ? (
          <SettledState
            total={total}
            paid={view.paid}
            tenders={tenders}
            onPrint={print}
          />
        ) : !canSettle ? (
          <div className="space-y-3">
            <h2 className="t-h3">Bill only</h2>
            <p className="text-[13.5px] leading-relaxed text-muted">
              Your role can read this bill and print it for the table. A biller,
              manager or admin closes it.
            </p>
            <PrintButton onPrint={print} />
          </div>
        ) : (
          /* One disabled fieldset is the whole "panel is busy" state — every
             control inside it goes inert without a prop per button. */
          <fieldset disabled={pending} className="min-w-0 space-y-3.5">
            <legend className="sr-only">Take payment</legend>

            <div className="flex items-baseline gap-2">
              <h2 className="t-h3">Payment</h2>
              <span className="tnum ml-auto text-[15px] font-extrabold">{inr(total)}</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {METHOD_TILES.map((m) => (
                <MethodTile
                  key={m.key}
                  tile={m}
                  active={method === m.key}
                  onPick={() => setMethod(m.key)}
                />
              ))}
              <button
                type="button"
                aria-pressed={split}
                onPointerDown={() => haptic("light")}
                onClick={() => {
                  setSplit((s) => !s);
                  setConfirming(false);
                }}
                className={cn(
                  "press col-span-1 flex h-[62px] flex-col items-center justify-center gap-1 rounded-[var(--r-md)] border text-[12.5px] font-bold",
                  split
                    ? "raise-accent border-transparent"
                    : "glass-inset border-[var(--line)] text-ink-2",
                )}
                style={split ? { background: "var(--lime)", color: "var(--lime-ink)" } : undefined}
              >
                <Split size={19} strokeWidth={2.4} />
                Split
              </button>
            </div>

            {split ? (
              <div className="space-y-2">
                <SplitLeg
                  index={1}
                  method={method}
                  onMethod={setMethod}
                  value={legA}
                  onValue={setLegA}
                />
                <SplitLeg
                  index={2}
                  method={second}
                  onMethod={setSecond}
                  value={legB}
                  onValue={setLegB}
                  onRest={() => setLegB(String(Math.max(0, r2(total - toAmount(legA)))))}
                />
                <p
                  aria-live="polite"
                  className="glass-inset tnum flex items-center justify-between rounded-[var(--r-sm)] px-3 py-2 text-[13px] font-extrabold"
                  style={{ color: splitReady ? "var(--ok)" : "var(--danger)" }}
                >
                  <span>{splitReady ? "Covered" : gap > 0 ? "Short by" : "Over by"}</span>
                  <span>{splitReady ? inr(total) : inr(Math.abs(gap))}</span>
                </p>
              </div>
            ) : (
              method === "cash" && (
                <div className="space-y-2">
                  <label className="t-label block text-muted" htmlFor="tendered">
                    Cash tendered
                  </label>
                  <input
                    id="tendered"
                    inputMode="decimal"
                    autoComplete="off"
                    value={tendered}
                    onChange={(e) => setTendered(e.target.value)}
                    /* Ceil, not the total: nobody hands over ₹552.40 in notes. */
                    placeholder={inrShort(Math.ceil(total))}
                    className="glass-inset tnum h-12 w-full rounded-[var(--r-md)] px-3 text-[18px] font-extrabold outline-none"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    {QUICK_NOTES.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onPointerDown={() => haptic("light")}
                        onClick={() => setTendered(String(r2(cashIn + n)))}
                        className="press glass-inset tnum h-10 rounded-[var(--r-sm)] text-[13px] font-bold"
                      >
                        + {inrShort(n)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onPointerDown={() => haptic("light")}
                      onClick={() => setTendered(String(total))}
                      className="press glass-inset h-10 rounded-[var(--r-sm)] text-[13px] font-bold"
                    >
                      Exact
                    </button>
                  </div>

                  {/* Change is the number a counter gets wrong, so once there is
                      change to give it outsizes everything else on the panel. */}
                  {change > 0.005 && (
                    <div
                      aria-live="polite"
                      className="raise-accent rounded-[var(--r-md)] px-4 py-3"
                      style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
                    >
                      <p className="t-label opacity-70">Change</p>
                      <p className="tnum text-[40px] font-extrabold leading-none tracking-tight">
                        {inr(change)}
                      </p>
                    </div>
                  )}
                  {cashShort && (
                    <p
                      aria-live="polite"
                      className="glass-inset tnum flex items-center justify-between rounded-[var(--r-sm)] px-3 py-2 text-[13px] font-extrabold"
                      style={{ color: "var(--danger)" }}
                    >
                      <span>Short by</span>
                      <span>{inr(Math.abs(change))}</span>
                    </p>
                  )}
                </div>
              )
            )}

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-[var(--r-sm)] px-3 py-2 text-[13px] font-semibold glass-inset"
                style={{ color: "var(--danger)" }}
              >
                <TriangleAlert size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
            {note && (
              <p
                role="status"
                className="rounded-[var(--r-sm)] px-3 py-2 text-[13px] font-semibold glass-inset"
                style={{ color: "var(--ok)" }}
              >
                {note}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onPointerDown={() => haptic("medium")}
                onClick={kot}
                className="press glass-inset flex h-11 items-center justify-center gap-2 rounded-[var(--r-md)] text-[13.5px] font-bold"
              >
                <ChefHat size={16} strokeWidth={2.4} />
                KOT
              </button>
              <PrintButton onPrint={print} />
            </div>

            {confirming ? (
              <div className="space-y-2">
                <p className="text-center text-[13px] font-bold text-ink-2">
                  Take <span className="tnum">{inr(total)}</span> and close this table?
                </p>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <button
                    type="button"
                    onPointerDown={() => haptic("heavy")}
                    onClick={settle}
                    className="btn-lime press h-[54px] rounded-[var(--r-md)] text-[15px] font-extrabold"
                  >
                    <span className="relative z-10">
                      {pending ? "Settling…" : "Yes, settled"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onPointerDown={() => haptic("light")}
                    onClick={() => setConfirming(false)}
                    className="press glass-inset h-[54px] rounded-[var(--r-md)] px-4 text-[13.5px] font-bold text-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={blocked}
                onPointerDown={() => haptic("medium")}
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
                className="btn-lime press h-[54px] w-full rounded-[var(--r-md)] text-[15.5px] font-extrabold disabled:opacity-45"
              >
                <span className="tnum relative z-10">Settle {inr(total)}</span>
              </button>
            )}
          </fieldset>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ChargeRow({
  label,
  value,
  bordered,
}: {
  label: string;
  value: number;
  bordered?: boolean;
}) {
  return (
    <tr className={bordered ? "border-t border-[var(--line-strong)]" : undefined}>
      <th
        scope="row"
        colSpan={2}
        className="px-4 py-1 text-left text-[13px] font-semibold text-muted"
      >
        {label}
      </th>
      <td className="tnum px-4 py-1 text-right text-[13.5px] font-bold">{inr(value)}</td>
    </tr>
  );
}

function MethodTile({
  tile,
  active,
  onPick,
}: {
  tile: { key: TenderMethod; label: string; icon: typeof Banknote };
  active: boolean;
  onPick: () => void;
}) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      aria-pressed={active}
      onPointerDown={() => haptic("light")}
      onClick={onPick}
      className={cn(
        "press flex h-[62px] flex-col items-center justify-center gap-1 rounded-[var(--r-md)] border text-[12.5px] font-bold",
        active ? "raise-accent border-transparent" : "glass-inset border-[var(--line)] text-ink-2",
      )}
      style={active ? { background: "var(--lime)", color: "var(--lime-ink)" } : undefined}
    >
      <Icon size={19} strokeWidth={2.4} />
      {tile.label}
    </button>
  );
}

function SplitLeg({
  index,
  method,
  onMethod,
  value,
  onValue,
  onRest,
}: {
  index: number;
  method: TenderMethod;
  onMethod: (m: TenderMethod) => void;
  value: string;
  onValue: (v: string) => void;
  onRest?: () => void;
}) {
  const id = `split-leg-${index}`;
  return (
    <div className="glass-inset rounded-[var(--r-md)] p-2">
      <div className="flex items-center gap-2">
        <span className="tnum t-label w-4 text-muted">{index}</span>
        <select
          aria-label={`Tender ${index} method`}
          value={method}
          onChange={(e) => onMethod(e.target.value as TenderMethod)}
          className="h-9 flex-1 rounded-[var(--r-sm)] border border-[var(--line)] bg-transparent px-2 text-[13px] font-bold outline-none"
        >
          {METHOD_TILES.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={id}>
          Tender {index} amount
        </label>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          placeholder="0"
          className="tnum h-9 w-[92px] rounded-[var(--r-sm)] border border-[var(--line)] bg-transparent px-2 text-right text-[14px] font-extrabold outline-none"
        />
        {onRest && (
          <button
            type="button"
            onPointerDown={() => haptic("light")}
            onClick={onRest}
            className="press h-9 rounded-[var(--r-sm)] border border-[var(--line-strong)] px-2 text-[12px] font-bold text-muted"
          >
            Rest
          </button>
        )}
      </div>
    </div>
  );
}

function PrintButton({ onPrint }: { onPrint: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={() => haptic("light")}
      onClick={onPrint}
      className="press glass-inset flex h-11 w-full items-center justify-center gap-2 rounded-[var(--r-md)] text-[13.5px] font-bold"
    >
      <Printer size={16} strokeWidth={2.4} />
      Print
    </button>
  );
}

function SettledState({
  total,
  paid,
  tenders,
  onPrint,
}: {
  total: number;
  paid: number;
  tenders: SettledTender[];
  onPrint: () => void;
}) {
  return (
    <div className="space-y-3.5">
      <div className="flex items-center gap-2.5">
        <CircleCheck size={26} strokeWidth={2.3} style={{ color: "var(--ok)" }} />
        <div>
          <h2 className="t-h3 leading-none">Settled</h2>
          <p className="t-small text-muted">This table is closed.</p>
        </div>
      </div>

      <div className="glass-inset rounded-[var(--r-md)] px-4 py-3">
        <p className="t-label text-muted">Paid</p>
        <p className="tnum text-[34px] font-extrabold leading-none">{inr(paid || total)}</p>
      </div>

      {tenders.length > 0 && (
        <ul className="space-y-1.5">
          {tenders.map((t) => (
            <li
              key={t.id}
              className="flex items-baseline gap-2 border-b border-[var(--line)] pb-1.5 text-[13px] last:border-0"
            >
              <span className="font-bold">{METHOD_LABEL[t.method] ?? t.method}</span>
              {t.reference && <span className="text-muted">{t.reference}</span>}
              <span className="ml-auto text-muted">{t.at}</span>
              <span className="tnum w-[86px] text-right font-extrabold">{inr(t.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Deliberately the only action left: a settled bill cannot be paid twice. */}
      <PrintButton onPrint={onPrint} />
    </div>
  );
}
