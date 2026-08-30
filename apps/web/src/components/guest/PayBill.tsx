"use client";

import { useTransition, useState } from "react";
import { HandCoins, ReceiptText, ShieldCheck } from "lucide-react";
import type { GuestOrder } from "@/lib/guest";
import { computeBill, inr, type BillCharges } from "@/lib/bill";
import { callWaiterAction } from "@/app/t/[token]/actions";
import { haptic } from "@/lib/haptics";

/**
 * The bill, as the guest sees it before anyone brings a machine to the table.
 *
 * Every line here is computed by the same function the POS and the printer
 * use, so the number on this screen is the number on the paper. That is the
 * entire reason computeBill exists.
 */
export function PayBill({
  token,
  orders,
  charges,
  serviceChargeLabel,
}: {
  token: string;
  orders: GuestOrder[];
  charges: BillCharges;
  serviceChargeLabel: string;
}) {
  const [pending, start] = useTransition();
  const [asked, setAsked] = useState(false);

  const lines = orders.flatMap((o) =>
    o.items.filter((i) => i.status !== "cancelled").map((i) => ({ ...i })),
  );
  const bill = computeBill(lines, charges);

  const served = lines.length > 0 && lines.every((l) => l.status === "delivered");

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-24 text-center">
        <ReceiptText size={34} strokeWidth={1.6} className="text-[var(--lime-deep)]" />
        <p className="mt-4 text-[16px] font-extrabold">Nothing to pay for yet</p>
        <p className="mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-muted">
          Order something first — settle up once everything has reached the table.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-4">
      {!served && (
        <div
          className="flex items-start gap-3 rounded-[16px] px-4 py-3.5"
          style={{ background: "rgb(242 169 59 / 0.14)" }}
        >
          <ShieldCheck size={17} strokeWidth={2.3} style={{ color: "var(--warn)" }} className="mt-0.5 shrink-0" />
          <p className="text-[13px] font-semibold leading-snug text-ink-2">
            Hold onto your wallet until everything has reached the table — you can
            keep adding to this bill.
          </p>
        </div>
      )}

      <section className="dim overflow-hidden rounded-[var(--r-lg)]">
        <h2 className="px-4 py-3.5 text-[15px] font-extrabold">Bill summary</h2>

        <ul className="border-t border-[var(--line)]">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 border-t border-[var(--line)] px-4 py-2.5 first:border-t-0">
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                {l.name}
                {l.variant_name && (
                  <span className="ml-1 text-[11.5px] font-bold uppercase text-muted">
                    ({l.variant_name})
                  </span>
                )}
              </span>
              <span className="tnum w-6 text-right text-[13px] font-bold text-muted">{l.qty}</span>
              <span className="tnum w-20 text-right text-[14px] font-extrabold">
                {inr(l.qty * l.unit_price)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="space-y-1.5 border-t border-[var(--line-strong)] px-4 py-3.5 text-[13.5px]">
          <Row label="Item total" value={bill.itemTotal} bold />
          {bill.serviceCharge > 0 && (
            <Row label={`Service charge · ${serviceChargeLabel}`} value={bill.serviceCharge} />
          )}
          <Row label={`SGST · ${charges.sgst_pct}%`} value={bill.sgst} />
          <Row label={`CGST · ${charges.cgst_pct}%`} value={bill.cgst} />
          {bill.roundOff !== 0 && <Row label="Round off" value={bill.roundOff} />}
        </dl>

        <div
          className="flex items-center justify-between border-t border-dashed border-[var(--line-strong)] px-4 py-4"
          style={{ background: "rgb(var(--shadow-color) / 0.035)" }}
        >
          <span className="text-[15px] font-extrabold">To pay</span>
          <span className="tnum text-[22px] font-extrabold tracking-tight">{inr(bill.payable)}</span>
        </div>
      </section>

      <button
        type="button"
        disabled={pending || asked}
        onClick={() => {
          haptic("heavy");
          start(async () => {
            const res = await callWaiterAction(token, "bill");
            if (res.ok) setAsked(true);
          });
        }}
        className="press raise-accent flex h-[56px] w-full items-center justify-center gap-2.5 rounded-[16px] text-[16px] font-extrabold disabled:opacity-60"
        style={{
          background: asked
            ? "rgb(var(--shadow-color) / 0.08)"
            : "linear-gradient(180deg, var(--lime-bright), var(--lime-deep))",
          color: asked ? "var(--ink)" : "var(--lime-ink)",
        }}
      >
        <HandCoins size={19} strokeWidth={2.5} />
        {asked ? "Someone is on their way" : pending ? "Calling…" : "Ask for the bill"}
      </button>

      <p className="px-2 text-center text-[12px] leading-relaxed text-muted">
        Pay by cash, card or UPI at the table. This total already includes all taxes.
      </p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={bold ? "font-bold" : "text-muted"}>{label}</dt>
      <dd className={`tnum ${bold ? "font-extrabold" : "font-semibold text-ink-2"}`}>{inr(value)}</dd>
    </div>
  );
}
