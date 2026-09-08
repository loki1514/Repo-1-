import { redirect } from "next/navigation";
import { Aurora } from "@/components/ui/Aurora";
import { Rail } from "@/components/admin/Rail";
import { TopBar } from "@/components/admin/TopBar";
import { getPlatformAdmin, ROLE_LABEL, SECTIONS_FOR_ROLE } from "@/lib/platform-admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // proxy.ts already gates /admin; this is defence in depth and gives the
  // layout the account it needs to render the top bar.
  const admin = await getPlatformAdmin();
  if (!admin) redirect("/login");

  // The sidebar offers only what this role may open — a Sales Executive never
  // sees the module registry, so no screen in the nav can refuse them.
  const sections =
    admin.role === "master_admin"
      ? undefined
      : SECTIONS_FOR_ROLE[admin.role];

  return (
    <div className="relative min-h-dvh">
      <Aurora />
      <Rail sections={sections} />
      <div className="relative z-10 px-4 pb-24 md:pb-6 md:pl-[92px] md:pr-6">
        <div className="mx-auto max-w-[1400px]">
          <TopBar
            email={admin.email}
            name={admin.fullName ?? undefined}
            role={ROLE_LABEL[admin.role]}
          />
          {children}
        </div>
      </div>
    </div>
  );
}
