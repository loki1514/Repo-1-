import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CreditCard,
  Hammer,
  Mail,
  Phone,
} from "lucide-react";
import { AdminCredentialCard } from "@/components/admin/AdminCredentialCard";
import { OrgAppearanceCard } from "@/components/admin/OrgAppearanceCard";
import { OrgDomainsCard } from "@/components/admin/OrgDomainsCard";
import { OrgModulesCard, type OrgModule } from "@/components/admin/OrgModulesCard";
import { InviteCard } from "@/components/shared/InviteCard";
import { getOrgAdmin, getOrganization, type OrgStatus } from "@/lib/organizations";
import { listInvites } from "@/lib/invites";
import {
  listModules,
  listOrgDomains,
  listOrgModules,
  type OrgDomain,
} from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  listActivities,
  listHandoffs,
  listRequirements,
  listWorkItems,
} from "@/lib/os/kernel";
import { OnboardingPanel } from "@/components/admin/os/OnboardingPanel";
import { evidenceKindFor } from "@/lib/os/orchestrator";
import type { OrgTheme } from "@/lib/theme";
import { createInviteAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<OrgStatus, { label: string; bg: string; fg: string }> = {
  active: { label: "Active", bg: "rgb(79 191 106 / 0.14)", fg: "var(--ok)" },
  onboarding: { label: "Onboarding", bg: "rgb(76 147 232 / 0.14)", fg: "var(--info)" },
  suspended: { label: "Suspended", bg: "rgb(226 86 75 / 0.12)", fg: "var(--danger)" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const org = await getOrganization(id);
  return { title: org?.name ?? "Organization" };
}

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [organization, admin, invites, rolesResult, work, requirements, handoffs, activities] =
    await Promise.all([
      getOrganization(id),
      getOrgAdmin(id),
      listInvites(id),
      supabaseAdmin
        .from("roles")
        .select("id, slug, name")
        .eq("is_system", true)
        .order("created_at"),
      listWorkItems({ organizationId: id }),
      listRequirements(id),
      listHandoffs(id),
      listActivities({ organizationId: id, limit: 60 }),
    ]);

  // Gap 1 + 3 — what each open item still needs, and the organization's outlets.
  const [{ data: locationRows }, { data: evidenceRows }] = await Promise.all([
    supabaseAdmin
      .from("locations")
      .select("id, name, kind, city, franchisee_name")
      .eq("organization_id", id)
      .order("created_at"),
    supabaseAdmin
      .from("work_evidence")
      .select("work_item_id, kind")
      .in("work_item_id", work.map((w) => w.id).length ? work.map((w) => w.id) : ["00000000-0000-0000-0000-000000000000"]),
  ]);

  const evidenceNeeded = Object.fromEntries(work.map((w) => [w.id, evidenceKindFor(w.kind)]));
  const evidenceHave = [
    ...new Set(
      (evidenceRows ?? [])
        .filter((e) => evidenceNeeded[e.work_item_id as string] === e.kind)
        .map((e) => e.work_item_id as string),
    ),
  ];

  if (!organization) notFound();
  const roles = rolesResult.data ?? [];

  // Control-plane data (modules / domains). listOrgModules returns only the
  // toggle rows that exist in org_modules — merge them with the module
  // catalog here: a module is on when its toggle row says so, and core
  // modules default to on when no row exists. Degrade to empty cards instead
  // of failing the page if the control-plane tables are missing.
  let orgModules: OrgModule[] = [];
  let orgDomains: OrgDomain[] = [];
  let modulesWired = true;
  let domainsWired = true;
  try {
    const [catalog, toggles] = await Promise.all([
      listModules(),
      listOrgModules(id),
    ]);
    const byKey = new Map(toggles.map((t) => [t.module_key, t]));
    orgModules = catalog.map((m) => ({
      ...m,
      enabled: byKey.get(m.key)?.enabled ?? m.is_core,
    }));
  } catch {
    modulesWired = false;
  }
  try {
    orgDomains = await listOrgDomains(id);
  } catch {
    domainsWired = false;
  }

  const s = STATUS[organization.status];

  return (
    <div className="space-y-5">
      <Link
        href="/admin/organizations"
        className="press inline-flex items-center gap-2 rounded-[12px] px-1 py-1 text-[13.5px] font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft size={15} strokeWidth={2.6} />
        Organizations
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px]"
            style={{ background: "#14170f" }}
          >
            <Building2 size={24} className="text-[var(--lime)]" />
          </span>
          <div>
            <h1 className="t-h1">{organization.name}</h1>
            <p className="tnum mt-1 text-[14px] text-muted">
              /{organization.slug} · {organization.id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[var(--line-strong)] px-3 py-1.5 text-[13px] font-bold capitalize">
            {organization.type}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold"
            style={{ background: s.bg, color: s.fg }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.fg }} />
            {s.label}
          </span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Organization details */}
        <div className="glass rounded-[var(--r-xl)] p-5 sm:p-6">
          <div className="relative z-10">
            <h2 className="t-h3">Details</h2>
            <dl className="mt-4 space-y-3">
              <Row label="Legal name" value={organization.legal_name} />
              <Row label="GSTIN" value={organization.gstin} mono />
              <Row
                label="Contact email"
                value={organization.contact_email}
                icon={Mail}
              />
              <Row
                label="Contact phone"
                value={organization.contact_phone}
                icon={Phone}
              />
              <Row
                label="Created"
                value={new Date(organization.created_at).toLocaleDateString("en-IN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              />
            </dl>
          </div>
        </div>

        {/* Admin login */}
        <AdminCredentialCard
          organizationId={organization.id}
          adminEmail={admin?.email ?? null}
        />
      </div>

      {/* Invite links — onboard staff into any role */}
      <InviteCard
        organizationId={organization.id}
        createAction={createInviteAction}
        roles={roles}
        invites={invites}
      />

      {/* The OS spine — onboarding stage, open work, requirements, handoffs */}
      <OnboardingPanel
        organizationId={organization.id}
        stage={(organization as { onboarding_stage?: string | null }).onboarding_stage ?? null}
        work={work}
        requirements={requirements}
        handoffs={handoffs}
        activities={activities}
        locations={locationRows ?? []}
        evidenceNeeded={evidenceNeeded}
        evidenceHave={evidenceHave}
      />

      {/* Appearance — per-org accent, typeface, ambient weather */}
      <OrgAppearanceCard
        organizationId={organization.id}
        orgName={organization.name}
        initial={(organization as { theme?: OrgTheme }).theme ?? {}}
      />

      {/* Control plane — per-org module toggles */}
      <OrgModulesCard
        organizationId={organization.id}
        modules={orgModules}
        wired={modulesWired}
      />

      {/* Control plane — subdomain + custom domain management */}
      <OrgDomainsCard
        organizationId={organization.id}
        domains={orgDomains}
        wired={domainsWired}
      />

      {/* Billing — honest placeholder, no billing schema exists yet */}
      <div className="glass rounded-[var(--r-xl)] p-5 sm:p-6">
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
              style={{ background: "#14170f" }}
            >
              <CreditCard size={15} className="text-[var(--lime)]" />
            </span>
            <h2 className="t-h3">Subscription &amp; dues</h2>
            <span
              className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold"
              style={{ background: "rgb(242 169 59 / 0.14)", color: "var(--warn)" }}
            >
              <Hammer size={12} strokeWidth={2.8} />
              Not built yet
            </span>
          </div>
          <p className="mt-3 max-w-lg t-small text-muted">
            Plan, billing cycle, outstanding dues and payment history will
            show here once billing is modeled. Currently no
            <code> billing</code> table exists — this needs its own migration
            before it can show real numbers.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  icon: Icon,
  mono,
}: {
  label: string;
  value: string | null;
  icon?: typeof Mail;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-2 text-[13.5px] text-muted">
        {Icon && <Icon size={13} className="shrink-0" />}
        {label}
      </dt>
      <dd
        className={
          (mono ? "tnum " : "") +
          "truncate text-[14px] font-semibold " +
          (value ? "text-ink" : "text-muted")
        }
      >
        {value || "—"}
      </dd>
    </div>
  );
}
