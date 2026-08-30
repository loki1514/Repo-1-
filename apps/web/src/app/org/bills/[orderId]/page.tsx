import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { BillPanel } from "@/components/org/bill/BillPanel";
import { getBill } from "@/lib/ops";
import { getMyOrg } from "@/lib/org";
import { listTenders } from "./actions";

export const metadata: Metadata = { title: "Bill" };
export const dynamic = "force-dynamic";

/** Who may open a bill. A captain reads and prints; only TILL_ROLES settles. */
const BILL_ROLES = new Set(["org_admin", "manager", "biller", "captain"]);
/** Mirrors actions.ts. This decides what is *drawn*; the action decides what runs. */
const TILL_ROLES = new Set(["org_admin", "manager", "biller"]);

/**
 * Timestamps are stamped in IST wherever the server happens to run — an Indian
 * restaurant's bill is not allowed to shift by five and a half hours because a
 * region changed.
 */
function stamp(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default async function BillPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const org = await getMyOrg();
  if (!org) redirect(`/login?next=/org/bills/${orderId}`);

  if (!BILL_ROLES.has(org.myRole)) {
    return (
      <div className="glass rounded-[var(--r-xl)] p-8 text-center">
        <div className="relative z-10 mx-auto max-w-sm space-y-3">
          <ShieldAlert size={28} className="mx-auto text-[var(--warn)]" />
          <h1 className="t-h3">Bill access needed</h1>
          <p className="text-[14px] text-muted">
            Bills are open to admins, managers, billers and captains. Ask your
            admin to update your role.
          </p>
        </div>
      </div>
    );
  }

  // getBill is org-scoped, so a stray order id from another tenant simply is
  // not found — the 404 is the tenancy boundary, not a separate check.
  const view = await getBill(org.id, orderId);
  if (!view) notFound();

  const tenders = await listTenders(orderId);

  return (
    <main className="pb-10">
      <div className="mb-4 flex flex-wrap items-center gap-3 pt-1">
        <ButtonLink href="/org/tables" variant="glass" size="sm">
          <ArrowLeft size={15} strokeWidth={2.5} />
          Floor
        </ButtonLink>
        <h1 className="t-h2">Bill</h1>
        <p className="t-small ml-auto text-muted">{org.name}</p>
      </div>

      <BillPanel
        view={view}
        tenders={tenders.map((t) => ({
          id: t.id,
          method: t.method,
          amount: t.amount,
          reference: t.reference,
          at: stamp(t.created_at),
        }))}
        canSettle={TILL_ROLES.has(org.myRole)}
        printHref={`/org/bills/${orderId}/print`}
      />
    </main>
  );
}
