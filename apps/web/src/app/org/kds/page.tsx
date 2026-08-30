import type { Metadata } from "next";
import { checkModule } from "@/lib/module-guard";
import { listKotBoard } from "@/lib/ops";
import { KdsBoard } from "@/components/org/kds/KdsBoard";
import { ModuleDenied } from "@/components/org/ModuleDenied";

export const metadata: Metadata = { title: "Kitchen Display" };

// A cached render here would show the pass a ticket somebody already bumped.
export const dynamic = "force-dynamic";

/**
 * The clock for this request, read through a helper because a bare Date.now()
 * in a component body is (correctly) flagged as impure. A dynamic server
 * component renders exactly once per request, so there is no instability to
 * guard against here — and reading it on the server is the whole point.
 */
function requestClock(): number {
  return Date.now();
}

export default async function KdsPage() {
  // Who may stand at the pass is configuration, not a constant — see
  // lib/module-guard.ts.
  const access = await checkModule("kds_kot");
  if (!access.ok) {
    return (
      <ModuleDenied
        title="Kitchen Display"
        roleName={access.org?.myRole ?? "your role"}
      />
    );
  }

  const tickets = await listKotBoard(access.org.id);

  // The clock is handed down rather than read in the browser so the first paint
  // hydrates against the same number the server rendered; the client ticker
  // takes over on the next beat.
  return <KdsBoard tickets={tickets} serverNow={requestClock()} />;
}
