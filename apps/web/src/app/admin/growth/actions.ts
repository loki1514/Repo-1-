"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  advanceLead,
  createLead,
  recordInteraction,
  type InteractionKind,
  type LeadSource,
  type LeadStatus,
} from "@/lib/leads";
import {
  advanceDeal,
  startScoping,
  updateDealBrief,
  type DealStatus,
} from "@/lib/deals";
import { recordPayment, type DealPaymentMethod } from "@/lib/os/money";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Attributed the instant it exists (docs/os claude .txt:431) — no draft state. */
export async function createLeadAction(formData: FormData): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();

    const businessName = String(formData.get("businessName") ?? "").trim();
    if (!businessName) return { ok: false, error: "Business name is required." };

    const source = String(formData.get("source") ?? "cold") as LeadSource;
    const assignedTo = String(formData.get("assignedTo") ?? "").trim() || null;

    await createLead({
      businessName,
      contactName: String(formData.get("contactName") ?? "").trim() || null,
      contactPhone: String(formData.get("contactPhone") ?? "").trim() || null,
      source,
      referrerName: String(formData.get("referrerName") ?? "").trim() || null,
      assignedTo,
      createdBy: admin.id,
    });

    revalidatePath("/admin/growth");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.replace(/^createLead:\s*/, "") : "Could not create the lead." };
  }
}

/** Moves a lead forward and records why — the "six months later" guarantee. */
export async function advanceLeadAction(
  leadId: string,
  toStatus: LeadStatus,
  note: string,
): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    await advanceLead(leadId, toStatus, note, admin.id);
    revalidatePath("/admin/growth");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.replace(/^advanceLead:\s*/, "") : "Could not update the lead." };
  }
}

/** Omkar picking up scoping the moment a lead is qualified — one deal per lead. */
export async function startScopingAction(leadId: string): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    await startScoping(leadId, admin.id);
    revalidatePath("/admin/growth");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.replace(/^startScoping:\s*/, "") : "Could not start scoping." };
  }
}

/** Edits the brief and quote in place — the document, not a log of edits. */
export async function updateDealBriefAction(
  dealId: string,
  input: { brief: string; quoteAmount: string; plan: string },
): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
    const amount = input.quoteAmount.trim() ? Number(input.quoteAmount) : null;
    if (input.quoteAmount.trim() && (amount === null || Number.isNaN(amount))) {
      return { ok: false, error: "Quote amount must be a number." };
    }
    await updateDealBrief(dealId, { brief: input.brief, quoteAmount: amount, plan: input.plan });
    revalidatePath("/admin/growth");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.replace(/^updateDealBrief:\s*/, "") : "Could not save the brief." };
  }
}

/**
 * Gap 5 — the payment itself. "Won" is no longer a button someone presses;
 * it is a consequence of money being recorded against the deal.
 */
export async function recordPaymentAction(
  dealId: string,
  input: { amount: string; method: string; reference: string },
): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    const amount = Number(input.amount);
    if (!input.amount.trim() || Number.isNaN(amount) || amount <= 0) {
      return { ok: false, error: "Enter the amount received." };
    }
    await recordPayment({
      dealId,
      amount,
      method: input.method as DealPaymentMethod,
      reference: input.reference,
      actor: admin.id,
    });
    revalidatePath("/admin/growth");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.replace(/^recordPayment:\s*/, "") : "Could not record the payment." };
  }
}

/** Rahul approving the quote, Sunita's payment landing as won. */
export async function advanceDealAction(
  dealId: string,
  toStatus: DealStatus,
  note: string,
): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    await advanceDeal(dealId, toStatus, note, admin.id);
    revalidatePath("/admin/growth");
    revalidatePath("/admin/organizations");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.replace(/^advanceDeal:\s*/, "") : "Could not update the deal." };
  }
}

/** Day 1 §5.4 — a call, a meeting, a message, kept as its own record. */
export async function recordInteractionAction(
  leadId: string,
  kind: string,
  summary: string,
  participants: string,
): Promise<ActionResult> {
  try {
    const admin = await requirePlatformAdmin();
    if (!summary.trim()) return { ok: false, error: "Say what happened." };
    await recordInteraction({
      leadId,
      kind: kind as InteractionKind,
      summary,
      participants,
      actor: admin.id,
    });
    revalidatePath("/admin/growth");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.replace(/^recordInteraction:\s*/, "") : "Could not record that." };
  }
}
