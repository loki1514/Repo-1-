import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Gap 5 — payment and commission.
 *
 * "Sunita pays the annual plan on the fourteenth. In the Growth Panel the deal
 * moves to won" (docs/os claude .txt:465) and "Nikhil sees Farhan's commission
 * move from provisional to approved" (:467).
 *
 * A deal can no longer be marked won by pressing a button: a payment has to
 * exist. The commission is created the moment a referred deal is quoted —
 * provisional, not payable — and approved when the money lands, which is
 * exactly the sequence at os claude .txt:431.
 */

export type DealPaymentMethod = "upi" | "bank_transfer" | "card" | "cheque" | "cash";

export type DealPayment = {
  id: string;
  deal_id: string;
  amount: string;
  method: DealPaymentMethod;
  reference: string | null;
  received_at: string;
};

export type CommissionStatus = "provisional" | "approved" | "paid" | "void";

export type Commission = {
  id: string;
  deal_id: string;
  lead_id: string | null;
  partner_name: string;
  rate_percent: string;
  amount: string | null;
  status: CommissionStatus;
  approved_at: string | null;
  created_at: string;
};

const DEFAULT_RATE = 10;

export async function listDealPayments(dealId: string): Promise<DealPayment[]> {
  const { data, error } = await supabaseAdmin
    .from("deal_payments")
    .select("id, deal_id, amount, method, reference, received_at")
    .eq("deal_id", dealId)
    .order("received_at");
  if (error) throw new Error(`listDealPayments: ${error.message}`);
  return (data ?? []) as DealPayment[];
}

export async function totalPaid(dealId: string): Promise<number> {
  const rows = await listDealPayments(dealId);
  return rows.reduce((sum, p) => sum + Number(p.amount), 0);
}

export async function recordPayment(input: {
  dealId: string;
  amount: number;
  method: DealPaymentMethod;
  reference?: string | null;
  actor: string;
}): Promise<DealPayment> {
  if (!(input.amount > 0)) throw new Error("recordPayment: amount must be more than zero.");

  const { data, error } = await supabaseAdmin
    .from("deal_payments")
    .insert({
      deal_id: input.dealId,
      amount: input.amount,
      method: input.method,
      reference: input.reference?.trim() || null,
      recorded_by: input.actor,
    })
    .select("id, deal_id, amount, method, reference, received_at")
    .single();
  if (error) throw new Error(`recordPayment: ${error.message}`);
  return data as DealPayment;
}

/**
 * Created when a referred deal is quoted. Greyed and not payable until the
 * money arrives — the state the story describes on day zero.
 */
export async function ensureProvisionalCommission(dealId: string): Promise<Commission | null> {
  const { data: deal, error } = await supabaseAdmin
    .from("deals")
    .select("id, lead_id, quote_amount, leads(referrer_name, source)")
    .eq("id", dealId)
    .single();
  if (error) throw new Error(`ensureProvisionalCommission: ${error.message}`);

  // PostgREST returns the embedded row as an object or a single-element
  // array depending on how it infers the relationship; accept both.
  const embedded = (deal as unknown as {
    leads?: { referrer_name: string | null; source: string } | { referrer_name: string | null; source: string }[] | null;
  }).leads;
  const lead = Array.isArray(embedded) ? embedded[0] : embedded;
  if (!lead?.referrer_name) return null; // nothing to attribute

  const amount = deal.quote_amount ? (Number(deal.quote_amount) * DEFAULT_RATE) / 100 : null;

  const { data, error: upErr } = await supabaseAdmin
    .from("commissions")
    .upsert(
      {
        deal_id: dealId,
        lead_id: deal.lead_id,
        partner_name: lead.referrer_name,
        basis: lead.source,
        rate_percent: DEFAULT_RATE,
        amount,
      },
      { onConflict: "deal_id" },
    )
    .select("id, deal_id, lead_id, partner_name, rate_percent, amount, status, approved_at, created_at")
    .single();
  if (upErr) throw new Error(`ensureProvisionalCommission: ${upErr.message}`);
  return data as Commission;
}

/** Payment landed — the commission stops being provisional. */
export async function approveCommission(dealId: string): Promise<Commission | null> {
  const { data, error } = await supabaseAdmin
    .from("commissions")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("deal_id", dealId)
    .eq("status", "provisional")
    .select("id, deal_id, lead_id, partner_name, rate_percent, amount, status, approved_at, created_at")
    .maybeSingle();
  if (error) throw new Error(`approveCommission: ${error.message}`);
  return (data as Commission) ?? null;
}

export async function getCommission(dealId: string): Promise<Commission | null> {
  const { data, error } = await supabaseAdmin
    .from("commissions")
    .select("id, deal_id, lead_id, partner_name, rate_percent, amount, status, approved_at, created_at")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (error) throw new Error(`getCommission: ${error.message}`);
  return (data as Commission) ?? null;
}
