import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listModules, listOrgModules, listRoleModuleAccess, setOrgModuleEnabled, setRoleModuleVisible } from "@/lib/tenant";

/**
 * Turning a drawn flow into live configuration.
 *
 * Until now the canvas was a picture: saving a workflow wrote JSON and changed
 * nothing an operator could see. This is the missing half — the step that
 * makes the builder the actual hub rather than documentation of one.
 *
 * Two rules, chosen so that applying a flow is predictable rather than clever:
 *
 *   1. A module block on the canvas means "this org uses this module" → the
 *      module is switched ON. Absence means nothing; a flow describes one
 *      journey, and a restaurant's other journeys are not on this canvas.
 *      Switching things OFF is therefore opt-in (`prune`), never implied.
 *
 *   2. For a module that IS on the canvas, the roles listed on that block are
 *      authoritative — those roles get it, every other role loses it. This is
 *      the rule that answers "can the KOT user see finances": draw the kitchen
 *      flow without a Finance block touching the kitchen role, apply, and the
 *      answer becomes no.
 *
 * Nothing here writes until applyPlan() is called with a plan the operator has
 * seen. The diff is the product; the write is an afterthought.
 */

export type ModuleChange = {
  moduleKey: string;
  moduleName: string;
  from: boolean;
  to: boolean;
  isCore: boolean;
  /** Set when the change was refused — core modules can never be switched off. */
  blocked?: string;
};

export type RoleChange = {
  roleId: string;
  roleSlug: string;
  roleName: string;
  moduleKey: string;
  moduleName: string;
  from: boolean;
  to: boolean;
};

export type ApplyPlan = {
  organizationId: string;
  /** Modules the canvas mentions, in canvas order. */
  touchedModules: { key: string; name: string; roles: string[] }[];
  modules: ModuleChange[];
  roles: RoleChange[];
  notes: string[];
};

type StoredNode = {
  id: string;
  type?: string;
  label?: string;
  data?: { kind?: string; config?: Record<string, unknown> } & Record<string, unknown>;
};

/**
 * Reads module blocks out of a stored definition.
 *
 * Definitions have been written by three different editors over the life of
 * this canvas, so the kind is looked for in every place it has ever lived
 * rather than assuming the newest shape.
 */
function moduleBlocks(definition: unknown): { key: string; roles: string[] }[] {
  const nodes = (definition as { nodes?: StoredNode[] })?.nodes;
  if (!Array.isArray(nodes)) return [];

  const out = new Map<string, Set<string>>();

  for (const n of nodes) {
    const kind =
      (typeof n?.data?.kind === "string" && n.data.kind) ||
      (typeof n?.type === "string" && n.type.startsWith("module:") ? n.type : "");
    if (!kind.startsWith("module:")) continue;

    const key = kind.slice("module:".length);
    if (!key) continue;

    const config = (n.data?.config ?? {}) as Record<string, unknown>;
    const roles = new Set(out.get(key) ?? []);

    if (Array.isArray(config.roles)) {
      for (const r of config.roles) if (typeof r === "string") roles.add(r);
    }
    // A single-role block (approval, sign-in scoped to a screen) is written as
    // `role` rather than `roles`; both mean the same thing here.
    if (typeof config.role === "string") roles.add(config.role);

    out.set(key, roles);
  }

  return [...out.entries()].map(([key, roles]) => ({ key, roles: [...roles] }));
}

/** The role the flow starts as — it always keeps access to everything it walks through. */
function entryRole(definition: unknown): string | null {
  const nodes = (definition as { nodes?: StoredNode[] })?.nodes ?? [];
  for (const n of nodes) {
    const kind = (n?.data?.kind as string) ?? n?.type ?? "";
    if (kind === "signin" || kind === "trigger") {
      const role = (n.data?.config as Record<string, unknown>)?.role;
      if (typeof role === "string" && role) return role;
    }
  }
  return null;
}

export async function planFromWorkflow(
  organizationId: string,
  definition: unknown,
  opts: { prune?: boolean } = {},
): Promise<ApplyPlan> {
  const [catalog, current, access, rolesRes] = await Promise.all([
    listModules(),
    listOrgModules(organizationId),
    listRoleModuleAccess(organizationId),
    supabaseAdmin.from("roles").select("id, slug, name").order("created_at"),
  ]);

  const roles = rolesRes.data ?? [];
  const roleBySlug = new Map(roles.map((r) => [r.slug, r]));
  const moduleByKey = new Map(catalog.map((m) => [m.key, m]));

  const blocks = moduleBlocks(definition);
  const start = entryRole(definition);
  const notes: string[] = [];

  const unknown = blocks.filter((b) => !moduleByKey.has(b.key));
  if (unknown.length > 0) {
    notes.push(
      `Ignoring ${unknown.length} block${unknown.length === 1 ? "" : "s"} for module${unknown.length === 1 ? "" : "s"} that no longer exist: ${unknown.map((u) => u.key).join(", ")}.`,
    );
  }

  const touched = blocks
    .filter((b) => moduleByKey.has(b.key))
    .map((b) => ({
      key: b.key,
      name: moduleByKey.get(b.key)!.name,
      // The signed-in actor implicitly reaches every screen the flow walks
      // through, even where the block forgot to name them.
      roles: [...new Set(start ? [...b.roles, start] : b.roles)].filter((r) => roleBySlug.has(r)),
    }));

  // ---- module toggles ------------------------------------------------------
  const enabledNow = new Map(current.map((c) => [c.module_key, c.enabled]));
  const isOn = (key: string) => enabledNow.get(key) ?? moduleByKey.get(key)?.is_core ?? false;

  const modules: ModuleChange[] = [];
  for (const t of touched) {
    if (isOn(t.key)) continue;
    modules.push({
      moduleKey: t.key,
      moduleName: t.name,
      from: false,
      to: true,
      isCore: moduleByKey.get(t.key)!.is_core,
    });
  }

  if (opts.prune) {
    const onCanvas = new Set(touched.map((t) => t.key));
    for (const m of catalog) {
      if (onCanvas.has(m.key) || !isOn(m.key)) continue;
      modules.push({
        moduleKey: m.key,
        moduleName: m.name,
        from: true,
        to: false,
        isCore: m.is_core,
        blocked: m.is_core
          ? "Core module — the platform guarantees it to every organization."
          : undefined,
      });
    }
  }

  // ---- role visibility -----------------------------------------------------
  // Resolve what each role sees today: the org's own row wins over the
  // platform default for the same (role, module).
  const effective = new Map<string, boolean>();
  for (const rule of access) {
    const cell = `${rule.role_id}:${rule.module_key}`;
    if (rule.organization_id !== null || !effective.has(cell)) {
      effective.set(cell, rule.visible);
    }
  }
  const sees = (roleId: string, moduleKey: string) =>
    effective.get(`${roleId}:${moduleKey}`) ?? false;

  const roleChanges: RoleChange[] = [];
  for (const t of touched) {
    const allowed = new Set(t.roles);
    for (const role of roles) {
      // org_admin is not governed by a drawn flow — an org must always retain
      // someone who can undo whatever the flow just did.
      if (role.slug === "org_admin") continue;

      const should = allowed.has(role.slug);
      if (sees(role.id, t.key) === should) continue;

      roleChanges.push({
        roleId: role.id,
        roleSlug: role.slug,
        roleName: role.name,
        moduleKey: t.key,
        moduleName: t.name,
        from: !should,
        to: should,
      });
    }
  }

  if (touched.length === 0) {
    notes.push(
      "This flow has no module blocks, so there is nothing to apply. Drag modules onto the canvas to say which screens the flow uses.",
    );
  }
  if (touched.some((t) => t.roles.length === 0)) {
    const bare = touched.filter((t) => t.roles.length === 0).map((t) => t.name);
    notes.push(
      `No roles are named on ${bare.join(", ")} — applying will hide ${bare.length === 1 ? "it" : "them"} from every role except the organization admin.`,
    );
  }

  return {
    organizationId,
    touchedModules: touched,
    modules,
    roles: roleChanges.sort(
      (a, b) => a.moduleName.localeCompare(b.moduleName) || a.roleName.localeCompare(b.roleName),
    ),
    notes,
  };
}

export async function applyPlan(plan: ApplyPlan): Promise<{ modules: number; roles: number }> {
  let moduleWrites = 0;
  for (const m of plan.modules) {
    if (m.blocked) continue;
    await setOrgModuleEnabled(plan.organizationId, m.moduleKey, m.to);
    moduleWrites++;
  }

  let roleWrites = 0;
  for (const r of plan.roles) {
    await setRoleModuleVisible(plan.organizationId, r.roleId, r.moduleKey, r.to);
    roleWrites++;
  }

  return { modules: moduleWrites, roles: roleWrites };
}
