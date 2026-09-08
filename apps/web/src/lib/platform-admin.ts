import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";

export type PlatformRole =
  | "master_admin"
  | "growth_admin"
  | "sales_manager"
  | "sales_executive"
  | "business_development"
  | "onboarding_admin"
  | "customer_success"
  | "operations";

export type OsTeamName = "sales" | "onboarding" | "customer_success" | "operations" | "platform";

export type PlatformAdmin = {
  id: string;
  email: string;
  role: PlatformRole;
  fullName: string | null;
  team: OsTeamName;
};

const TEAM_FOR_ROLE: Record<PlatformRole, OsTeamName> = {
  master_admin: "platform",
  growth_admin: "sales",
  sales_manager: "sales",
  sales_executive: "sales",
  business_development: "sales",
  onboarding_admin: "onboarding",
  customer_success: "customer_success",
  operations: "operations",
};

export const ROLE_LABEL: Record<PlatformRole, string> = {
  master_admin: "Master Admin",
  growth_admin: "Growth Admin",
  sales_manager: "Sales Manager",
  sales_executive: "Sales Executive",
  business_development: "Business Development",
  onboarding_admin: "Onboarding Admin",
  customer_success: "Customer Success",
  operations: "Operations",
};

/**
 * Which sections of the Console each role may open. A sales executive has no
 * business in the module registry; an onboarding admin has no business in the
 * sales pipeline's commercial controls. master_admin sees everything.
 */
export const SECTIONS_FOR_ROLE: Record<PlatformRole, string[]> = {
  master_admin: ["*"],
  growth_admin: ["growth", "work", "organizations"],
  sales_manager: ["growth", "work", "organizations"],
  sales_executive: ["growth", "work"],
  business_development: ["growth", "work", "organizations"],
  onboarding_admin: ["work", "organizations", "growth"],
  customer_success: ["work", "organizations"],
  operations: ["work", "organizations"],
};

export function canAccess(role: PlatformRole, section: string): boolean {
  const allowed = SECTIONS_FOR_ROLE[role] ?? [];
  return allowed.includes("*") || allowed.includes(section);
}

/**
 * The Vini super admin, resolved from a real Supabase Auth session — not the
 * env-var credential this used to be. `is_platform_admin()` (migration 0001)
 * is SECURITY DEFINER, so this call is authoritative even though the caller
 * only has an `authenticated`-role session, not service_role.
 */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data: isAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error) throw new Error(`getPlatformAdmin: ${error.message}`);
  if (!isAdmin) return null;

  const { data: row } = await supabase
    .from("platform_admins")
    .select("role, full_name")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = ((row?.role as PlatformRole) ?? "master_admin") satisfies PlatformRole;

  return {
    id: user.id,
    email: user.email,
    role,
    fullName: (row?.full_name as string | null) ?? null,
    team: TEAM_FOR_ROLE[role],
  };
}

export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin();
  if (!admin) throw new Error("You don't have permission to do this.");
  return admin;
}

/**
 * Gate a Console section by role rather than by "is an admin at all".
 *
 * A role that cannot open a screen is redirected to one it can, rather than
 * shown a 500 — the sidebar already hides these, so reaching here means a
 * typed URL or a stale link, not a dead end worth an error page.
 */
export async function requireSection(section: string): Promise<PlatformAdmin> {
  const admin = await requirePlatformAdmin();
  if (!canAccess(admin.role, section)) {
    const fallback = SECTIONS_FOR_ROLE[admin.role]?.[0];
    redirect(fallback && fallback !== "*" ? `/admin/${fallback}` : "/admin");
  }
  return admin;
}
