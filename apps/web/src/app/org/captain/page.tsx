import type { Metadata } from "next";
import { checkModule } from "@/lib/module-guard";
import { listFloor } from "@/lib/ops";
import { billCharges, guestMenu } from "@/lib/guest";
import { CaptainApp } from "@/components/org/captain/CaptainApp";
import { ModuleDenied } from "@/components/org/ModuleDenied";
import { captainIdentity } from "./actions";

export const metadata: Metadata = { title: "Captain Order" };
// Table amounts and PINs are stale the moment they are cached.
export const dynamic = "force-dynamic";

export default async function CaptainPage() {
  const access = await checkModule("orders");
  if (!access.ok) {
    return (
      <ModuleDenied
        title="Captain ordering"
        roleName={access.org?.myRole ?? "your role"}
      />
    );
  }

  const { org } = access;

  // guestMenu() is deliberately reused rather than a captain-specific query:
  // it already applies availability and the per-item switch-offs, so a captain
  // can never promise a dish the guest's own phone says is unavailable.
  const [me, floor, menu, charges] = await Promise.all([
    captainIdentity(),
    listFloor(org.id),
    guestMenu(org.id),
    billCharges(org.id),
  ]);

  return (
    <CaptainApp
      orgName={org.name}
      captainName={me.name}
      tables={floor}
      categories={menu.categories}
      items={menu.items}
      charges={charges}
    />
  );
}
