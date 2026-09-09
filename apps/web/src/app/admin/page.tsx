import type { Metadata } from "next";
import { Building2, MapPin, ReceiptText, Users } from "lucide-react";
import { CreateOrgSheet } from "@/components/admin/CreateOrgSheet";
import { OrgTable } from "@/components/admin/OrgTable";
import { StatTile } from "@/components/admin/StatTile";
import { listOrganizations } from "@/lib/organizations";
import { platformStats } from "@/lib/platform-stats";
import { inrShort } from "@/lib/bill";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { buildDashboard } from "@/lib/os/dashboard";
import { RoleDashboard } from "@/components/admin/os/RoleDashboard";

export const metadata: Metadata = { title: "Master Admin" };
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const me = await requirePlatformAdmin();
  const dashboard = await buildDashboard(me.role, me.team, me.id, me.fullName ?? me.email);

  // Everyone gets the dashboard their role asks for. Only the master admin
  // also gets the platform inventory underneath it.
  if (me.role !== "master_admin") {
    return <RoleDashboard data={dashboard} />;
  }

  const [organizations, stats] = await Promise.all([listOrganizations(), platformStats()]);
  const active = organizations.filter((o) => o.status === "active").length;

  return (
    <div className="space-y-5">
      <RoleDashboard data={dashboard} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-h1">Master Admin</h1>
          <p className="mt-2 text-[15.5px] text-muted">
            Every organization on the Vini POS platform.
          </p>
        </div>
        {organizations.length > 0 && <CreateOrgSheet />}
      </div>

      {/* Real counts across every tenant — see lib/platform-stats.ts */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Organizations"
          value={String(organizations.length)}
          icon={Building2}
          hint={`${active} active`}
        />
        <StatTile
          label="Tables"
          value={String(stats.tables)}
          icon={MapPin}
          hint="Across all outlets"
        />
        <StatTile
          label="Staff accounts"
          value={String(stats.members)}
          icon={Users}
          hint="Active members"
        />
        <StatTile
          label="Orders today"
          value={String(stats.ordersToday)}
          icon={ReceiptText}
          hint={`${inrShort(stats.salesToday)} settled`}
        />
      </div>

      {organizations.length === 0 ? (
        <div className="glass flex flex-col items-center rounded-[var(--r-2xl)] px-6 py-16 text-center">
          <div className="relative z-10 flex flex-col items-center">
            <span
              className="flex h-16 w-16 items-center justify-center rounded-[20px]"
              style={{ background: "#14170f" }}
            >
              <Building2 size={26} className="text-[var(--lime)]" />
            </span>
            <h2 className="t-h2 mt-6">Create your first organization</h2>
            <p className="mt-2 max-w-sm text-[15px] text-muted">
              Everything in Vini POS — locations, users, roles, workflows —
              grows from the organization you create here.
            </p>
            <div className="mt-7">
              <CreateOrgSheet />
            </div>
          </div>
        </div>
      ) : (
        <OrgTable organizations={organizations} />
      )}
    </div>
  );
}
