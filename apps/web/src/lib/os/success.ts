import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Customer Success (migration 0020) — Day 3 of the PRD pack.
 *
 * Everything here hangs off an organization and the requirements already
 * carried into it, so Customer Success operates on the same OS primitives
 * rather than becoming "a separate CRM island" (Day 3 PRD, opening principle).
 */

export type DiscoverySession = {
  id: string;
  organization_id: string;
  objective: string;
  participants: string | null;
  scheduled_for: string | null;
  held_at: string | null;
  decisions: string | null;
  open_questions: string | null;
  customer_confirmed: boolean;
  created_at: string;
};

export type DemoPlan = {
  id: string;
  organization_id: string;
  scheduled_for: string | null;
  participants: string | null;
  held_at: string | null;
};

export type DemoPlanItem = {
  id: string;
  demo_plan_id: string;
  requirement_id: string | null;
  title: string;
  screen: string | null;
  success_criteria: string | null;
  position: number;
  covered: boolean;
};

export type FeedbackDisposition =
  | "configuration" | "training" | "process_change"
  | "product_gap" | "development_issue" | "accepted" | "deferred";

export type Feedback = {
  id: string;
  organization_id: string;
  requirement_id: string | null;
  body: string;
  said_by: string | null;
  screen: string | null;
  disposition: FeedbackDisposition | null;
  resolved: boolean;
  created_at: string;
};

export type TrainingRecord = {
  id: string;
  organization_id: string;
  person_name: string;
  role_label: string | null;
  topics: string | null;
  completed: boolean;
  completed_at: string | null;
};

export type ReadinessCheck = {
  id: string;
  organization_id: string;
  item: string;
  passed: boolean;
  note: string | null;
  checked_at: string | null;
  position: number;
};

// ---------------------------------------------------------------------------
// Discovery — §7
// ---------------------------------------------------------------------------

export async function listDiscoverySessions(orgId: string): Promise<DiscoverySession[]> {
  const { data, error } = await supabaseAdmin
    .from("discovery_sessions")
    .select("id, organization_id, objective, participants, scheduled_for, held_at, decisions, open_questions, customer_confirmed, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listDiscoverySessions: ${error.message}`);
  return (data ?? []) as DiscoverySession[];
}

export async function createDiscoverySession(input: {
  organizationId: string;
  objective: string;
  participants?: string | null;
  owner: string;
}): Promise<DiscoverySession> {
  const { data, error } = await supabaseAdmin
    .from("discovery_sessions")
    .insert({
      organization_id: input.organizationId,
      objective: input.objective.trim(),
      participants: input.participants?.trim() || null,
      owner: input.owner,
    })
    .select("id, organization_id, objective, participants, scheduled_for, held_at, decisions, open_questions, customer_confirmed, created_at")
    .single();
  if (error) throw new Error(`createDiscoverySession: ${error.message}`);
  return data as DiscoverySession;
}

export async function recordDiscoveryOutcome(input: {
  sessionId: string;
  decisions: string;
  openQuestions: string;
  customerConfirmed: boolean;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("discovery_sessions")
    .update({
      decisions: input.decisions.trim() || null,
      open_questions: input.openQuestions.trim() || null,
      customer_confirmed: input.customerConfirmed,
      held_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId);
  if (error) throw new Error(`recordDiscoveryOutcome: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Demo plan — §9. Built FROM confirmed requirements.
// ---------------------------------------------------------------------------

export async function getDemoPlan(orgId: string): Promise<DemoPlan | null> {
  const { data, error } = await supabaseAdmin
    .from("demo_plans")
    .select("id, organization_id, scheduled_for, participants, held_at")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`getDemoPlan: ${error.message}`);
  return (data as DemoPlan) ?? null;
}

export async function listDemoPlanItems(planId: string): Promise<DemoPlanItem[]> {
  const { data, error } = await supabaseAdmin
    .from("demo_plan_items")
    .select("id, demo_plan_id, requirement_id, title, screen, success_criteria, position, covered")
    .eq("demo_plan_id", planId)
    .order("position");
  if (error) throw new Error(`listDemoPlanItems: ${error.message}`);
  return (data ?? []) as DemoPlanItem[];
}

/** Which product screen proves a requirement. Deliberately a small, honest map. */
function screenFor(title: string): string {
  const t = title.toLowerCase();
  if (/table|zone|floor|seat/.test(t)) return "Floor";
  if (/kitchen|kot|tandoor|pass/.test(t)) return "Kitchen display";
  if (/bill|pos|payment|counter|invoice/.test(t)) return "POS billing";
  if (/menu|thali|price|bundle|dish/.test(t)) return "Menu items";
  if (/inventory|stock|purchase/.test(t)) return "Inventory";
  if (/delivery|one latur|swiggy|zomato/.test(t)) return "Channels & delivery";
  if (/reservation|booking/.test(t)) return "Reservations";
  if (/franchise|outlet|group|finance/.test(t)) return "Organization & locations";
  if (/staff|role|access|captain/.test(t)) return "Users & roles";
  return "Overview";
}

/**
 * Generates the plan from the requirements that Customer Success actually
 * confirmed — never from every requirement, and never from a feature list.
 */
export async function buildDemoPlanFromRequirements(
  orgId: string,
  owner: string,
): Promise<{ plan: DemoPlan; items: DemoPlanItem[]; skipped: number }> {
  const { data: reqs, error: reqErr } = await supabaseAdmin
    .from("requirements")
    .select("id, title, status, disposition")
    .eq("organization_id", orgId)
    .order("created_at");
  if (reqErr) throw new Error(`buildDemoPlan: ${reqErr.message}`);

  const confirmed = (reqs ?? []).filter((r) => r.status === "confirmed");
  if (confirmed.length === 0) {
    throw new Error("buildDemoPlan: no confirmed requirements yet — validate them first.");
  }
  // A product gap cannot be demonstrated; it is shown as a gap, not a feature.
  const demoable = confirmed.filter((r) => r.disposition !== "product_gap");
  const skipped = confirmed.length - demoable.length;

  const existing = await getDemoPlan(orgId);
  let planId: string = existing?.id ?? "";
  if (!planId) {
    const { data, error } = await supabaseAdmin
      .from("demo_plans")
      .insert({ organization_id: orgId, owner })
      .select("id, organization_id, scheduled_for, participants, held_at")
      .single();
    if (error) throw new Error(`buildDemoPlan: ${error.message}`);
    planId = data.id;
  }

  await supabaseAdmin.from("demo_plan_items").delete().eq("demo_plan_id", planId);

  const rows = demoable.map((r, i) => ({
    demo_plan_id: planId,
    requirement_id: r.id,
    title: r.title,
    screen: screenFor(r.title),
    success_criteria: `The customer agrees this is what they meant by “${r.title.slice(0, 60)}”.`,
    position: i + 1,
  }));
  const { error: insErr } = await supabaseAdmin.from("demo_plan_items").insert(rows);
  if (insErr) throw new Error(`buildDemoPlan: ${insErr.message}`);

  const plan = (await getDemoPlan(orgId))!;
  return { plan, items: await listDemoPlanItems(planId), skipped };
}

export async function setDemoItemCovered(itemId: string, covered: boolean): Promise<void> {
  const { error } = await supabaseAdmin
    .from("demo_plan_items")
    .update({ covered })
    .eq("id", itemId);
  if (error) throw new Error(`setDemoItemCovered: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Feedback — §10
// ---------------------------------------------------------------------------

export async function listFeedback(orgId: string): Promise<Feedback[]> {
  const { data, error } = await supabaseAdmin
    .from("feedback")
    .select("id, organization_id, requirement_id, body, said_by, screen, disposition, resolved, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listFeedback: ${error.message}`);
  return (data ?? []) as Feedback[];
}

export async function captureFeedback(input: {
  organizationId: string;
  body: string;
  saidBy?: string | null;
  screen?: string | null;
  createdBy: string;
}): Promise<Feedback> {
  const { data, error } = await supabaseAdmin
    .from("feedback")
    .insert({
      organization_id: input.organizationId,
      body: input.body.trim(),
      said_by: input.saidBy?.trim() || null,
      screen: input.screen?.trim() || null,
      created_by: input.createdBy,
    })
    .select("id, organization_id, requirement_id, body, said_by, screen, disposition, resolved, created_at")
    .single();
  if (error) throw new Error(`captureFeedback: ${error.message}`);
  return data as Feedback;
}

export async function disposeFeedback(
  id: string,
  disposition: FeedbackDisposition,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("feedback")
    .update({ disposition, resolved: disposition === "accepted" || disposition === "deferred" })
    .eq("id", id);
  if (error) throw new Error(`disposeFeedback: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Training — §11
// ---------------------------------------------------------------------------

export async function listTraining(orgId: string): Promise<TrainingRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("training_records")
    .select("id, organization_id, person_name, role_label, topics, completed, completed_at")
    .eq("organization_id", orgId)
    .order("created_at");
  if (error) throw new Error(`listTraining: ${error.message}`);
  return (data ?? []) as TrainingRecord[];
}

export async function addTrainee(input: {
  organizationId: string;
  personName: string;
  roleLabel?: string | null;
  topics?: string | null;
  createdBy: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("training_records").insert({
    organization_id: input.organizationId,
    person_name: input.personName.trim(),
    role_label: input.roleLabel?.trim() || null,
    topics: input.topics?.trim() || null,
    created_by: input.createdBy,
  });
  if (error) throw new Error(`addTrainee: ${error.message}`);
}

export async function setTrainingComplete(id: string, completed: boolean): Promise<void> {
  const { error } = await supabaseAdmin
    .from("training_records")
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error(`setTrainingComplete: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Readiness — §12
// ---------------------------------------------------------------------------

export async function listReadiness(orgId: string): Promise<ReadinessCheck[]> {
  const { data, error } = await supabaseAdmin
    .from("readiness_checks")
    .select("id, organization_id, item, passed, note, checked_at, position")
    .eq("organization_id", orgId)
    .order("position");
  if (error) throw new Error(`listReadiness: ${error.message}`);
  return (data ?? []) as ReadinessCheck[];
}

export async function ensureReadiness(orgId: string): Promise<ReadinessCheck[]> {
  const existing = await listReadiness(orgId);
  if (existing.length > 0) return existing;
  const { error } = await supabaseAdmin.rpc("seed_readiness", { p_org: orgId });
  if (error) throw new Error(`ensureReadiness: ${error.message}`);
  return listReadiness(orgId);
}

export async function setReadinessItem(
  id: string,
  passed: boolean,
  actor: string,
  note?: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("readiness_checks")
    .update({
      passed,
      note: note?.trim() || null,
      checked_by: actor,
      checked_at: passed ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(`setReadinessItem: ${error.message}`);
}

/** The portfolio view — every organization Customer Success is carrying. */
export type PortfolioRow = {
  id: string;
  name: string;
  stage: string | null;
  status: string;
  openWork: number;
  overdue: number;
  unvalidatedRequirements: number;
  openFeedback: number;
  readinessPassed: number;
  readinessTotal: number;
  risk: "ok" | "watch" | "at_risk";
};

export async function listPortfolio(): Promise<PortfolioRow[]> {
  const { data: orgs, error } = await supabaseAdmin
    .from("organizations")
    .select("id, name, status, onboarding_stage")
    .not("onboarding_stage", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listPortfolio: ${error.message}`);
  if (!orgs?.length) return [];

  const ids = orgs.map((o) => o.id as string);
  const [work, reqs, fb, ready] = await Promise.all([
    supabaseAdmin.from("work_items").select("organization_id, status, due_at").in("organization_id", ids),
    supabaseAdmin.from("requirements").select("organization_id, status").in("organization_id", ids),
    supabaseAdmin.from("feedback").select("organization_id, resolved").in("organization_id", ids),
    supabaseAdmin.from("readiness_checks").select("organization_id, passed").in("organization_id", ids),
  ]);

  const now = Date.now();
  return orgs.map((o) => {
    const id = o.id as string;
    const w = (work.data ?? []).filter((x) => x.organization_id === id);
    const openWork = w.filter((x) => x.status === "open" || x.status === "in_progress" || x.status === "blocked").length;
    const overdue = w.filter(
      (x) => (x.status === "open" || x.status === "in_progress") && x.due_at && new Date(x.due_at).getTime() < now,
    ).length;
    const unvalidated = (reqs.data ?? []).filter(
      (r) => r.organization_id === id && (r.status === "captured" || r.status === "clarification_required"),
    ).length;
    const openFeedback = (fb.data ?? []).filter((f) => f.organization_id === id && !f.resolved).length;
    const rd = (ready.data ?? []).filter((r) => r.organization_id === id);

    const risk: PortfolioRow["risk"] =
      overdue > 0 ? "at_risk" : unvalidated > 0 || openFeedback > 0 ? "watch" : "ok";

    return {
      id,
      name: o.name as string,
      stage: (o.onboarding_stage as string | null) ?? null,
      status: o.status as string,
      openWork,
      overdue,
      unvalidatedRequirements: unvalidated,
      openFeedback,
      readinessPassed: rd.filter((r) => r.passed).length,
      readinessTotal: rd.length,
      risk,
    };
  });
}
