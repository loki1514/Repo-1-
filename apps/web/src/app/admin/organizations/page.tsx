import type { Metadata } from "next";
import { CreateOrgSheet } from "@/components/admin/CreateOrgSheet";
import { OrgTable } from "@/components/admin/OrgTable";
import { listOrganizations } from "@/lib/organizations";

export const metadata: Metadata = { title: "Organizations" };
export const dynamic = "force-dynamic";

export default async function OrganizationsPage({
  searchParams,
}: {
  /** ?fromLead=<id>&name=<business name> — a won deal linking straight into creation. */
  searchParams: Promise<{ fromLead?: string; name?: string }>;
}) {
  const { fromLead, name: fromName } = await searchParams;
  const organizations = await listOrganizations();

  const active = organizations.filter((o) => o.status === "active").length;
  const onboarding = organizations.filter((o) => o.status === "onboarding").length;
  const suspended = organizations.filter((o) => o.status === "suspended").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-h1">Organizations</h1>
          <p className="mt-2 text-[15.5px] text-muted">
            Every franchise and investor on the platform. Everything else grows
            from here.
          </p>
        </div>
        <CreateOrgSheet
          initialName={fromName}
          sourceLeadId={fromLead}
          autoOpen={Boolean(fromLead)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Active", value: active, tone: "var(--ok)" },
          { label: "Onboarding", value: onboarding, tone: "var(--info)" },
          { label: "Suspended", value: suspended, tone: "var(--danger)" },
        ].map((s) => (
          <div key={s.label} className="glass rounded-[var(--r-xl)] p-5">
            <div className="relative z-10 flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.tone }}
              />
              <span className="t-label text-muted">{s.label}</span>
              <span className="tnum ml-auto text-[24px] font-extrabold leading-none tracking-[-0.04em]">
                {s.value}
              </span>
            </div>
          </div>
        ))}
      </div>

      <OrgTable organizations={organizations} />
    </div>
  );
}
