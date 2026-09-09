"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  addTrainee,
  buildDemoPlanFromRequirements,
  captureFeedback,
  createDiscoverySession,
  disposeFeedback,
  ensureReadiness,
  recordDiscoveryOutcome,
  setDemoItemCovered,
  setReadinessItem,
  setTrainingComplete,
  type FeedbackDisposition,
} from "@/lib/os/success";
import { decideBotRun, runHandoffBot } from "@/lib/os/bot";

export type CsResult = { ok: true; cascade: string[] } | { ok: false; error: string };

const fail = (err: unknown, fallback: string): CsResult => ({
  ok: false,
  error: err instanceof Error ? err.message.replace(/^[a-zA-Z]+:\s*/, "") : fallback,
});

const touch = (orgId: string) => {
  revalidatePath(`/admin/success/${orgId}`);
  revalidatePath("/admin/success");
  revalidatePath(`/admin/organizations/${orgId}`);
};

// --- §7 discovery ----------------------------------------------------------

export async function createDiscoveryAction(
  organizationId: string,
  objective: string,
  participants: string,
): Promise<CsResult> {
  try {
    const me = await requirePlatformAdmin();
    if (!objective.trim()) return { ok: false, error: "What is this session for?" };
    await createDiscoverySession({ organizationId, objective, participants, owner: me.id });
    touch(organizationId);
    return { ok: true, cascade: ["Discovery session scheduled"] };
  } catch (err) {
    return fail(err, "Could not create the session.");
  }
}

export async function recordDiscoveryAction(
  organizationId: string,
  sessionId: string,
  decisions: string,
  openQuestions: string,
  confirmed: boolean,
): Promise<CsResult> {
  try {
    await requirePlatformAdmin();
    await recordDiscoveryOutcome({ sessionId, decisions, openQuestions, customerConfirmed: confirmed });
    touch(organizationId);
    return {
      ok: true,
      cascade: confirmed
        ? ["Outcome recorded, and the customer has confirmed it"]
        : ["Outcome recorded — the customer has not confirmed it yet"],
    };
  } catch (err) {
    return fail(err, "Could not record the outcome.");
  }
}

// --- §9 demo plan ----------------------------------------------------------

export async function buildDemoPlanAction(organizationId: string): Promise<CsResult> {
  try {
    const me = await requirePlatformAdmin();
    const { items, skipped } = await buildDemoPlanFromRequirements(organizationId, me.id);
    touch(organizationId);
    const cascade = [
      `Demo plan built from ${items.length} confirmed requirement${items.length === 1 ? "" : "s"}`,
      "Each item names the screen that proves it and what the customer must agree to",
    ];
    if (skipped > 0) {
      cascade.push(`${skipped} product gap${skipped === 1 ? "" : "s"} left out — a gap cannot be demonstrated`);
    }
    return { ok: true, cascade };
  } catch (err) {
    return fail(err, "Could not build the demo plan.");
  }
}

export async function toggleDemoItemAction(
  organizationId: string,
  itemId: string,
  covered: boolean,
): Promise<CsResult> {
  try {
    await requirePlatformAdmin();
    await setDemoItemCovered(itemId, covered);
    touch(organizationId);
    return { ok: true, cascade: [] };
  } catch (err) {
    return fail(err, "Could not update that item.");
  }
}

// --- §10 feedback ----------------------------------------------------------

export async function captureFeedbackAction(
  organizationId: string,
  body: string,
  saidBy: string,
  screen: string,
): Promise<CsResult> {
  try {
    const me = await requirePlatformAdmin();
    if (!body.trim()) return { ok: false, error: "Write what the customer actually said." };
    await captureFeedback({ organizationId, body, saidBy, screen, createdBy: me.id });
    touch(organizationId);
    return { ok: true, cascade: ["Captured against the screen it was said about"] };
  } catch (err) {
    return fail(err, "Could not capture that.");
  }
}

export async function disposeFeedbackAction(
  organizationId: string,
  feedbackId: string,
  disposition: FeedbackDisposition,
): Promise<CsResult> {
  try {
    await requirePlatformAdmin();
    await disposeFeedback(feedbackId, disposition);
    touch(organizationId);
    return {
      ok: true,
      cascade: [`Dispositioned as ${disposition.replace(/_/g, " ")} — that decides who acts on it next`],
    };
  } catch (err) {
    return fail(err, "Could not set that disposition.");
  }
}

// --- §11 training ----------------------------------------------------------

export async function addTraineeAction(
  organizationId: string,
  personName: string,
  roleLabel: string,
  topics: string,
): Promise<CsResult> {
  try {
    const me = await requirePlatformAdmin();
    if (!personName.trim()) return { ok: false, error: "Who is being trained?" };
    await addTrainee({ organizationId, personName, roleLabel, topics, createdBy: me.id });
    touch(organizationId);
    return { ok: true, cascade: ["Added to the training plan"] };
  } catch (err) {
    return fail(err, "Could not add that person.");
  }
}

export async function setTrainingCompleteAction(
  organizationId: string,
  id: string,
  completed: boolean,
): Promise<CsResult> {
  try {
    await requirePlatformAdmin();
    await setTrainingComplete(id, completed);
    touch(organizationId);
    return { ok: true, cascade: [] };
  } catch (err) {
    return fail(err, "Could not update training.");
  }
}

// --- §12 readiness ---------------------------------------------------------

export async function seedReadinessAction(organizationId: string): Promise<CsResult> {
  try {
    await requirePlatformAdmin();
    const items = await ensureReadiness(organizationId);
    touch(organizationId);
    return { ok: true, cascade: [`Readiness checklist opened — ${items.length} items`] };
  } catch (err) {
    return fail(err, "Could not open the checklist.");
  }
}

export async function setReadinessAction(
  organizationId: string,
  id: string,
  passed: boolean,
  note: string,
): Promise<CsResult> {
  try {
    const me = await requirePlatformAdmin();
    await setReadinessItem(id, passed, me.id, note);
    touch(organizationId);
    return { ok: true, cascade: [] };
  } catch (err) {
    return fail(err, "Could not update that check.");
  }
}

// --- Day 1 §12 the bot -----------------------------------------------------

export async function runHandoffBotAction(organizationId: string): Promise<CsResult> {
  try {
    const me = await requirePlatformAdmin();
    const run = await runHandoffBot(organizationId, me.id);
    touch(organizationId);
    if (run.error) return { ok: false, error: run.error };
    return {
      ok: true,
      cascade: [
        "Draft brief generated from the sales context only",
        "Nothing was changed — a draft is not an OS fact until you approve it",
      ],
    };
  } catch (err) {
    return fail(err, "The bot could not run.");
  }
}

export async function decideBotRunAction(
  organizationId: string,
  runId: string,
  approve: boolean,
): Promise<CsResult> {
  try {
    const me = await requirePlatformAdmin();
    const cascade = await decideBotRun(runId, approve, me.id);
    touch(organizationId);
    return { ok: true, cascade };
  } catch (err) {
    return fail(err, "Could not record that decision.");
  }
}
