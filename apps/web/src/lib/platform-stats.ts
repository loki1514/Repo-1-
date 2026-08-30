import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Platform-wide counters for the master admin dashboard.
 *
 * These tiles read "not built yet" since the first week of the project. The
 * tables they describe have existed for a while; nobody went back. Counting is
 * done with head-only count queries so the numbers stay cheap as tenants grow.
 */
export type PlatformStats = {
  organizations: number;
  activeOrganizations: number;
  tables: number;
  members: number;
  ordersToday: number;
  salesToday: number;
};

export async function platformStats(): Promise<PlatformStats> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [orgs, activeOrgs, tables, members, today] = await Promise.all([
    supabaseAdmin.from("organizations").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabaseAdmin
      .from("dining_tables")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabaseAdmin
      .from("org_users")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    // Sales needs the rows themselves, so this one is not head-only.
    supabaseAdmin
      .from("orders")
      .select("total, status")
      .gte("created_at", dayStart.toISOString())
      .neq("status", "cancelled"),
  ]);

  const orders = today.data ?? [];

  return {
    organizations: orgs.count ?? 0,
    activeOrganizations: activeOrgs.count ?? 0,
    tables: tables.count ?? 0,
    members: members.count ?? 0,
    ordersToday: orders.length,
    salesToday: orders
      .filter((o) => o.status === "paid")
      .reduce((s, o) => s + Number(o.total), 0),
  };
}
