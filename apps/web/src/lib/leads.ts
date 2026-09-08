import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Growth: leads (migration 0011, touchpoints 1-2 only).
 *
 * Deliberately org-independent — a lead has no organization_id because it
 * doesn't have an organization yet; it produces one, later, at touchpoint 4.
 * That is also why this reads through supabaseAdmin rather than a per-user
 * session: there is no tenant row for RLS to scope against, so authorization
 * is is_platform_admin() at the action boundary, not a table policy keyed to
 * a session's own membership.
 */

export type LeadSource = "cold" | "referral" | "affiliate" | "reseller" | "inbound";
export type LeadStatus = "new" | "contacted" | "qualified" | "disqualified";

export type Lead = {
  id: string;
  business_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  source: LeadSource;
  referrer_name: string | null;
  assigned_to: string | null;
  assigned_to_email: string | null;
  status: LeadStatus;
  created_at: string;
  updated_at: string;
};

export type LeadEvent = {
  id: string;
  lead_id: string;
  from_status: LeadStatus | null;
  to_status: LeadStatus;
  note: string | null;
  actor: string | null;
  actor_email: string | null;
  created_at: string;
};

const LEAD_COLUMNS =
  "id, business_name, contact_name, contact_phone, source, referrer_name, assigned_to, status, created_at, updated_at";

/** platform_admins carries its own email column — no auth.admin lookup needed. */
async function emailsFor(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from("platform_admins")
    .select("user_id, email")
    .in("user_id", userIds);
  if (error) throw new Error(`emailsFor: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.user_id as string, r.email as string]));
}

/** An introduced lead outranks a cold one — docs/os claude .txt:432. */
const INTRODUCED = new Set<LeadSource>(["referral", "affiliate", "reseller"]);

/**
 * Every lead, newest-first within its status — the whole UI is this one
 * sorted list (docs/Gpt.txt:1698-1704: "Who do I need to speak to?" is
 * answered by a queue, not a board).
 *
 * Within a status, an introduced lead sorts above a cold one: "The lead
 * appears at the top of Tanvi's list, marked referral... referrals convert
 * at three times the rate of cold leads" (docs/os claude .txt:432).
 */
export async function listLeads(): Promise<Lead[]> {
  const { data, error } = await supabaseAdmin
    .from("leads")
    .select(LEAD_COLUMNS)
    .order("status")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listLeads: ${error.message}`);

  const rows = (data ?? []) as Omit<Lead, "assigned_to_email">[];
  // Stable within (status, created_at desc) — only the referral lift is new.
  rows.sort((a, b) => Number(INTRODUCED.has(b.source)) - Number(INTRODUCED.has(a.source)));
  const assignees = [...new Set(rows.map((r) => r.assigned_to).filter(Boolean))] as string[];
  const emailByUser = await emailsFor(assignees);

  return rows.map((r) => ({ ...r, assigned_to_email: r.assigned_to ? (emailByUser.get(r.assigned_to) ?? null) : null }));
}

/** Every platform admin, so the "assign to" picker offers real people, not a text box. */
export async function listAssignableUsers(): Promise<
  { id: string; email: string; name: string | null; role: string | null }[]
> {
  const { data, error } = await supabaseAdmin
    .from("platform_admins")
    .select("user_id, email, full_name, role")
    .order("full_name");
  if (error) throw new Error(`listAssignableUsers: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.user_id as string,
    email: r.email as string,
    name: (r.full_name as string | null) ?? null,
    role: (r.role as string | null) ?? null,
  }));
}

export type NewLead = {
  businessName: string;
  contactName?: string | null;
  contactPhone?: string | null;
  source: LeadSource;
  referrerName?: string | null;
  assignedTo?: string | null;
  createdBy: string;
};

/**
 * Creates a lead, attributed the instant it exists (docs/os claude .txt:431)
 * — there is no draft state between "someone mentioned a business" and "the
 * lead exists, tagged with where it came from."
 */
export async function createLead(input: NewLead): Promise<Lead> {
  if (!input.businessName.trim()) throw new Error("createLead: business name is required.");
  // Mirrors the leads_referrer_requires_source constraint client-side, so a
  // mismatched pair fails with a clear message instead of a bare 23514.
  const needsReferrer = input.source === "referral" || input.source === "affiliate" || input.source === "reseller";
  const referrerName = needsReferrer ? (input.referrerName?.trim() || null) : null;

  const { data, error } = await supabaseAdmin
    .from("leads")
    .insert({
      business_name: input.businessName.trim(),
      contact_name: input.contactName?.trim() || null,
      contact_phone: input.contactPhone?.trim() || null,
      source: input.source,
      referrer_name: referrerName,
      assigned_to: input.assignedTo || null,
      created_by: input.createdBy,
    })
    .select(LEAD_COLUMNS)
    .single();
  if (error) throw new Error(`createLead: ${error.message}`);

  return { ...(data as Omit<Lead, "assigned_to_email">), assigned_to_email: null };
}

/**
 * Moves a lead forward and records the move — the "six months later anyone
 * can see where it went" guarantee (docs/os claude .txt:426). The status
 * column and the event row are written together so the two can never drift.
 */
export async function advanceLead(
  leadId: string,
  toStatus: LeadStatus,
  note: string | null,
  actor: string,
): Promise<Lead> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .single();
  if (readErr) throw new Error(`advanceLead: ${readErr.message}`);

  const { data, error } = await supabaseAdmin
    .from("leads")
    .update({ status: toStatus })
    .eq("id", leadId)
    .select(LEAD_COLUMNS)
    .single();
  if (error) throw new Error(`advanceLead: ${error.message}`);

  const { error: eventErr } = await supabaseAdmin.from("lead_events").insert({
    lead_id: leadId,
    from_status: current.status,
    to_status: toStatus,
    note: note?.trim() || null,
    actor,
  });
  if (eventErr) throw new Error(`advanceLead (event): ${eventErr.message}`);

  return { ...(data as Omit<Lead, "assigned_to_email">), assigned_to_email: null };
}

/**
 * Every lead's history in one query, grouped by lead id — the audit trail
 * each row expands into. Fetched alongside the queue rather than on expand,
 * since a Day-1 lead count is small enough that one round trip beats one
 * request per row a user might open.
 */
export async function listAllLeadEvents(): Promise<Map<string, LeadEvent[]>> {
  const { data, error } = await supabaseAdmin
    .from("lead_events")
    .select("id, lead_id, from_status, to_status, note, actor, created_at")
    .order("created_at");
  if (error) throw new Error(`listAllLeadEvents: ${error.message}`);

  const rows = (data ?? []) as Omit<LeadEvent, "actor_email">[];
  const actors = [...new Set(rows.map((r) => r.actor).filter(Boolean))] as string[];
  const emailByUser = await emailsFor(actors);

  const byLead = new Map<string, LeadEvent[]>();
  for (const r of rows) {
    const withEmail = { ...r, actor_email: r.actor ? (emailByUser.get(r.actor) ?? null) : null };
    const list = byLead.get(r.lead_id) ?? [];
    list.push(withEmail);
    byLead.set(r.lead_id, list);
  }
  return byLead;
}
