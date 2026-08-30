"use server";

/**
 * Bumps from the kitchen display.
 *
 * Both actions re-derive the organization from the session rather than trusting
 * anything the wall screen sends — a KDS tablet is the least supervised device
 * in the building, and an id posted from it is just a string. ops.ts does the
 * rest: it reconciles the order's status from its lines and writes the order
 * event, so nothing here needs to touch either.
 */

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/module-guard";
import { setKotStatus, setLineStatus } from "@/lib/ops";

type Result = { ok: true } | { ok: false; error: string };

/** The pass only moves forward; 'pending' and 'cancelled' are not reachable here. */
const FORWARD: ReadonlySet<string> = new Set(["preparing", "ready", "delivered"]);

// Who stands at the pass is the org's decision, made in the builder — the
// same check the page runs, so nobody is shown a button they will be refused.
const kitchenOrg = () => requireModule("kds_kot", "The kitchen display");

/** ops.ts prefixes its throws with the function name; nobody reads that across a kitchen. */
function fail(err: unknown): Result {
  const msg = err instanceof Error ? err.message : "That did not go through. Try again.";
  return { ok: false, error: msg.replace(/^\w+(\s\([\w ]+\))?:\s*/, "") };
}

export async function bumpTicketAction(
  kotId: string,
  next: "preparing" | "ready" | "delivered",
): Promise<Result> {
  try {
    const org = await kitchenOrg();
    if (!FORWARD.has(next)) throw new Error("Unknown ticket state.");
    await setKotStatus(org.id, kotId, next);
    revalidatePath("/org/kds");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function bumpLineAction(
  itemId: string,
  next: "preparing" | "ready" | "delivered",
): Promise<Result> {
  try {
    const org = await kitchenOrg();
    if (!FORWARD.has(next)) throw new Error("Unknown dish state.");
    await setLineStatus(org.id, itemId, next);
    revalidatePath("/org/kds");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
