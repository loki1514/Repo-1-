import "server-only";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { OrgTheme } from "@/lib/theme";

export type Role = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
};

export type OrgMember = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  status: "active" | "suspended";
  created_at: string;
  role: { slug: string; name: string };
};

export type MyOrg = {
  id: string;
  name: string;
  slug: string;
  type: "franchise" | "investor";
  status: "onboarding" | "active" | "suspended";
  contact_email: string | null;
  contact_phone: string | null;
  legal_name: string | null;
  gstin: string | null;
  created_at: string;
  /** Per-org appearance (migration 0009). */
  theme: OrgTheme;
  /** Role of the currently signed-in user within this organization. */
  myRole: string;
  /**
   * True when a Vini platform admin is looking at an organization they are not
   * a member of, reached through /<slug>/org/…. Screens use it to say so
   * rather than letting the viewer believe they are a member.
   */
  viewingAsPlatformAdmin?: boolean;
};

/**
 * The signed-in user's organization, read through their own session so RLS
 * (0004: organizations_member_select) does the tenant isolation — not a
 * service_role bypass.
 */
export async function getMyOrg(): Promise<MyOrg | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("org_users")
    .select(
      `role_id,
       roles!inner(slug),
       organizations!inner(
         id, name, slug, type, status,
         contact_email, contact_phone, legal_name, gstin, created_at, theme
       )`,
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(`getMyOrg: ${error.message}`);

  if (data) {
    const org = data.organizations as unknown as Omit<MyOrg, "myRole">;
    const role = data.roles as unknown as { slug: string };
    return { ...org, myRole: role.slug };
  }

  // No membership. A Vini platform admin belongs to no organization, so every
  // /org route used to bounce them to /login — which the proxy then sent to
  // /admin, producing a redirect loop with no explanation. When the request
  // names an organization in its path, let them in and mark it clearly.
  //
  // This grants no new authority: migrations 0006 onward already give
  // is_platform_admin() full access to every tenant table. It only surfaces
  // what the database already permits.
  return platformAdminView(supabase, user.id);
}

async function platformAdminView(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
): Promise<MyOrg | null> {
  const requestedOrgId = (await headers()).get("x-org-id");
  if (!requestedOrgId) return null;

  const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");
  if (!isPlatformAdmin) return null;

  const { data: org, error } = await supabaseAdmin
    .from("organizations")
    .select("id, name, slug, type, status, contact_email, contact_phone, legal_name, gstin, created_at, theme")
    .eq("id", requestedOrgId)
    .maybeSingle();

  if (error) throw new Error(`getMyOrg (platform view): ${error.message}`);
  if (!org) return null;

  void userId;
  return {
    ...(org as unknown as Omit<MyOrg, "myRole">),
    // Sees everything, because that is what the RLS policies already say.
    myRole: "org_admin",
    viewingAsPlatformAdmin: true,
  };
}

export async function listRoles(): Promise<Role[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("roles")
    .select("id, slug, name, description")
    .order("created_at");

  if (error) throw new Error(`listRoles: ${error.message}`);
  return data ?? [];
}

export async function listOrgMembers(organizationId: string): Promise<OrgMember[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("org_users")
    .select("id, user_id, email, full_name, status, created_at, roles!inner(slug, name)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`listOrgMembers: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    user_id: row.user_id,
    email: row.email,
    full_name: row.full_name,
    status: row.status,
    created_at: row.created_at,
    role: row.roles as unknown as { slug: string; name: string },
  }));
}

/**
 * Throws unless the signed-in user is an org_admin of `organizationId`.
 * Every mutating org action calls this before touching supabaseAdmin, since
 * the admin client bypasses RLS.
 */
export async function requireOrgAdmin(organizationId: string): Promise<string> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data } = await supabaseAdmin
    .from("org_users")
    .select("id, roles!inner(slug)")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .eq("roles.slug", "org_admin")
    .maybeSingle();

  if (!data) throw new Error("You don't have permission to manage this organization.");
  return user.id;
}
