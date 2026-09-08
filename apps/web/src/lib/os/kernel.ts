import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * The OS kernel (migration 0016).
 *
 * These are the primitives every module is supposed to consume rather than
 * reinvent — Day 1 pack §6.1: "modules request work instead of implementing
 * separate task engines". Nothing in here decides *what* should happen next;
 * that is the orchestrator's job. This file only knows how to write a work
 * item, an activity, a handoff, a requirement and a notification.
 */

export type OsTeam = "sales" | "onboarding" | "customer_success" | "operations" | "platform";

export type WorkStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";

export type WorkKind =
  | "verify_organization"
  | "create_location"
  | "confirm_requirements"
  | "schedule_demo"
  | "run_demo"
  | "training"
  | "go_live_check"
  | "sales_clarification";

export type WorkItem = {
  id: string;
  kind: WorkKind;
  title: string;
  detail: string | null;
  status: WorkStatus;
  team: OsTeam;
  assigned_to: string | null;
  organization_id: string | null;
  lead_id: string | null;
  due_at: string | null;
  blocked_reason: string | null;
  origin: string;
  completed_at: string | null;
  created_at: string;
};

export type ActivityKind =
  | "created"
  | "state_changed"
  | "handoff"
  | "note"
  | "work_created"
  | "work_completed"
  | "requirement_changed";

export type Activity = {
  id: string;
  kind: ActivityKind;
  summary: string;
  detail: Record<string, unknown> | null;
  organization_id: string | null;
  lead_id: string | null;
  work_item_id: string | null;
  actor: string | null;
  actor_label: string;
  created_at: string;
};

export type RequirementStatus =
  | "captured"
  | "clarification_required"
  | "confirmed"
  | "rejected"
  | "delivered";

export type RequirementDisposition =
  | "configuration"
  | "training"
  | "process_change"
  | "product_gap"
  | "development_issue"
  | "deferred";

export type Requirement = {
  id: string;
  title: string;
  detail: string | null;
  organization_id: string | null;
  lead_id: string | null;
  source: OsTeam;
  status: RequirementStatus;
  disposition: RequirementDisposition | null;
  created_at: string;
};

export type Handoff = {
  id: string;
  from_team: OsTeam;
  to_team: OsTeam;
  organization_id: string | null;
  lead_id: string | null;
  context: Record<string, unknown>;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
};

export type OnboardingStage =
  | "new_handoff"
  | "assigned"
  | "contacted"
  | "information_pending"
  | "requirements_in_progress"
  | "requirements_confirmed"
  | "preparation"
  | "ready_for_demo"
  | "demo_done"
  | "training"
  | "ready_for_go_live"
  | "active";

const WORK_COLUMNS =
  "id, kind, title, detail, status, team, assigned_to, organization_id, lead_id, due_at, blocked_reason, origin, completed_at, created_at";

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

export type NewWorkItem = {
  kind: WorkKind;
  title: string;
  detail?: string | null;
  team: OsTeam;
  organizationId?: string | null;
  leadId?: string | null;
  dueInDays?: number | null;
  /** 'system' when the orchestrator created it; a user id when a human did. */
  origin?: string;
  createdBy?: string | null;
};

export async function createWorkItem(input: NewWorkItem): Promise<WorkItem> {
  const due =
    input.dueInDays == null
      ? null
      : new Date(Date.now() + input.dueInDays * 86_400_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("work_items")
    .insert({
      kind: input.kind,
      title: input.title,
      detail: input.detail ?? null,
      team: input.team,
      organization_id: input.organizationId ?? null,
      lead_id: input.leadId ?? null,
      due_at: due,
      origin: input.origin ?? "system",
      created_by: input.createdBy ?? null,
    })
    .select(WORK_COLUMNS)
    .single();
  if (error) throw new Error(`createWorkItem: ${error.message}`);
  return data as WorkItem;
}

export async function getWorkItem(id: string): Promise<WorkItem | null> {
  const { data, error } = await supabaseAdmin
    .from("work_items")
    .select(WORK_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getWorkItem: ${error.message}`);
  return (data as WorkItem) ?? null;
}

export async function listWorkItems(filter: {
  organizationId?: string;
  team?: OsTeam;
  openOnly?: boolean;
} = {}): Promise<WorkItem[]> {
  let q = supabaseAdmin.from("work_items").select(WORK_COLUMNS);
  if (filter.organizationId) q = q.eq("organization_id", filter.organizationId);
  if (filter.team) q = q.eq("team", filter.team);
  if (filter.openOnly) q = q.in("status", ["open", "in_progress", "blocked"]);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error(`listWorkItems: ${error.message}`);
  return (data ?? []) as WorkItem[];
}

/** Raw status write. Use the orchestrator's completeWork() to also fire the chain. */
export async function setWorkStatus(
  id: string,
  status: WorkStatus,
  actor: string | null,
  blockedReason?: string | null,
): Promise<WorkItem> {
  const patch: Record<string, unknown> = { status, blocked_reason: blockedReason ?? null };
  if (status === "done") {
    patch.completed_at = new Date().toISOString();
    patch.completed_by = actor;
  }
  const { data, error } = await supabaseAdmin
    .from("work_items")
    .update(patch)
    .eq("id", id)
    .select(WORK_COLUMNS)
    .single();
  if (error) throw new Error(`setWorkStatus: ${error.message}`);
  return data as WorkItem;
}

// ---------------------------------------------------------------------------
// Activity — append only, never updated
// ---------------------------------------------------------------------------

export async function recordActivity(input: {
  kind: ActivityKind;
  summary: string;
  detail?: Record<string, unknown> | null;
  organizationId?: string | null;
  leadId?: string | null;
  workItemId?: string | null;
  actor?: string | null;
  actorLabel?: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("activities").insert({
    kind: input.kind,
    summary: input.summary,
    detail: input.detail ?? null,
    organization_id: input.organizationId ?? null,
    lead_id: input.leadId ?? null,
    work_item_id: input.workItemId ?? null,
    actor: input.actor ?? null,
    actor_label: input.actorLabel ?? (input.actor ? "user" : "system"),
  });
  if (error) throw new Error(`recordActivity: ${error.message}`);
}

export async function listActivities(filter: {
  organizationId?: string;
  leadId?: string;
  limit?: number;
}): Promise<Activity[]> {
  let q = supabaseAdmin
    .from("activities")
    .select("id, kind, summary, detail, organization_id, lead_id, work_item_id, actor, actor_label, created_at");
  if (filter.organizationId) q = q.eq("organization_id", filter.organizationId);
  if (filter.leadId) q = q.eq("lead_id", filter.leadId);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 100);
  if (error) throw new Error(`listActivities: ${error.message}`);
  return (data ?? []) as Activity[];
}

// ---------------------------------------------------------------------------
// Handoff
// ---------------------------------------------------------------------------

export async function createHandoff(input: {
  fromTeam: OsTeam;
  toTeam: OsTeam;
  organizationId?: string | null;
  leadId?: string | null;
  context: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<Handoff> {
  const { data, error } = await supabaseAdmin
    .from("handoffs")
    .insert({
      from_team: input.fromTeam,
      to_team: input.toTeam,
      organization_id: input.organizationId ?? null,
      lead_id: input.leadId ?? null,
      context: input.context,
      created_by: input.createdBy ?? null,
    })
    .select("id, from_team, to_team, organization_id, lead_id, context, accepted_by, accepted_at, created_at")
    .single();
  if (error) throw new Error(`createHandoff: ${error.message}`);
  return data as Handoff;
}

export async function listHandoffs(organizationId: string): Promise<Handoff[]> {
  const { data, error } = await supabaseAdmin
    .from("handoffs")
    .select("id, from_team, to_team, organization_id, lead_id, context, accepted_by, accepted_at, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listHandoffs: ${error.message}`);
  return (data ?? []) as Handoff[];
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export async function createRequirement(input: {
  title: string;
  detail?: string | null;
  organizationId?: string | null;
  leadId?: string | null;
  source?: OsTeam;
  createdBy?: string | null;
}): Promise<Requirement> {
  const { data, error } = await supabaseAdmin
    .from("requirements")
    .insert({
      title: input.title.trim(),
      detail: input.detail ?? null,
      organization_id: input.organizationId ?? null,
      lead_id: input.leadId ?? null,
      source: input.source ?? "sales",
      created_by: input.createdBy ?? null,
    })
    .select("id, title, detail, organization_id, lead_id, source, status, disposition, created_at")
    .single();
  if (error) throw new Error(`createRequirement: ${error.message}`);
  return data as Requirement;
}

export async function listRequirements(organizationId: string): Promise<Requirement[]> {
  const { data, error } = await supabaseAdmin
    .from("requirements")
    .select("id, title, detail, organization_id, lead_id, source, status, disposition, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listRequirements: ${error.message}`);
  return (data ?? []) as Requirement[];
}

export async function setRequirementStatus(
  id: string,
  status: RequirementStatus,
  disposition: RequirementDisposition | null,
): Promise<Requirement> {
  const { data, error } = await supabaseAdmin
    .from("requirements")
    .update({ status, disposition })
    .eq("id", id)
    .select("id, title, detail, organization_id, lead_id, source, status, disposition, created_at")
    .single();
  if (error) throw new Error(`setRequirementStatus: ${error.message}`);
  return data as Requirement;
}

// ---------------------------------------------------------------------------
// Notifications — signals only
// ---------------------------------------------------------------------------

export async function notify(input: {
  team?: OsTeam | null;
  userId?: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("notifications").insert({
    team: input.team ?? null,
    user_id: input.userId ?? null,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  });
  if (error) throw new Error(`notify: ${error.message}`);
}

export async function listNotifications(limit = 50) {
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id, team, user_id, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listNotifications: ${error.message}`);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Onboarding stage
// ---------------------------------------------------------------------------

export async function setOnboardingStage(
  organizationId: string,
  stage: OnboardingStage,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("organizations")
    .update({ onboarding_stage: stage })
    .eq("id", organizationId);
  if (error) throw new Error(`setOnboardingStage: ${error.message}`);
}
