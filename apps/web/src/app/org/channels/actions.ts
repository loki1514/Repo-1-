"use server";

import { revalidatePath } from "next/cache";
import { getMyOrg } from "@/lib/org";
import { listChannels, setChannelAccepting, setItemChannelAvailability } from "@/lib/ops";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Store on/off and per-item availability.
 *
 * Everything here re-derives the organization from the session. The client
 * never names a tenant — it only names a channel and an item, and both are
 * checked against the org we resolved, because the ops layer runs on
 * service_role and will write whatever it is handed.
 */

/** Deciding what the outlet sells is a manager's call, not a biller's. */
const MANAGE_ROLES = new Set(["org_admin", "manager"]);

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Failures come back as values rather than exceptions: the screen is
 * optimistic, so the message is what tells the manager the row they just
 * flipped has rolled back underneath them.
 */
function fail(e: unknown): ActionResult {
  return {
    ok: false,
    error: e instanceof Error ? e.message : "That didn't save. Try again.",
  };
}

async function requireChannelManager() {
  const org = await getMyOrg();
  if (!org) throw new Error("Not signed in.");
  if (!MANAGE_ROLES.has(org.myRole)) {
    throw new Error("Channels are managed by the outlet manager.");
  }
  return org;
}

/**
 * A channel slug only means something if this org actually has that row.
 * `setItemChannelAvailability` upserts, so an unknown slug would otherwise
 * quietly create availability rows for a channel that does not exist.
 */
async function assertChannel(orgId: string, channel: string): Promise<void> {
  const channels = await listChannels(orgId);
  if (!channels.some((c) => c.channel === channel)) {
    throw new Error("That sales channel isn't set up for this outlet.");
  }
}

/**
 * item_channel_status carries organization_id alongside menu_item_id, and the
 * foreign key does not tie the two together — an id lifted from another tenant
 * would land under ours. Cheaper to verify than to explain later.
 */
async function assertItem(orgId: string, menuItemId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .select("id")
    .eq("id", menuItemId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`assertItem: ${error.message}`);
  if (!data) throw new Error("That item isn't on this menu.");
}

export async function setChannelAcceptingAction(
  channel: string,
  accepting: boolean,
  reopenAtIso: string | null,
): Promise<ActionResult> {
  try {
    const org = await requireChannelManager();
    await assertChannel(org.id, channel);

    // The client computed the reopen moment from the duration the manager
    // picked; it is stored verbatim, but only ever as a future instant — a
    // timestamp already in the past would read as "open" and hide the outage.
    const reopenAt =
      !accepting && reopenAtIso && new Date(reopenAtIso).getTime() > Date.now()
        ? reopenAtIso
        : null;

    await setChannelAccepting(org.id, channel, accepting, reopenAt);
    revalidatePath("/org/channels");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** `hours` null = off indefinitely. Ignored entirely when switching back on. */
export async function setItemAvailabilityAction(
  menuItemId: string,
  channel: string,
  available: boolean,
  hours: number | null,
): Promise<ActionResult> {
  try {
    const org = await requireChannelManager();
    await Promise.all([assertChannel(org.id, channel), assertItem(org.id, menuItemId)]);

    // Clamped to a fortnight: anything longer is what "Indefinite" is for, and
    // an off_until years out is indistinguishable from a mistake.
    const window =
      available || hours === null || !Number.isFinite(hours) || hours <= 0
        ? null
        : Math.min(hours, 24 * 14);

    await setItemChannelAvailability(org.id, menuItemId, channel, available, window);
    revalidatePath("/org/channels");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
