import type { Metadata } from "next";
import { requireSection } from "@/lib/platform-admin";
import { listAllLeadEvents, listAssignableUsers, listLeads } from "@/lib/leads";
import { listAllDealEvents, listDeals } from "@/lib/deals";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listConvertedOrgsByLead } from "@/lib/organizations";
import { GrowthBoard } from "@/components/admin/growth/GrowthBoard";

export const metadata: Metadata = { title: "Growth" };
// A lead's queue position and age change with every visit.
export const dynamic = "force-dynamic";

/**
 * Touchpoints 1-4: a lead exists, attributed the instant it is created; a
 * named person moves it to contacted or qualified; scoping, quote and
 * payment become a deal; a won deal becomes an organization. Everything
 * from configuration onward (touchpoint 5) is a later phase — see the Day
 * 1-3 PRD/TRD.
 */
export default async function GrowthPage() {
  await requireSection("growth");

  const [leads, assignees, eventsByLead, deals, dealEventsByDeal, convertedByLead] =
    await Promise.all([
      listLeads(),
      listAssignableUsers(),
      listAllLeadEvents(),
      listDeals(),
      listAllDealEvents(),
      listConvertedOrgsByLead(),
    ]);

  // Gap 5 — money, alongside the deals it belongs to.
  const [{ data: payments }, { data: commissions }] = await Promise.all([
    supabaseAdmin.from("deal_payments").select("deal_id, amount, method, received_at"),
    supabaseAdmin.from("commissions").select("deal_id, partner_name, amount, status"),
  ]);
  const paidByDeal: Record<string, number> = {};
  for (const p of payments ?? []) {
    paidByDeal[p.deal_id as string] = (paidByDeal[p.deal_id as string] ?? 0) + Number(p.amount);
  }
  const commissionByDeal = Object.fromEntries(
    (commissions ?? []).map((c) => [
      c.deal_id as string,
      { partner: c.partner_name as string, amount: c.amount as string | null, status: c.status as string },
    ]),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-h1">Growth</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          Every lead, attributed the instant it exists. Move one forward with a note — the
          history stays attached, so six months from now anyone can see where it went.
        </p>
      </div>
      <GrowthBoard
        leads={leads}
        assignees={assignees}
        events={Object.fromEntries(eventsByLead)}
        deals={deals}
        dealEvents={Object.fromEntries(dealEventsByDeal)}
        convertedOrgs={Object.fromEntries(convertedByLead)}
        paidByDeal={paidByDeal}
        commissionByDeal={commissionByDeal}
      />
    </div>
  );
}
