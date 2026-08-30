"use server";

import { revalidatePath } from "next/cache";
import { getMyOrg } from "@/lib/org";
import { resolveServiceRequest } from "@/lib/ops";

/**
 * Floor actions.
 *
 * The organization is re-derived from the signed-in session on every call. The
 * browser sends an id it found in its own props and nothing else, so a tampered
 * request can only ever name a row inside the caller's own tenant — the
 * organization_id filter inside the ops layer does the rest.
 */
export async function resolveRequestAction(requestId: string): Promise<void> {
  const org = await getMyOrg();
  if (!org) throw new Error("Not signed in to an organization.");

  await resolveServiceRequest(org.id, requestId);
  revalidatePath("/org/tables");
}
