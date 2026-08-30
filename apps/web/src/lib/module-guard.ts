import "server-only";
import { getMyOrg } from "@/lib/org";
import { getEnabledModuleKeys } from "@/lib/org-modules";

/**
 * One answer to "may this person open this screen".
 *
 * Screens were briefly guarding themselves with hardcoded role lists —
 * `if (role !== "kitchen") deny`. That quietly outranks the control plane: a
 * platform admin could grant the captain the kitchen display from the workflow
 * canvas, watch it appear in the sidebar, and still be refused at the page.
 * Configuration that the code can overrule is not configuration.
 *
 * So both the sidebar and the page now ask the same question of the same
 * source: getEnabledModuleKeys(), which is the org's enabled modules
 * intersected with what the role may see (migrations 0007 + 0008). Change it
 * in the builder and both move together, because there is only one rule.
 */

export type ModuleAccess =
  | { ok: true; org: NonNullable<Awaited<ReturnType<typeof getMyOrg>>> }
  | { ok: false; org: Awaited<ReturnType<typeof getMyOrg>>; reason: "no-org" | "not-permitted" };

export async function checkModule(moduleKey: string): Promise<ModuleAccess> {
  const org = await getMyOrg();
  if (!org) return { ok: false, org, reason: "no-org" };

  const enabled = await getEnabledModuleKeys(org.id, org.myRole);
  // null = the control-plane tables are unavailable. Failing open here is
  // deliberate: a missing migration should degrade to "everything visible",
  // not lock every member of every org out of their own restaurant.
  if (enabled === null || enabled.has(moduleKey)) {
    return { ok: true, org };
  }
  return { ok: false, org, reason: "not-permitted" };
}

/**
 * The mutation-side counterpart of checkModule().
 *
 * Server actions need the org or a thrown error, not a renderable outcome —
 * and they must apply exactly the same rule as the page that offered the
 * button, or a user sees a control they are then refused when they press it.
 */
export async function requireModule(moduleKey: string, label: string) {
  const access = await checkModule(moduleKey);
  if (!access.ok) {
    throw new Error(
      access.reason === "no-org"
        ? "Your session has expired — sign in again."
        : `${label} is not open to your role. An admin can change that in the permissions matrix.`,
    );
  }
  return access.org;
}
