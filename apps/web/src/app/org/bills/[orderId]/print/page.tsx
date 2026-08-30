import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AutoPrint, ThermalBill } from "@/components/org/bill/ThermalBill";
import { getBill } from "@/lib/ops";
import { getMyOrg } from "@/lib/org";
import { listTenders } from "../actions";

export const metadata: Metadata = { title: "Bill" };
export const dynamic = "force-dynamic";

/**
 * /org/bills/<id>/print — one job: put an 80mm roll through the printer.
 *
 * It is a separate route rather than a hidden div on the bill screen so the
 * biller can reprint a settled bill days later from a link, and so the print
 * dialog is never one stray Cmd-P away from printing the whole POS.
 */

/**
 * Same list as the bill screen — a captain may read and print a bill, a cook or
 * a waiter may not. Without it this route is a side door onto the same money the
 * bill screen gates, since the /org layout only checks that you are signed in.
 */
const BILL_ROLES = new Set(["org_admin", "manager", "biller", "captain"]);

/** Same IST rule as the bill screen: the roll carries the outlet's clock. */
function stamp(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default async function PrintBillPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const org = await getMyOrg();
  if (!org) redirect(`/login?next=/org/bills/${orderId}/print`);
  // A print window has nowhere to put an explanation, so a role that may not
  // see the bill gets the same 404 a foreign order id would get.
  if (!BILL_ROLES.has(org.myRole)) notFound();

  const view = await getBill(org.id, orderId);
  if (!view) notFound();

  const tenders = await listTenders(orderId);

  return (
    <>
      <ThermalBill
        view={view}
        orgName={org.name}
        billedAt={stamp(view.order.created_at)}
        tenders={tenders.map((t) => ({ id: t.id, method: t.method, amount: t.amount }))}
      />
      <AutoPrint orderId={orderId} />
    </>
  );
}
