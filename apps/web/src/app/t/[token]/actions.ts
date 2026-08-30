"use server";

import { revalidatePath } from "next/cache";
import {
  callWaiter,
  currentSessionForTable,
  openOrJoinSession,
  placeGuestOrder,
  resolveQrToken,
  type GuestLine,
} from "@/lib/guest";

/**
 * Guest actions.
 *
 * Every one of these starts from the QR token and re-derives the table, the
 * session and the organization from the database. Nothing the browser sends —
 * not an org id, not a price, not a session id — is trusted as authorization.
 */

async function context(token: string) {
  const table = await resolveQrToken(token);
  if (!table) return null;
  const session = await currentSessionForTable(table.tableId);
  return { table, session };
}

export async function startSessionAction(token: string, guests: number) {
  const table = await resolveQrToken(token);
  if (!table) return { ok: false as const, error: "This QR code is no longer active." };

  await openOrJoinSession(table, guests);
  revalidatePath(`/t/${token}`);
  return { ok: true as const };
}

export async function placeOrderAction(token: string, lines: GuestLine[]) {
  const ctx = await context(token);
  if (!ctx?.session) return { ok: false as const, error: "Your table session has ended." };

  const result = await placeGuestOrder(ctx.session, lines);
  if ("error" in result) return { ok: false as const, error: result.error };

  revalidatePath(`/t/${token}`);
  return { ok: true as const, displayNo: result.display_no };
}

export async function callWaiterAction(
  token: string,
  kind: "water" | "cutlery" | "clean_up" | "bill" | "assistance" | "other",
  note?: string,
) {
  const ctx = await context(token);
  if (!ctx?.session) return { ok: false as const, error: "Your table session has ended." };

  await callWaiter(ctx.session, kind, note);
  revalidatePath(`/t/${token}`);
  return { ok: true as const };
}
