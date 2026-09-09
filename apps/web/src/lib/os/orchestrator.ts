import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createOrganization, type OrgType } from "@/lib/organizations";
import {
  createHandoff,
  createRequirement,
  createWorkItem,
  getWorkItem,
  listRequirements,
  notify,
  recordActivity,
  setOnboardingStage,
  setWorkStatus,
  type OnboardingStage,
  type OsTeam,
  type RequirementDisposition,
  type RequirementStatus,
  type WorkItem,
  type WorkKind,
} from "./kernel";

/**
 * The orchestrator — the part that makes this an OS rather than five tables.
 *
 * Day 1 pack §7: "The OS should be designed around work orchestration, not
 * around screens... Sales converts a lead -> transaction commits conversion
 * -> an onboarding work item is created -> receiving team is notified ->
 * timeline records the handoff -> receiving team completes the next action ->
 * the next work item is created."
 *
 * Everything below is that sentence, executable. No screen encodes any of it
 * (Day 1 §6.4: "Do not allow UI code to encode business workflow").
 */

// ---------------------------------------------------------------------------
// The chain. Completing one work item produces the next one — this table is
// the whole workflow definition, and it is data, not control flow.
// ---------------------------------------------------------------------------

type ChainLink = {
  next: WorkKind | null;
  nextTeam: OsTeam;
  nextTitle: string;
  nextDetail: string;
  dueInDays: number;
  /** Stage the organization moves to when THIS item completes. */
  stage: OnboardingStage;
  /** When set, completing this item also transfers responsibility. */
  handoff?: { from: OsTeam; to: OsTeam };
};

const CHAIN: Record<WorkKind, ChainLink> = {
  verify_organization: {
    next: "create_location",
    nextTeam: "onboarding",
    nextTitle: "Create the first location",
    nextDetail: "The organization is verified. Give it its first operating location.",
    dueInDays: 1,
    stage: "contacted",
  },
  create_location: {
    next: "confirm_requirements",
    nextTeam: "customer_success",
    nextTitle: "Confirm what the customer actually needs",
    nextDetail:
      "Requirements were carried from the scoping brief as captured. Validate each one with the customer.",
    dueInDays: 2,
    stage: "requirements_in_progress",
    handoff: { from: "onboarding", to: "customer_success" },
  },
  confirm_requirements: {
    next: "schedule_demo",
    nextTeam: "customer_success",
    nextTitle: "Schedule the demo on their own organization",
    nextDetail: "Requirements are confirmed. Book the demo against the customer's own configured org.",
    dueInDays: 3,
    stage: "requirements_confirmed",
  },
  schedule_demo: {
    next: "run_demo",
    nextTeam: "customer_success",
    nextTitle: "Run the demo and capture feedback",
    nextDetail: "Walk the customer's own journey on their own data. Capture every reaction as feedback.",
    dueInDays: 5,
    stage: "ready_for_demo",
  },
  run_demo: {
    next: "training",
    nextTeam: "customer_success",
    nextTitle: "Train the people who will use it daily",
    nextDetail: "Each role is handed their own screen and asked to do the thing they do every day.",
    dueInDays: 7,
    stage: "demo_done",
  },
  training: {
    next: "go_live_check",
    nextTeam: "operations",
    nextTitle: "Go-live readiness check",
    nextDetail: "Data isolation, audit trail, GST fields, and a live-operations watch for the first service.",
    dueInDays: 9,
    stage: "training",
    handoff: { from: "customer_success", to: "operations" },
  },
  go_live_check: {
    next: null,
    nextTeam: "operations",
    nextTitle: "",
    nextDetail: "",
    dueInDays: 0,
    stage: "active",
  },
  sales_clarification: {
    next: null,
    nextTeam: "sales",
    nextTitle: "",
    nextDetail: "",
    dueInDays: 0,
    stage: "information_pending",
  },
};

const STAGE_LABEL: Record<OnboardingStage, string> = {
  new_handoff: "New handoff",
  assigned: "Assigned",
  contacted: "Contacted",
  information_pending: "Information pending",
  requirements_in_progress: "Requirements in progress",
  requirements_confirmed: "Requirements confirmed",
  preparation: "Preparation",
  ready_for_demo: "Ready for demo",
  demo_done: "Demo done",
  training: "Training",
  ready_for_go_live: "Ready for go-live",
  active: "Active",
};

// ---------------------------------------------------------------------------
// Conversion — the single human action that starts everything
// ---------------------------------------------------------------------------

export type ConversionResult = {
  organizationId: string;
  organizationName: string;
  adminEmail: string;
  adminPassword: string;
  /** Everything the OS did on its own, in order, for the caller to show. */
  cascade: string[];
};

/**
 * Sales converts a won deal. One human action; the OS does the rest.
 *
 * This is the use case Day 1 §5.5 specifies end to end: customer/org created,
 * commercial status recorded, requirements carried forward, an onboarding work
 * item created and assigned, and a handoff activity recorded.
 */
export async function convertLeadToOrganization(input: {
  leadId: string;
  name: string;
  type: OrgType;
  adminEmail: string;
  adminPassword: string;
  contactEmail?: string;
  contactPhone?: string;
  legalName?: string;
  gstin?: string;
  actor: string;
}): Promise<ConversionResult> {
  const cascade: string[] = [];

  // --- the lead and its deal, for the context the handoff must carry --------
  const { data: lead, error: leadErr } = await supabaseAdmin
    .from("leads")
    .select("id, business_name, contact_name, contact_phone, source, referrer_name, status")
    .eq("id", input.leadId)
    .single();
  if (leadErr) throw new Error(`convertLead: ${leadErr.message}`);

  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id, brief, quote_amount, plan, status")
    .eq("lead_id", input.leadId)
    .maybeSingle();

  if (deal && deal.status !== "won") {
    throw new Error("convertLead: this deal is not won yet — take the payment first.");
  }

  // A previous attempt can leave an organization row behind if the admin login
  // could not be created (createOrganization inserts the org first, on purpose,
  // so a failure is recoverable rather than orphaning an auth user). Without
  // this check the retry fails on the unique source_lead_id index with a raw
  // duplicate-key error, which tells the operator nothing useful.
  const { data: already } = await supabaseAdmin
    .from("organizations")
    .select("id, name")
    .eq("source_lead_id", input.leadId)
    .maybeSingle();
  if (already) {
    throw new Error(
      `convertLead: this lead already became "${already.name}". Open that organization instead of converting again.`,
    );
  }

  // --- 1. the organization -------------------------------------------------
  const { organization, admin } = await createOrganization({
    name: input.name,
    type: input.type,
    adminEmail: input.adminEmail,
    adminPassword: input.adminPassword,
    // The customer should not have to repeat information already captured
    // during Sales (Day 2 §1) — so carry the lead's contact through.
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone || (lead.contact_phone ?? undefined),
    legalName: input.legalName,
    gstin: input.gstin,
    sourceLeadId: input.leadId,
  });
  cascade.push(`Organization "${organization.name}" created, linked to the lead it came from`);

  const orgId = organization.id;

  // --- 1b. the customer, as a person distinct from the organization --------
  // Day 1 pack §6.2: "Customer identity and organization identity must be
  // separate concepts: a person can interact with multiple organizations."
  // Sunita is matched on phone so a second business she owns reuses her
  // record rather than duplicating her.
  if (lead.contact_name?.trim()) {
    const phone = lead.contact_phone?.trim() || null;
    const existing = phone
      ? await supabaseAdmin.from("customers").select("id").eq("phone", phone).maybeSingle()
      : { data: null };

    let customerId = existing.data?.id as string | undefined;
    if (!customerId) {
      const { data: created, error: custErr } = await supabaseAdmin
        .from("customers")
        .insert({
          full_name: lead.contact_name.trim(),
          phone,
          created_by: input.actor,
        })
        .select("id")
        .single();
      if (custErr) throw new Error(`convertLead (customer): ${custErr.message}`);
      customerId = created.id as string;
      cascade.push(`Customer "${lead.contact_name.trim()}" created as a person, separate from the business`);
    } else {
      cascade.push(`Matched to the existing customer "${lead.contact_name.trim()}" — one person, several businesses`);
    }

    await supabaseAdmin
      .from("customer_organizations")
      .upsert(
        { customer_id: customerId, organization_id: orgId, relation: "owner" },
        { onConflict: "customer_id,organization_id,relation" },
      );
    await supabaseAdmin.from("leads").update({ customer_id: customerId }).eq("id", input.leadId);
  }

  // --- 2. onboarding lifecycle starts --------------------------------------
  await setOnboardingStage(orgId, "new_handoff");
  cascade.push("Onboarding opened at stage “New handoff”");

  // --- 3. requirements carried forward from the scoping brief --------------
  const requirementLines = splitBriefIntoRequirements(deal?.brief ?? null);
  for (const line of requirementLines) {
    await createRequirement({
      title: line,
      organizationId: orgId,
      leadId: input.leadId,
      source: "sales",
      createdBy: input.actor,
    });
  }
  if (requirementLines.length > 0) {
    cascade.push(
      `${requirementLines.length} requirement${requirementLines.length === 1 ? "" : "s"} carried from the scoping brief, marked “captured”`,
    );
  }

  // --- 4. the handoff, carrying the Day 2 §11 contract as data -------------
  await createHandoff({
    fromTeam: "sales",
    toTeam: "onboarding",
    organizationId: orgId,
    leadId: input.leadId,
    createdBy: input.actor,
    context: {
      customer_identity: lead.contact_name,
      business_identity: lead.business_name,
      contact_phone: lead.contact_phone,
      source: lead.source,
      referred_by: lead.referrer_name,
      commercial_status: deal ? deal.status : "no deal recorded",
      quote_amount: deal?.quote_amount ?? null,
      plan: deal?.plan ?? null,
      requirements_captured: requirementLines,
      scoping_brief: deal?.brief ?? null,
      sales_owner: input.actor,
    },
  });
  cascade.push("Handoff Sales → Onboarding recorded, carrying the full sales context");

  // --- 5. the first work item, assigned to a queue -------------------------
  const first = await createWorkItem({
    kind: "verify_organization",
    title: "Verify the organization and its owner",
    detail: "Confirm the business details Sales captured, and who the primary owner is.",
    team: "onboarding",
    organizationId: orgId,
    leadId: input.leadId,
    dueInDays: 1,
    origin: "system",
  });
  cascade.push(`Work item “${first.title}” created and queued to Onboarding, due in 1 day`);

  // --- 6. signals ----------------------------------------------------------
  await notify({
    team: "onboarding",
    title: `New organization to onboard: ${organization.name}`,
    body: "Converted from a won deal. Sales context is already attached.",
    link: `/admin/organizations/${orgId}`,
  });
  cascade.push("Onboarding queue notified");

  // --- 7. timeline, on both sides -----------------------------------------
  await recordActivity({
    kind: "handoff",
    summary: `Converted from lead — handed to Onboarding`,
    detail: { lead_id: input.leadId, deal_id: deal?.id ?? null },
    organizationId: orgId,
    leadId: input.leadId,
    actor: input.actor,
    actorLabel: "user",
  });
  await recordActivity({
    kind: "work_created",
    summary: `Work item created: ${first.title}`,
    organizationId: orgId,
    workItemId: first.id,
    actorLabel: "system",
  });
  cascade.push("Timeline entries written on both the lead and the organization");

  return {
    organizationId: orgId,
    organizationName: organization.name,
    adminEmail: admin.email,
    adminPassword: admin.password,
    cascade,
  };
}

/**
 * A brief is prose. Requirements are things someone must act on. Splitting on
 * sentence/segment boundaries is a deliberately dumb first pass: it keeps the
 * source text verbatim and lets Customer Success correct it, which is the
 * rule requirements are supposed to follow (Day 2 §8 — source and history are
 * retained, interpretation is never silently replaced).
 */
function splitBriefIntoRequirements(brief: string | null): string[] {
  if (!brief?.trim()) return [];
  return brief
    .split(/[.;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Completing work — where the chain actually advances
// ---------------------------------------------------------------------------

export type CompletionResult = {
  completed: WorkItem;
  cascade: string[];
};

// ---------------------------------------------------------------------------
// Gap 1 — completion requires evidence, not assertion
//
// Each kind below names what must exist before it can be ticked. A kind absent
// from this table needs nothing beyond the tick; a kind present here is
// refused until the proof is on the record.
// ---------------------------------------------------------------------------

type Gate = {
  /** work_evidence.kind that must be present, if any. */
  evidence?: string;
  /** Human-readable refusal, shown verbatim to whoever pressed the button. */
  message: string;
  /** Extra check against the rest of the database. */
  check?: (item: WorkItem) => Promise<string | null>;
};

const GATES: Partial<Record<WorkKind, Gate>> = {
  verify_organization: {
    evidence: "verification",
    message:
      "Record the verification first — who the owner is and that the business details were confirmed.",
  },
  create_location: {
    message: "Add at least one location before completing this.",
    check: async (item) => {
      if (!item.organization_id) return null;
      const { count, error } = await supabaseAdmin
        .from("locations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", item.organization_id);
      if (error) throw new Error(`gate(create_location): ${error.message}`);
      return (count ?? 0) > 0 ? null : "This organization has no locations yet.";
    },
  },
  confirm_requirements: {
    message: "Every requirement needs a decision before this can be completed.",
    check: async (item) => {
      if (!item.organization_id) return null;
      const { data, error } = await supabaseAdmin
        .from("requirements")
        .select("status")
        .eq("organization_id", item.organization_id);
      if (error) throw new Error(`gate(confirm_requirements): ${error.message}`);
      const open = (data ?? []).filter(
        (r) => r.status === "captured" || r.status === "clarification_required",
      ).length;
      return open === 0
        ? null
        : `${open} requirement${open === 1 ? " is" : "s are"} still unvalidated — confirm or reject each one.`;
    },
  },
  schedule_demo: {
    evidence: "demo_scheduled",
    message: "Record the demo date and who is attending before completing this.",
  },
  run_demo: {
    evidence: "demo_feedback",
    message:
      "Capture what the customer said during the demo — at least one piece of feedback — before completing this.",
  },
  training: {
    evidence: "training",
    message: "Record who was trained, and on what, before completing this.",
  },
  go_live_check: {
    evidence: "readiness",
    message: "Complete the readiness checklist before declaring the organization live.",
  },
};

/** What a work item still needs before it can be completed, or null if ready. */
export async function completionBlocker(item: WorkItem): Promise<string | null> {
  const gate = GATES[item.kind];
  if (!gate) return null;

  if (gate.evidence) {
    const { count, error } = await supabaseAdmin
      .from("work_evidence")
      .select("id", { count: "exact", head: true })
      .eq("work_item_id", item.id)
      .eq("kind", gate.evidence);
    if (error) throw new Error(`completionBlocker: ${error.message}`);
    if ((count ?? 0) === 0) return gate.message;
  }

  if (gate.check) {
    const problem = await gate.check(item);
    if (problem) return `${problem} ${gate.message}`;
  }

  return null;
}

/** Which evidence kind a work item expects, for the screen to collect it. */
export function evidenceKindFor(kind: WorkKind): string | null {
  return GATES[kind]?.evidence ?? null;
}

/**
 * Complete a work item and let the OS decide what happens next: advance the
 * onboarding stage, transfer responsibility if the chain says so, create the
 * next work item, notify its queue, and record all of it.
 *
 * No caller decides what comes next. That is the point.
 */
export async function completeWork(workItemId: string, actor: string): Promise<CompletionResult> {
  const item = await getWorkItem(workItemId);
  if (!item) throw new Error("completeWork: no such work item.");
  if (item.status === "done") throw new Error("completeWork: already completed.");

  // Gap 1 — the chain does not advance on assertion.
  const blocker = await completionBlocker(item);
  if (blocker) throw new Error(`completeWork: ${blocker}`);

  const cascade: string[] = [];
  const link = CHAIN[item.kind];

  // Gap 4 — one transaction. This function decides what should happen; the
  // database applies all of it or none of it. A failure part-way can no longer
  // leave a completed item with no successor.
  let handoffPayload: Record<string, unknown> | null = null;
  if (link?.handoff && item.organization_id) {
    const reqs = await listRequirements(item.organization_id);
    handoffPayload = {
      from: link.handoff.from,
      to: link.handoff.to,
      context: {
        trigger: item.title,
        requirements: reqs.map((r) => ({ title: r.title, status: r.status, disposition: r.disposition })),
        open_requirements: reqs.filter((r) => r.status !== "confirmed").length,
      },
    };
  }

  const nextPayload =
    link?.next != null
      ? {
          kind: link.next,
          title: link.nextTitle,
          detail: link.nextDetail,
          team: link.nextTeam,
          due_days: link.dueInDays,
        }
      : null;

  const { error } = await supabaseAdmin.rpc("apply_work_completion", {
    p_work_id: workItemId,
    p_actor: actor,
    p_stage: link && item.organization_id ? link.stage : null,
    p_next: nextPayload,
    p_handoff: handoffPayload,
    p_make_active: Boolean(link && !link.next && link.stage === "active"),
  });
  if (error) throw new Error(`completeWork: ${error.message}`);

  if (link && item.organization_id) {
    cascade.push(`Onboarding stage advanced to “${STAGE_LABEL[link.stage]}”`);
  }
  if (handoffPayload && link?.handoff) {
    cascade.push(
      `Responsibility handed ${teamLabel(link.handoff.from)} → ${teamLabel(link.handoff.to)}, with the requirement list attached`,
    );
  }
  if (nextPayload && link) {
    cascade.push(`Next work item “${link.nextTitle}” created and queued to ${teamLabel(link.nextTeam)}`);
    cascade.push(`${teamLabel(link.nextTeam)} notified`);
  } else if (link && link.stage === "active") {
    cascade.push("Organization moved to Active — the chain is complete");
  }
  cascade.push("All of the above committed in one transaction");

  const done = await getWorkItem(workItemId);
  return { completed: done ?? item, cascade };
}

// ---------------------------------------------------------------------------
// Gap 2 + 6 — requirement validation, and the branch back to Sales
// ---------------------------------------------------------------------------

export type RequirementDecision = {
  requirementId: string;
  status: RequirementStatus;
  disposition?: RequirementDisposition | null;
  note?: string | null;
  actor: string;
};

/**
 * Customer Success deciding what a requirement actually is. Day 3 §8: the
 * progression is recorded rather than replacing what Sales originally heard.
 *
 * Marking one "clarification required" is the OS's only backward branch: it
 * routes a question back to Sales as real work, because the person who heard
 * it first is the one who can answer (Day 2 §12, 11:00 — Rahul).
 */
export async function decideRequirement(input: RequirementDecision): Promise<string[]> {
  const cascade: string[] = [];

  const { data: current, error: readErr } = await supabaseAdmin
    .from("requirements")
    .select("id, title, status, organization_id, lead_id")
    .eq("id", input.requirementId)
    .single();
  if (readErr) throw new Error(`decideRequirement: ${readErr.message}`);

  const { error: updErr } = await supabaseAdmin
    .from("requirements")
    .update({ status: input.status, disposition: input.disposition ?? null })
    .eq("id", input.requirementId);
  if (updErr) throw new Error(`decideRequirement: ${updErr.message}`);

  const { error: evErr } = await supabaseAdmin.from("requirement_events").insert({
    requirement_id: input.requirementId,
    from_status: current.status,
    to_status: input.status,
    disposition: input.disposition ?? null,
    note: input.note?.trim() || null,
    actor: input.actor,
  });
  if (evErr) throw new Error(`decideRequirement (event): ${evErr.message}`);

  await recordActivity({
    kind: "requirement_changed",
    summary: `Requirement “${current.title}” → ${input.status.replace(/_/g, " ")}${
      input.disposition ? ` (${input.disposition.replace(/_/g, " ")})` : ""
    }`,
    organizationId: current.organization_id,
    leadId: current.lead_id,
    actor: input.actor,
    actorLabel: "user",
  });
  cascade.push(`Recorded — the original wording and who changed it are both kept`);

  // The backward branch.
  if (input.status === "clarification_required") {
    const existing = await supabaseAdmin
      .from("work_items")
      .select("id")
      .eq("organization_id", current.organization_id)
      .eq("kind", "sales_clarification")
      .in("status", ["open", "in_progress"])
      .maybeSingle();

    if (!existing.data) {
      const work = await createWorkItem({
        kind: "sales_clarification",
        title: "Answer Customer Success's question",
        detail: `“${current.title}” needs clarification: ${input.note?.trim() || "no detail given"}`,
        team: "sales",
        organizationId: current.organization_id,
        leadId: current.lead_id,
        dueInDays: 1,
        origin: "system",
      });
      await notify({
        team: "sales",
        title: "Clarification requested",
        body: `“${current.title}” — Customer Success needs the Sales side of this.`,
        link: current.organization_id ? `/admin/organizations/${current.organization_id}` : null,
      });
      await recordActivity({
        kind: "work_created",
        summary: `Work item created: ${work.title}`,
        organizationId: current.organization_id,
        workItemId: work.id,
        actorLabel: "system",
      });
      cascade.push("Question routed back to Sales as real work, due in 1 day");
      cascade.push("Sales notified");
    } else {
      cascade.push("Sales already has an open clarification for this customer");
    }
  }

  return cascade;
}

function teamLabel(t: OsTeam): string {
  return t === "customer_success" ? "Customer Success" : t.charAt(0).toUpperCase() + t.slice(1);
}

export { CHAIN, STAGE_LABEL };
