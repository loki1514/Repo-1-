import { redirect } from "next/navigation";
import { Aurora } from "@/components/ui/Aurora";
import { OrgSidebar } from "@/components/org/OrgSidebar";
import { OrgTopBar } from "@/components/org/OrgTopBar";
import { ChameleonShell } from "@/components/org/ChameleonShell";
import { TenantMismatch } from "@/components/org/TenantMismatch";
import { getMyOrg } from "@/lib/org";
import { getEnabledModuleKeys } from "@/lib/org-modules";
import { checkTenantHost } from "@/lib/tenant-guard";
import { fontHref, fontVars, themeVars } from "@/lib/theme";
import { supabaseServer } from "@/lib/supabase-server";

export default async function OrgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/org");

  const org = await getMyOrg();
  if (!org) redirect("/login?next=/org");

  // The hostname must agree with the session before any tenant data renders.
  // Returning early here means nothing org-scoped is fetched, let alone shown.
  const tenant = await checkTenantHost(org.id, org.name);
  if (tenant.status === "mismatch") {
    return (
      <div className="relative min-h-dvh">
        <Aurora />
        <TenantMismatch
          hostOrgName={tenant.hostOrgName}
          userOrgName={tenant.userOrgName}
          userOrgHost={tenant.userOrgHost}
        />
      </div>
    );
  }

  // Role-aware: what the org switched on, intersected with what this user's
  // role may see (migrations 0007 + 0008).
  const enabled = await getEnabledModuleKeys(org.id, org.myRole);

  // Appearance is resolved on the server and inlined, so the org's colours
  // are correct on first paint — no flash of platform lime.
  const theme = org.theme ?? {};
  const shellVars = { ...themeVars(theme), ...fontVars(theme.font) };
  const href = fontHref(theme.font);

  return (
    <div
      className="relative min-h-dvh"
      style={shellVars as React.CSSProperties}
    >
      {href && (
        <>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin=""
          />
          <link rel="stylesheet" href={href} />
        </>
      )}
      <ChameleonShell theme={theme}>
        <Aurora />
        {org.viewingAsPlatformAdmin && (
          // Say it plainly. A platform admin seeing a restaurant's till without
          // being told whose it is, is exactly how the wrong bill gets settled.
          <div
            className="relative z-20 flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px] font-bold"
            style={{ background: "#14170f", color: "#f3f6ec" }}
          >
            <span style={{ color: "var(--lime)" }}>Vini platform admin</span>
            <span className="opacity-80">
              — viewing {org.name}. You are not a member of this restaurant; changes you make here are real.
            </span>
            <a href="/admin" className="press ml-auto underline opacity-80 hover:opacity-100">
              Back to Master Admin
            </a>
          </div>
        )}
        <OrgSidebar
          orgName={org.name}
          orgType={org.type}
          enabledModules={enabled === null ? null : [...enabled]}
        />
        <div className="relative z-10 lg:pl-[248px]">
          <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
            <OrgTopBar email={user.email ?? ""} status={org.status} />
            {children}
          </div>
        </div>
      </ChameleonShell>
    </div>
  );
}
