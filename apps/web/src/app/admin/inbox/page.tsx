import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listActivities } from "@/lib/os/kernel";
import { InboxList } from "@/components/admin/os/InboxList";

export const metadata: Metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

/**
 * Day 1 §4 "Activity / Notification Center" and Day 2 FR-11.
 *
 * Signals on the left, the ecosystem's activity on the right. Notifications
 * are projections of events, never the source of truth — so nothing here can
 * be acted on directly; each one links to the record that can.
 */
export default async function InboxPage() {
  const me = await requirePlatformAdmin();

  const { data: notifications } = await supabaseAdmin
    .from("notifications")
    .select("id, team, user_id, title, body, link, read_at, created_at")
    .or(
      me.role === "master_admin"
        ? `user_id.eq.${me.id},team.not.is.null`
        : `user_id.eq.${me.id},team.eq.${me.team}`,
    )
    .order("created_at", { ascending: false })
    .limit(60);

  const activities = await listActivities({ limit: 40 });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="t-h1">Inbox</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          Signals addressed to you or your team, and what has been happening across the
          platform. A signal is a pointer — the work item or the organization it names is
          where the truth lives.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <InboxList notifications={notifications ?? []} />

        <div className="glass rounded-[var(--r-xl)] p-4">
          <div className="relative z-10">
            <h2 className="text-[14px] font-extrabold">Recent activity</h2>
            {activities.length === 0 ? (
              <p className="t-small mt-3 py-4 text-center text-muted">Nothing yet.</p>
            ) : (
              <ol className="mt-3 space-y-1.5">
                {activities.map((a) => (
                  <li key={a.id} className="text-[12.5px] leading-snug text-ink-2">
                    <span className="tnum text-muted">
                      {new Date(a.created_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {" · "}
                    {a.organization_id ? (
                      <Link
                        href={`/admin/organizations/${a.organization_id}`}
                        className="font-semibold text-[var(--lime-deep)]"
                      >
                        {a.summary}
                      </Link>
                    ) : (
                      a.summary
                    )}
                    <span
                      className="ml-2 text-[10.5px] font-bold uppercase tracking-wide"
                      style={{ color: a.actor_label === "system" ? "var(--lime-deep)" : "var(--muted)" }}
                    >
                      {a.actor_label}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
