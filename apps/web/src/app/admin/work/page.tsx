import type { Metadata } from "next";
import { requireSection } from "@/lib/platform-admin";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listWorkItems, listNotifications, type WorkItem } from "@/lib/os/kernel";
import { WorkQueue } from "@/components/admin/os/WorkQueue";

export const metadata: Metadata = { title: "Work" };
export const dynamic = "force-dynamic";

/**
 * The cross-organization work queue.
 *
 * Work items are created by the orchestrator against an organization, but a
 * person does not think in organizations — they think "what does my team owe
 * today". Without this screen the OS still runs, but only someone who already
 * knows which organization to open can see it, which is exactly the manual
 * hop the OS is supposed to remove.
 */
export default async function WorkPage() {
  const me = await requireSection("work");

  const [items, notifications] = await Promise.all([
    listWorkItems({ openOnly: true }),
    listNotifications(20),
  ]);

  const orgIds = [...new Set(items.map((i) => i.organization_id).filter(Boolean))] as string[];
  const { data: orgs } = orgIds.length
    ? await supabaseAdmin.from("organizations").select("id, name, onboarding_stage").in("id", orgIds)
    : { data: [] };

  const orgById = Object.fromEntries(
    (orgs ?? []).map((o) => [o.id as string, { name: o.name as string, stage: o.onboarding_stage as string | null }]),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-h1">Work</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          Every open item across every organization, by the team that owes it. Nothing here was
          typed in by a person — each item was created by the OS when the step before it finished.
        </p>
      </div>
      <WorkQueue
        items={items as WorkItem[]}
        orgById={orgById}
        notifications={notifications}
        myTeam={me.team}
        myName={me.fullName ?? me.email}
      />
    </div>
  );
}
