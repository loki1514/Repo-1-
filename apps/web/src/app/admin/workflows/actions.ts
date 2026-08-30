"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { saveWorkflow, setWorkflowActive } from "@/lib/tenant";
import { applyPlan, planFromWorkflow, type ApplyPlan } from "@/lib/workflow-apply";
import {
  parseDefinition,
  slugIsValid,
  toTenantDefinition,
  WORKFLOW_MODULES,
  type WorkflowModule,
} from "@/components/admin/workflows/definition";

export type SaveWorkflowState = {
  ok: boolean;
  error: string | null;
  /** Set after a successful save so the editor can close itself. */
  savedKey: string | null;
};

const INITIAL: SaveWorkflowState = { ok: false, error: null, savedKey: null };

/**
 * Creates a template (mode=create, version 1) or saves the next version of
 * an existing template (mode=edit, keyed by the workflow row id). The real
 * data layer (lib/tenant.ts saveWorkflow) never mutates an existing row —
 * with an id it inserts latest+1 for that key — and new rows start active
 * (org_workflows.is_active defaults to true). The version history is the
 * audit trail.
 */
export async function saveWorkflowAction(
  _prev: SaveWorkflowState,
  formData: FormData,
): Promise<SaveWorkflowState> {
  try {
    await requirePlatformAdmin();

    const mode = String(formData.get("mode") ?? "");
    const id = String(formData.get("id") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const key = String(formData.get("key") ?? "").trim();
    const module = String(formData.get("module") ?? "") as WorkflowModule;
    const rawDefinition = String(formData.get("definition") ?? "");

    if (mode !== "create" && mode !== "edit") {
      return { ...INITIAL, error: "Unknown save mode." };
    }
    if (mode === "edit" && !id) {
      return { ...INITIAL, error: "Missing workflow id — reopen the editor." };
    }
    if (!name) return { ...INITIAL, error: "Name is required." };
    if (!slugIsValid(key)) {
      return {
        ...INITIAL,
        error: "Key must be a slug: lowercase letters, digits and underscores, starting with a letter.",
      };
    }
    // Known registry keys preferred; a legacy value already stored on the
    // row is still accepted so old templates remain editable.
    if (
      !WORKFLOW_MODULES.includes(module) &&
      !/^[a-z][a-z0-9_]{1,63}$/.test(module)
    ) {
      return { ...INITIAL, error: "Choose a module." };
    }

    const { definition, error: defError } = parseDefinition(rawDefinition);
    if (defError || !definition) {
      return { ...INITIAL, error: defError ?? "Definition is invalid." };
    }

    // Scope: empty/"platform" → a template every org inherits (organization_id
    // NULL). A uuid → a workflow owned by that one organization.
    const scope = String(formData.get("organizationId") ?? "").trim();
    const organizationId = scope && scope !== "platform" ? scope : null;

    const saved = await saveWorkflow({
      // With an id, saveWorkflow bumps that key's latest version and ignores
      // key/organizationId — the key stays immutable, as the editor promises.
      id: mode === "edit" ? id : undefined,
      organizationId,
      key,
      name,
      module,
      definition: toTenantDefinition(definition),
    });

    revalidatePath("/admin/workflows");
    return { ok: true, error: null, savedKey: saved.key };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return {
      ...INITIAL,
      error: message.replace(/^saveWorkflow:\s*/, ""),
    };
  }
}

export type ToggleState = { ok: boolean; error: string | null };

export async function setWorkflowActiveAction(
  id: string,
  isActive: boolean,
): Promise<ToggleState> {
  try {
    await requirePlatformAdmin();
    await setWorkflowActive(id, isActive);
    revalidatePath("/admin/workflows");
    return { ok: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false, error: message.replace(/^setWorkflowActive:\s*/, "") };
  }
}

// ---------------------------------------------------------------------------
// Applying a flow to an organization
//
// Saving a workflow has always written JSON and changed nothing else. These
// two actions close that loop: preview turns the drawn flow into a diff
// against the org's live configuration, and apply writes it — behind the same
// builder passcode that guards the permission matrix, because it moves the
// same permissions.
// ---------------------------------------------------------------------------

export type PreviewState =
  | { ok: true; plan: ApplyPlan; error: null }
  | { ok: false; plan: null; error: string };

export async function previewApplyAction(
  organizationId: string,
  definition: unknown,
  prune: boolean,
): Promise<PreviewState> {
  try {
    await requirePlatformAdmin();
    if (!organizationId || organizationId === "platform") {
      return {
        ok: false,
        plan: null,
        error:
          "Pick an organization first — a platform template has no single configuration to apply to.",
      };
    }
    const plan = await planFromWorkflow(organizationId, definition, { prune });
    return { ok: true, plan, error: null };
  } catch (err) {
    return {
      ok: false,
      plan: null,
      error: err instanceof Error ? err.message : "Could not build the plan.",
    };
  }
}

export type ApplyState = { ok: boolean; error: string | null; applied: string | null };

export async function applyWorkflowAction(
  organizationId: string,
  definition: unknown,
  prune: boolean,
  passcode: string,
): Promise<ApplyState> {
  try {
    await requirePlatformAdmin();

    if (!process.env.ADMIN_BUILDER_PASSCODE) {
      return {
        ok: false,
        applied: null,
        error:
          "Builder passcode is not configured on this deployment. Set ADMIN_BUILDER_PASSCODE before configuration can be applied.",
      };
    }
    if (!builderPasscodeMatches(passcode)) {
      // A deliberate pause: this is the second lock, and a fast "no" invites
      // guessing at it.
      await new Promise((r) => setTimeout(r, 400));
      return { ok: false, applied: null, error: "That passcode is not correct." };
    }

    // The plan is rebuilt here rather than accepted from the client. The
    // browser sends the drawing; what that drawing means for permissions is
    // decided on the server, every time.
    const plan = await planFromWorkflow(organizationId, definition, { prune });
    const written = await applyPlan(plan);

    revalidatePath("/admin/workflows");
    revalidatePath("/admin/organizations");
    revalidatePath("/org");

    const parts: string[] = [];
    if (written.modules > 0) parts.push(`${written.modules} module${written.modules === 1 ? "" : "s"}`);
    if (written.roles > 0) parts.push(`${written.roles} permission${written.roles === 1 ? "" : "s"}`);

    return {
      ok: true,
      error: null,
      applied: parts.length > 0 ? parts.join(" and ") : "nothing — the org already matched this flow",
    };
  } catch (err) {
    return {
      ok: false,
      applied: null,
      error: err instanceof Error ? err.message : "Could not apply the flow.",
    };
  }
}

/** Same second lock as the permission matrix — see app/admin/roles/actions.ts. */
function builderPasscodeMatches(input: string): boolean {
  const expected = process.env.ADMIN_BUILDER_PASSCODE ?? "";
  if (!expected || input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
