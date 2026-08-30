import type { Metadata } from "next";
import { checkModule } from "@/lib/module-guard";
import { liveSnapshot } from "@/lib/ops";
import { LiveBoard } from "@/components/org/live/LiveBoard";
import { ModuleDenied } from "@/components/org/ModuleDenied";

export const metadata: Metadata = { title: "Live Operations" };

// The client asks for this page again every twelve seconds. A cached response
// would hand it a board describing a service that has already moved on.
export const dynamic = "force-dynamic";

export default async function LiveOperationsPage() {
  // This board shows the till, so most orgs keep it to owners and managers —
  // but that is theirs to decide in the builder, not ours to hardcode. It also
  // renders a denial rather than a silent redirect: bouncing someone back to
  // the overview with no explanation reads as a broken link.
  const access = await checkModule("dashboard");
  if (!access.ok) {
    return (
      <ModuleDenied
        title="Live Operations"
        roleName={access.org?.myRole ?? "your role"}
      />
    );
  }

  const { org } = access;
  const snapshot = await liveSnapshot(org.id);

  return (
    <main className="pb-10">
      {/* A timestamp taken during this render would be the server's idea of
          "now" in the server's timezone, and the browser would disagree on
          hydration — so the board seeds its own clock after mount instead. */}
      <LiveBoard snapshot={snapshot} orgName={org.name} />
    </main>
  );
}
