import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { approveCommission, ensureProvisionalCommission, totalPaid } from "@/lib/os/money";

/**
 * Growth: deals (migration 0012, touchpoint 3 — scoping, commercials, payment).
 *
 * A deal exists only once its lead is qualified — one deal per lead, unique
 * on lead_id, because the scoping brief is "the single most important
 * document in the deal" (docs/os claude .txt:451), not a running log.
 */

export type DealStatus = "drafting" | "quoted" | "won" | "lost";

export type Deal = {
  id: string;
  lead_id: string;
  brief: string | null;
  quote_amount: string | null;
  plan: string | null;
  status: DealStatus;
  created_at: string;
  updated_at: string;
};

export type DealEvent = {
  id: string;
  deal_id: string;
  from_status: DealStatus | null;
  to_status: DealStatus;
  note: string | null;
  actor: string | null;
  actor_email: string | null;
  created_at: string;
};

const DEAL_COLUMNS = "id, lead_id, brief, quote_amount, plan, status, created_at, updated_at";

async function emailsFor(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from("platform_admins")
    .select("user_id, email")
    .in("user_id", userIds);
  if (error) throw new Error(`emailsFor: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.user_id as string, r.email as string]));
}

/** Every deal — small enough today to fetch in full alongside the lead queue. */
export async function listDeals(): Promise<Deal[]> {
  const { data, error } = await supabaseAdmin.from("deals").select(DEAL_COLUMNS);
  if (error) throw new Error(`listDeals: ${error.message}`);
  return data ?? [];
}

/**
 * Opens the deal for a qualified lead — Omkar picking up scoping the moment
 * Tanvi marks a lead qualified (docs/os claude .txt:443). One per lead: a
 * second call on the same lead hits the unique constraint and fails loudly
 * rather than silently duplicating the brief.
 */
export async function startScoping(leadId: string, createdBy: string): Promise<Deal> {
  const { data: lead, error: leadErr } = await supabaseAdmin
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .single();
  if (leadErr) throw new Error(`startScoping: ${leadErr.message}`);
  if (lead.status !== "qualified") {
    throw new Error("startScoping: only a qualified lead can start scoping.");
  }

  const { data, error } = await supabaseAdmin
    .from("deals")
    .insert({ lead_id: leadId, created_by: createdBy })
    .select(DEAL_COLUMNS)
    .single();
  if (error) throw new Error(`startScoping: ${error.message}`);
  return data;
}

export type DealBriefInput = {
  brief?: string | null;
  quoteAmount?: number | null;
  plan?: string | null;
};

/**
 * Omkar's brief and Rahul's quote are edited in place — the document, not a
 * log of edits (docs/os claude .txt:450-456).
 */
export async function updateDealBrief(dealId: string, input: DealBriefInput): Promise<Deal> {
  const { data, error } = await supabaseAdmin
    .from("deals")
    .update({
      brief: input.brief?.trim() || null,
      quote_amount: input.quoteAmount ?? null,
      plan: input.plan?.trim() || null,
    })
    .eq("id", dealId)
    .select(DEAL_COLUMNS)
    .single();
  if (error) throw new Error(`updateDealBrief: ${error.message}`);
  return data;
}

const ALLOWED_TRANSITIONS: Record<DealStatus, DealStatus[]> = {
  drafting: ["quoted", "lost"],
  quoted: ["won", "lost"],
  won: [],
  lost: [],
};

/**
 * Moves a deal forward and records who did it — Rahul approving the quote,
 * Sunita's payment landing as won (docs/os claude .txt:456,465). Status and
 * event are written together so they never drift, the same pattern as
 * advanceLead.
 */
export async function advanceDeal(
  dealId: string,
  toStatus: DealStatus,
  note: string | null,
  actor: string,
): Promise<Deal> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from("deals")
    .select("status, quote_amount, brief")
    .eq("id", dealId)
    .single();
  if (readErr) throw new Error(`advanceDeal: ${readErr.message}`);

  const from = current.status as DealStatus;
  if (!ALLOWED_TRANSITIONS[from].includes(toStatus)) {
    throw new Error(`advanceDeal: a ${from} deal cannot move to ${toStatus}.`);
  }
  // Mirrors the deals_quote_requires_amount constraint client-side, so a
  // missing quote fails with a clear message instead of a bare 23514.
  if (toStatus === "quoted" && current.quote_amount === null) {
    throw new Error("advanceDeal: save a quote amount before approving the quote.");
  }
  // The brief is "the single most important document in the deal, because it
  // is what the platform team will configure against" (docs/os claude .txt:451)
  // — and on conversion it is what becomes the organization's requirements.
  // A quote with no scope behind it hands the next team an empty organization.
  if (toStatus === "quoted" && !current.brief?.trim()) {
    throw new Error("advanceDeal: write the scoping brief before approving the quote — it becomes the organization's requirements.");
  }
  // "Won" is a payment, not a button. A deal cannot be won until money is
  // recorded against it covering the quote (docs/os claude .txt:465).
  if (toStatus === "won") {
    const paid = await totalPaid(dealId);
    const quoted = Number(current.quote_amount ?? 0);
    if (paid <= 0) {
      throw new Error("advanceDeal: record the payment before marking this won.");
    }
    if (paid + 0.01 < quoted) {
      throw new Error(
        `advanceDeal: only ₹${paid.toLocaleString("en-IN")} of ₹${quoted.toLocaleString("en-IN")} is recorded as received.`,
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("deals")
    .update({ status: toStatus })
    .eq("id", dealId)
    .select(DEAL_COLUMNS)
    .single();
  if (error) throw new Error(`advanceDeal: ${error.message}`);

  const { error: eventErr } = await supabaseAdmin.from("deal_events").insert({
    deal_id: dealId,
    from_status: from,
    to_status: toStatus,
    note: note?.trim() || null,
    actor,
  });
  if (eventErr) throw new Error(`advanceDeal (event): ${eventErr.message}`);

  // The commission follows the deal: provisional the moment a referred deal is
  // quoted, approved the moment the payment lands (os claude .txt:431, :467).
  //
  // "won" ensures the row before approving it rather than assuming the quoted
  // transition created one — a deal that reached quoted by any other route
  // (an import, a seed, a fix-up) must still pay the partner who introduced it.
  if (toStatus === "quoted") await ensureProvisionalCommission(dealId);
  if (toStatus === "won") {
    await ensureProvisionalCommission(dealId);
    await approveCommission(dealId);
  }

  return data;
}

/** Every deal's history, grouped by deal id — same shape as listAllLeadEvents. */
export async function listAllDealEvents(): Promise<Map<string, DealEvent[]>> {
  const { data, error } = await supabaseAdmin
    .from("deal_events")
    .select("id, deal_id, from_status, to_status, note, actor, created_at")
    .order("created_at");
  if (error) throw new Error(`listAllDealEvents: ${error.message}`);

  const rows = (data ?? []) as Omit<DealEvent, "actor_email">[];
  const actors = [...new Set(rows.map((r) => r.actor).filter(Boolean))] as string[];
  const emailByUser = await emailsFor(actors);

  const byDeal = new Map<string, DealEvent[]>();
  for (const r of rows) {
    const withEmail = { ...r, actor_email: r.actor ? (emailByUser.get(r.actor) ?? null) : null };
    const list = byDeal.get(r.deal_id) ?? [];
    list.push(withEmail);
    byDeal.set(r.deal_id, list);
  }
  return byDeal;
}
