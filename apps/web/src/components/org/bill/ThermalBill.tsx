"use client";

import { useEffect, useRef } from "react";
import { inr } from "@/lib/bill";
import type { BillView } from "@/lib/ops";
import { logBillPrintAction } from "@/app/org/bills/[orderId]/actions";

/**
 * The 80mm thermal receipt.
 *
 * THIS FILE IS THE ONE PLACE IN THE APP THAT USES LITERAL BLACK AND WHITE.
 * A thermal head burns dots into paper: it has no colour, no greys and no
 * dark mode. Painting this in --ink would print whatever the *operator's*
 * theme happened to be — a pale grey in dark mode, i.e. an unreadable bill —
 * so the token system is deliberately switched off here and only here.
 *
 * The file is a Client Component solely because <AutoPrint> needs an effect;
 * the receipt itself is inert markup and takes everything it renders as props.
 */

const CSS = `
@page { size: 80mm auto; margin: 0; }

.vini-roll {
  width: 80mm;
  margin: 24px auto;
  padding: 5mm 4mm 8mm;
  background: #fff;
  color: #000;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.45;
  letter-spacing: -0.01em;
  /* Antialiasing is a screen luxury; a 203dpi head wants hard edges. */
  -webkit-font-smoothing: none;
  box-shadow: 0 10px 40px -12px rgb(0 0 0 / 0.45);
}
.vini-roll p { margin: 0; }
.vini-roll .c { text-align: center; }
.vini-roll .b { font-weight: 700; }
.vini-roll .shout { font-size: 14px; font-weight: 700; letter-spacing: 0.06em; }
.vini-roll .quiet { font-size: 10px; }
.vini-roll .rule { border-top: 1px dashed #000; margin: 2mm 0; }
.vini-roll .rule-heavy { border-top: 2px solid #000; margin: 2mm 0; }
.vini-roll .row { display: flex; justify-content: space-between; gap: 3mm; }
.vini-roll .row > span:last-child { text-align: right; white-space: nowrap; }
.vini-roll table { width: 100%; border-collapse: collapse; }
.vini-roll th, .vini-roll td { padding: 0.5mm 0; vertical-align: top; text-align: left; }
.vini-roll th { font-weight: 700; }
.vini-roll .qty { width: 9mm; text-align: right; white-space: nowrap; }
.vini-roll .amt { width: 21mm; text-align: right; white-space: nowrap; }
.vini-roll .total { font-size: 15px; font-weight: 800; letter-spacing: 0.02em; }

@media print {
  /*
   * This route lives inside the /org shell — sidebar, top bar and aurora — and
   * that layout is not ours to edit. Hiding everything and revealing only the
   * roll is therefore done here. visibility (not display) is used so the roll
   * keeps its own box and the browser still paginates it correctly.
   */
  body * { visibility: hidden !important; }
  .vini-roll, .vini-roll * { visibility: visible !important; }
  /* The grain overlay is a pseudo-element on <body>, so it survives the rule
     above and would print as a haze of dots across the roll. */
  body::after { display: none !important; }
  /* Every ancestor between <body> and the roll is flattened, so the roll
     starts at the page origin instead of inside the app's content gutters. */
  body :has(.vini-roll) {
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
  }
  .vini-roll {
    position: absolute;
    top: 0;
    left: 0;
    margin: 0;
    padding: 3mm 4mm 6mm;
    box-shadow: none;
  }
  html, body { background: #fff !important; }
}
`;

const METHOD_LABEL: Record<string, string> = {
  cash: "CASH",
  upi: "UPI",
  card: "CARD",
  wallet: "WALLET",
  due: "DUE",
  other: "OTHER",
};

const pct = (n: number) => `${Number(n)}%`;

export function ThermalBill({
  view,
  orgName,
  billedAt,
  tenders,
}: {
  view: BillView;
  /** Falls back for outlets that have not filled in a legal name yet. */
  orgName: string;
  /** Formatted on the server so the roll cannot hydrate to a different clock. */
  billedAt: string;
  tenders: { id: string; method: string; amount: number }[];
}) {
  const { order, lines, charges, bill, outlet } = view;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="vini-roll">
        <p className="c shout">{outlet.legal_name ?? orgName}</p>
        {outlet.address && <p className="c quiet">{outlet.address}</p>}
        {outlet.phone && <p className="c quiet">Ph {outlet.phone}</p>}
        {outlet.gstin && <p className="c quiet">GSTIN {outlet.gstin}</p>}
        {outlet.fssai && <p className="c quiet">FSSAI {outlet.fssai}</p>}

        <div className="rule" />

        <div className="row">
          <span>Bill</span>
          <span className="b">{order.display_no}</span>
        </div>
        <div className="row">
          <span>Date</span>
          <span>{billedAt}</span>
        </div>
        <div className="row">
          <span>{order.tableLabel ? "Table" : "Channel"}</span>
          <span>{order.tableLabel ?? order.channel.replace(/_/g, " ")}</span>
        </div>
        <div className="row">
          <span>Covers</span>
          <span>{order.guest_count}</span>
        </div>
        {order.customer_name && (
          <div className="row">
            <span>Guest</span>
            <span>{order.customer_name}</span>
          </div>
        )}

        <div className="rule" />

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="qty">Qty</th>
              <th className="amt">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.name}
                  {l.variant_name ? ` (${l.variant_name})` : ""}
                </td>
                <td className="qty">{l.qty}</td>
                <td className="amt">{inr(l.qty * l.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="rule" />

        <div className="row">
          <span>Item total</span>
          <span>{inr(bill.itemTotal)}</span>
        </div>
        {bill.discount > 0 && (
          <div className="row">
            <span>Discount</span>
            <span>{inr(-bill.discount)}</span>
          </div>
        )}
        {bill.serviceCharge > 0 && (
          <div className="row">
            <span>Service charge · {pct(charges.service_charge_pct)}</span>
            <span>{inr(bill.serviceCharge)}</span>
          </div>
        )}
        <div className="row">
          <span>SGST · {pct(charges.sgst_pct)}</span>
          <span>{inr(bill.sgst)}</span>
        </div>
        <div className="row">
          <span>CGST · {pct(charges.cgst_pct)}</span>
          <span>{inr(bill.cgst)}</span>
        </div>
        {bill.roundOff !== 0 && (
          <div className="row">
            <span>Round off</span>
            <span>{inr(bill.roundOff)}</span>
          </div>
        )}

        <div className="rule-heavy" />
        <div className="row total">
          <span>TOTAL</span>
          <span>{inr(bill.payable)}</span>
        </div>
        <div className="rule-heavy" />

        {tenders.length > 0 ? (
          tenders.map((t) => (
            <div className="row" key={t.id}>
              <span className="b">{METHOD_LABEL[t.method] ?? t.method.toUpperCase()}</span>
              <span className="b">{inr(t.amount)}</span>
            </div>
          ))
        ) : (
          /* Printing before payment is normal — the guest asks for the bill and
             pays against it. Saying so out loud stops this slip being filed as
             a receipt. */
          <p className="c b">*** NOT SETTLED ***</p>
        )}

        <div className="rule" />

        {outlet.footer_note && <p className="c">{outlet.footer_note}</p>}
        <p className="c quiet">Powered by Vini POS</p>
      </div>
    </>
  );
}

/**
 * Sends the roll to the printer the moment the window opens — the only reason
 * this route exists.
 *
 * The ref guard has no matching cleanup on purpose: React's development
 * double-invoke would otherwise cancel the one scheduled print and the dialog
 * would never appear while developing. The short delay lets the 80mm layout
 * settle before the browser snapshots it.
 */
export function AutoPrint({ orderId }: { orderId: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    window.setTimeout(() => {
      window.print();
      void logBillPrintAction(orderId);
    }, 250);
  }, [orderId]);

  return null;
}
