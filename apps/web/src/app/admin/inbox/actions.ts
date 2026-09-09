"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function markReadAction(id: string): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/inbox");
  return { ok: true };
}

export async function markAllReadAction(): Promise<{ ok: boolean }> {
  const me = await requirePlatformAdmin();
  await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null)
    .or(`user_id.eq.${me.id},team.eq.${me.team}`);
  revalidatePath("/admin/inbox");
  revalidatePath("/admin");
  return { ok: true };
}
