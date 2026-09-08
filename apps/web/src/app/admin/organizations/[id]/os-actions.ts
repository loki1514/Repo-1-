"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { completeWork, decideRequirement } from "@/lib/os/orchestrator";
import { setWorkStatus } from "@/lib/os/kernel";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { RequirementDisposition, RequirementStatus } from "@/lib/os/kernel";

export type WorkActionResult =
  | { ok: true; cascade: string[] }
  | { ok: false; error: string };

const clean = (err: unknown, fallback: string, prefix: RegExp) =>
  err instanceof Error ? err.message.replace(prefix, "") : fallback;

/**
 * Completing a work item is the only thing a human does here. What happens
 * next — the stage moving, the handoff, the following work item, the
 * notification — is the orchestrator's, and it returns what it did so the
 * screen can show it rather than pretend the human did it.
 */
export async function completeWorkAction(
  workItemId: string,
  organizationId: string,
): Promise<WorkActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const { cascade } = await completeWork(workItemId, admin.id);
    revalidatePath(`/admin/organizations/${organizationId}`);
    revalidatePath("/admin/organizations");
    revalidatePath("/admin/work");
    return { ok: true, cascade };
  } catch (err) {
    return { ok: false, error: clean(err, "Could not complete this work item.", /^completeWork:\s*/) };
  }
}

export async function blockWorkAction(
  workItemId: string,
  organizationId: string,
  reason: string,
): Promise<WorkActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    if (!reason.trim()) return { ok: false, error: "Say what is blocking it." };
    await setWorkStatus(workItemId, "blocked", admin.id, reason.trim());
    revalidatePath(`/admin/organizations/${organizationId}`);
    revalidatePath("/admin/work");
    return { ok: true, cascade: ["Work item marked blocked — it stays visible in the queue"] };
  } catch (err) {
    return { ok: false, error: clean(err, "Could not block this work item.", /^setWorkStatus:\s*/) };
  }
}

/** Gap 1 — the proof a step actually happened, before it can be ticked. */
export async function addEvidenceAction(
  workItemId: string,
  organizationId: string,
  kind: string,
  content: Record<string, unknown>,
): Promise<WorkActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const { error } = await supabaseAdmin.from("work_evidence").insert({
      work_item_id: workItemId,
      kind,
      content,
      created_by: admin.id,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/admin/organizations/${organizationId}`);
    revalidatePath("/admin/work");
    return { ok: true, cascade: ["Recorded against this work item — it can now be completed"] };
  } catch (err) {
    return { ok: false, error: clean(err, "Could not record that.", /^$/) };
  }
}

/** Gap 2 + 6 — Customer Success deciding, and the branch back to Sales. */
export async function decideRequirementAction(
  requirementId: string,
  organizationId: string,
  status: RequirementStatus,
  disposition: RequirementDisposition | null,
  note: string,
): Promise<WorkActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    if (status === "clarification_required" && !note.trim()) {
      return { ok: false, error: "Say what needs clarifying — Sales gets this as their question." };
    }
    const cascade = await decideRequirement({
      requirementId,
      status,
      disposition,
      note,
      actor: admin.id,
    });
    revalidatePath(`/admin/organizations/${organizationId}`);
    revalidatePath("/admin/work");
    return { ok: true, cascade };
  } catch (err) {
    return { ok: false, error: clean(err, "Could not record that decision.", /^decideRequirement:\s*/) };
  }
}

/** Gap 3 — Day 2 FR-03. An organization has one or many locations. */
export async function createLocationAction(
  organizationId: string,
  input: { name: string; kind: string; city: string; franchiseeName: string },
): Promise<WorkActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    if (!input.name.trim()) return { ok: false, error: "A location needs a name." };

    const { error } = await supabaseAdmin.from("locations").insert({
      organization_id: organizationId,
      name: input.name.trim(),
      kind: input.kind,
      city: input.city.trim() || null,
      franchisee_name: input.franchiseeName.trim() || null,
      created_by: admin.id,
    });
    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: "This organization already has a location with that name." };
      }
      throw new Error(error.message);
    }

    revalidatePath(`/admin/organizations/${organizationId}`);
    return { ok: true, cascade: [`Location “${input.name.trim()}” added`] };
  } catch (err) {
    return { ok: false, error: clean(err, "Could not add that location.", /^$/) };
  }
}
