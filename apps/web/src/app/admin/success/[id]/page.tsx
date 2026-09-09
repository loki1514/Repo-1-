import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSection } from "@/lib/platform-admin";
import { getOrganization } from "@/lib/organizations";
import { listActivities, listRequirements, listWorkItems } from "@/lib/os/kernel";
import {
  getDemoPlan,
  listDemoPlanItems,
  listDiscoverySessions,
  listFeedback,
  listReadiness,
  listTraining,
} from "@/lib/os/success";
import { listBotRuns } from "@/lib/os/bot";
import { SuccessWorkspace } from "@/components/admin/os/SuccessWorkspace";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const org = await getOrganization(id);
  return { title: org ? `${org.name} · Customer Success` : "Customer Success" };
}

/**
 * Day 3 §6 — "a 360° operating workspace, not merely a profile page".
 *
 * Everything Customer Success needs about one customer, in the order the
 * journey happens: what Sales heard, what was validated, what will be
 * demonstrated, what came back from the demo, who was trained, and whether
 * this customer is ready to trade.
 */
export default async function SuccessDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSection("success");
  const { id } = await params;

  const organization = await getOrganization(id);
  if (!organization) notFound();

  const [requirements, work, discovery, plan, feedback, training, readiness, activities, botRuns] =
    await Promise.all([
      listRequirements(id),
      listWorkItems({ organizationId: id, openOnly: true }),
      listDiscoverySessions(id),
      getDemoPlan(id),
      listFeedback(id),
      listTraining(id),
      listReadiness(id),
      listActivities({ organizationId: id, limit: 40 }),
      listBotRuns(id),
    ]);

  const planItems = plan ? await listDemoPlanItems(plan.id) : [];

  return (
    <div className="space-y-5">
      <Link
        href="/admin/success"
        className="press inline-flex items-center gap-2 rounded-[12px] px-1 py-1 text-[13.5px] font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft size={15} strokeWidth={2.6} />
        Customer Success
      </Link>

      <div>
        <h1 className="t-h1">{organization.name}</h1>
        <p className="mt-1.5 text-[14px] text-muted">
          Customer Success workspace ·{" "}
          <Link href={`/admin/organizations/${id}`} className="font-semibold text-[var(--lime-deep)]">
            open the organization
          </Link>
        </p>
      </div>

      <SuccessWorkspace
        organizationId={id}
        organizationName={organization.name}
        stage={(organization as { onboarding_stage?: string | null }).onboarding_stage ?? null}
        requirements={requirements}
        openWork={work}
        discovery={discovery}
        demoPlan={plan}
        demoItems={planItems}
        feedback={feedback}
        training={training}
        readiness={readiness}
        activities={activities}
        botRuns={botRuns}
      />
    </div>
  );
}
