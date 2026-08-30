"use server";

import { revalidatePath } from "next/cache";
import { logOrderEvent } from "@/lib/guest";
import { fireKot, settleBill } from "@/lib/ops";
import { getMyOrg } from "@/lib/org";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Everything the bill screen is allowed to do.
 *
 * Each action re-derives the organization from the signed-in session and hands
 * that id to the ops layer; no organization id, price or total is ever taken
 * from the browser. The client says *how* the guest paid — settleBill()
 * recomputes *how much* from the stored lines, so a tampered payload can only
 * get itself rejected.
 */

export type TenderMethod = "cash" | "upi" | "card" | "due" | "other";
export type Tender = { method: TenderMethod; amount: number; reference?: string };

/** Mirrors the payments.method CHECK in migration 0010 — keep the two in step. */
const METHODS: ReadonlySet<string> = new Set(["cash", "upi", "card", "due", "other"]);

/**
 * Who may take money. A captain can open a bill and print it (see page.tsx);
 * only these three can close it, and this check — not the UI — is the one that
 * counts.
 */
const TILL_ROLES: ReadonlySet<string> = new Set(["org_admin", "manager", "biller"]);

type Denied = { error: string };

async function till(): Promise<{ orgId: string; actor: string } | Denied> {
  const org = await getMyOrg();
  if (!org) return { error: "Your session has expired — sign in again." };
  if (!TILL_ROLES.has(org.myRole)) {
    return { error: "Only a biller, manager or admin can settle a bill." };
  }
  return { orgId: org.id, actor: org.myRole };
}

export async function settleBillAction(
  orderId: string,
  tenders: Tender[],
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const ctx = await till();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  // Shape-check before the database sees it: an unknown method would otherwise
  // surface as a CHECK-constraint violation, which reaches the biller as a
  // blank 500 in the middle of taking cash.
  const clean = tenders
    .filter((t) => Number.isFinite(t.amount) && t.amount > 0)
    .map((t) => ({
      method: t.method,
      amount: Math.round(t.amount * 100) / 100,
      reference: t.reference?.trim() || undefined,
    }));

  if (clean.length === 0) return { ok: false, error: "Enter what the guest paid." };
  if (clean.length > 2) return { ok: false, error: "A bill splits across at most two tenders." };
  if (clean.some((t) => !METHODS.has(t.method))) {
    return { ok: false, error: "That is not a payment method this outlet accepts." };
  }

  const result = await settleBill(ctx.orgId, orderId, clean, ctx.actor);
  if ("error" in result) return { ok: false, error: result.error };

  // The floor view colours a table from its open orders, so it goes stale the
  // moment this one closes.
  revalidatePath(`/org/bills/${orderId}`);
  revalidatePath("/org/tables");
  revalidatePath("/org/live");
  return { ok: true, total: result.total };
}

export async function fireKotAction(
  orderId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const ctx = await till();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const result = await fireKot(ctx.orgId, orderId, ctx.actor);
  if ("error" in result) return { ok: false, error: result.error };

  revalidatePath(`/org/bills/${orderId}`);
  revalidatePath("/org/kds");
  return {
    ok: true,
    message: `KOT #${result.kotNo} sent — ${result.lines} line${result.lines === 1 ? "" : "s"}.`,
  };
}

export type Tendered = {
  id: string;
  method: string;
  amount: number;
  reference: string | null;
  created_at: string;
};

/**
 * The individual tenders behind a bill.
 *
 * getBill() returns only the *sum* paid, which is all the arithmetic needs —
 * but the settled panel and the printed receipt both have to say how the guest
 * paid, so the rows are read here rather than widening BillView for two
 * callers. Scoped by organization_id, so an order id from elsewhere returns
 * nothing rather than someone else's money.
 */
export async function listTenders(orderId: string): Promise<Tendered[]> {
  const org = await getMyOrg();
  if (!org) return [];

  const { data } = await supabaseAdmin
    .from("payments")
    .select("id, method, amount, reference, created_at")
    .eq("organization_id", org.id)
    .eq("order_id", orderId)
    .order("created_at");

  return (data ?? []).map((p) => ({ ...p, amount: Number(p.amount) }));
}

/**
 * A printed bill is what turns a running table into a "printed" one on the
 * floor, so each print earns a timeline entry. Fired after window.print(),
 * never during render — a write in a render pass runs again on every refetch.
 */
export async function logBillPrintAction(orderId: string): Promise<void> {
  const org = await getMyOrg();
  if (!org) return;

  // logOrderEvent trusts its arguments, so the order is confirmed to be this
  // org's before an audit line is written against it.
  const { data: owned } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!owned) return;

  await logOrderEvent(org.id, orderId, {
    kind: "bill_printed",
    message: "Bill printed",
    actor: org.myRole,
  });
}
