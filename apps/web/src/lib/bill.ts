/**
 * Bill arithmetic — the single definition of what a guest owes.
 *
 * Five surfaces quote a total: the POS, the captain's phone, the guest's own
 * phone, the printed bill and the reports. If any two of them round
 * differently the restaurant has an argument at the table, so all five call
 * this and nothing computes a total on its own.
 *
 * Pure: no server imports, no database. That is what lets the guest's browser
 * show a live total while the server independently recomputes the same number
 * before taking money.
 *
 * Order of operations follows an Indian restaurant bill, and reproduces the
 * reference exactly (₹502 items, 5% service, 2.5+2.5% GST → ₹553):
 *
 *   items − discount → + service charge → taxable
 *   taxable + SGST + CGST              → gross
 *   gross + round-off                  → payable
 *
 * Service charge is taxed. That is the part everyone gets wrong.
 */

export type BillCharges = {
  sgst_pct: number;
  cgst_pct: number;
  service_charge_pct: number;
  round_off_enabled: boolean;
};

export const DEFAULT_CHARGES: BillCharges = {
  sgst_pct: 2.5,
  cgst_pct: 2.5,
  service_charge_pct: 0,
  round_off_enabled: true,
};

export type BillLine = {
  qty: number;
  unit_price: number;
};

export type Bill = {
  itemTotal: number;
  discount: number;
  serviceCharge: number;
  taxable: number;
  sgst: number;
  cgst: number;
  gross: number;
  roundOff: number;
  payable: number;
};

/** Money is held to paise; every intermediate is rounded so displayed lines sum. */
function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeBill(
  lines: BillLine[],
  charges: Partial<BillCharges> = {},
  discount = 0,
): Bill {
  const c = { ...DEFAULT_CHARGES, ...charges };

  const itemTotal = money(
    lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.unit_price), 0),
  );
  // A discount can never exceed the food — a negative bill is a refund, and
  // refunds are a different flow with different authorization.
  const disc = money(Math.min(Math.max(discount, 0), itemTotal));

  const net = money(itemTotal - disc);
  const serviceCharge = money((net * c.service_charge_pct) / 100);
  const taxable = money(net + serviceCharge);

  const sgst = money((taxable * c.sgst_pct) / 100);
  const cgst = money((taxable * c.cgst_pct) / 100);
  const gross = money(taxable + sgst + cgst);

  const roundOff = c.round_off_enabled ? money(Math.round(gross) - gross) : 0;
  const payable = money(gross + roundOff);

  return { itemTotal, discount: disc, serviceCharge, taxable, sgst, cgst, gross, roundOff, payable };
}

/** ₹1,234.50 — grouped the Indian way, which Intl gets right for en-IN. */
export function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

/** ₹1,234 — for tiles and chips where paise are noise. */
export function inrShort(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

/** "34 min" / "1 h 12 m" — table age on the floor view. */
export function elapsed(sinceIso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} m`;
}
