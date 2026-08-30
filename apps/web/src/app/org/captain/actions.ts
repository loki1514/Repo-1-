"use server";

import { revalidatePath } from "next/cache";
import { requireModule } from "@/lib/module-guard";
import { supabaseServer } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createOrder } from "@/lib/pos";
import { fireKot } from "@/lib/ops";
import { logOrderEvent } from "@/lib/guest";

/**
 * Captain actions.
 *
 * The browser sends a table id and a list of (item, variant, qty). It never
 * sends an organization, a price or a name: the org comes from getMyOrg(), the
 * prices are re-read from the menu, and the captain's name comes from the
 * session. A tampered payload can therefore order the wrong dish, but never at
 * the wrong price and never onto another restaurant's floor.
 */

export type CaptainLine = {
  menu_item_id: string;
  variant_id: string | null;
  qty: number;
};

export type SendResult =
  | { ok: true; kotNo: number; orderId: string; displayNo: string }
  | { ok: false; error: string };

/** "captain.ravi@mysoredininghall.example" → "Captain Ravi". */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(" ") : "Captain";
}

/**
 * The signed-in captain, derived once and used in two places: the header they
 * read and the `captain_name` stamped on every order they place. Exported as
 * an action so the page and the mutation cannot drift apart on who this is.
 */
export async function captainIdentity(): Promise<{ name: string; email: string }> {
  await requireModule("orders", "Taking orders at the table");

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? "";

  return { name: email ? nameFromEmail(email) : "Captain", email };
}

export async function sendOrderAction(
  tableId: string,
  lines: CaptainLine[],
): Promise<SendResult> {
  let org;
  try {
    org = await requireModule("orders", "Taking orders at the table");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }
  if (lines.length === 0) return { ok: false, error: "Add something before sending." };

  const me = await captainIdentity();

  // The table is re-fetched inside the org rather than trusted, so a table id
  // lifted from another tenant simply does not resolve.
  const { data: table } = await supabaseAdmin
    .from("dining_tables")
    .select("id, label")
    .eq("id", tableId)
    .eq("organization_id", org.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!table) return { ok: false, error: "That table is not on this floor any more." };

  const ids = [...new Set(lines.map((l) => l.menu_item_id))];
  const [{ data: menuRows, error: menuErr }, { data: variantRows, error: varErr }] =
    await Promise.all([
      supabaseAdmin
        .from("menu_items")
        .select("id, name, price, is_available, course, station")
        .eq("organization_id", org.id)
        .in("id", ids),
      supabaseAdmin
        .from("menu_item_variants")
        .select("id, menu_item_id, name, price")
        .eq("organization_id", org.id)
        .in("menu_item_id", ids),
    ]);
  if (menuErr) return { ok: false, error: `Could not read the menu: ${menuErr.message}` };
  if (varErr) return { ok: false, error: `Could not read the menu: ${varErr.message}` };

  const menu = new Map((menuRows ?? []).map((m) => [m.id, m]));
  const variants = new Map((variantRows ?? []).map((v) => [v.id, v]));

  const priced = lines.flatMap((l) => {
    const item = menu.get(l.menu_item_id);
    if (!item || !item.is_available) return [];

    const variant = l.variant_id ? variants.get(l.variant_id) : null;
    // A variant id belonging to a different dish is treated as absent — not as
    // permission to price this dish from someone else's menu row.
    const usable = variant && variant.menu_item_id === l.menu_item_id ? variant : null;

    return [
      {
        menu_item_id: item.id,
        name: item.name,
        variant_name: usable?.name ?? null,
        qty: Math.max(1, Math.min(Math.floor(l.qty), 99)),
        unit_price: Number(usable?.price ?? item.price),
        course: item.course as string,
        station: item.station as string,
      },
    ];
  });

  if (priced.length === 0) {
    return { ok: false, error: "Those dishes have gone off the menu. Check with the kitchen." };
  }

  const order = await createOrder({
    organizationId: org.id,
    channel: "dine_in",
    table_id: table.id,
    captain_name: me.name,
    lines: priced.map((p) => ({
      menu_item_id: p.menu_item_id,
      name: p.name,
      qty: p.qty,
      unit_price: p.unit_price,
    })),
  });

  // If the party already has a live session, the captain's round joins their
  // bill instead of opening a second one — otherwise the guests see half their
  // food on their own phones and the table gets two bills at the end.
  const { data: session } = await supabaseAdmin
    .from("table_sessions")
    .select("id, guest_count")
    .eq("organization_id", org.id)
    .eq("table_id", table.id)
    .neq("status", "closed")
    .maybeSingle();

  await supabaseAdmin
    .from("orders")
    .update({
      placed_by: "captain",
      session_id: session?.id ?? null,
      guest_count: session?.guest_count ?? 1,
    })
    .eq("id", order.id);

  // createOrder predates variants and stations (0006), so the fields that route
  // a line to the right KOT screen and print the right size are filled in here.
  // Matched on item + price because that pair is exactly one cart line.
  await Promise.all(
    priced.map((p) =>
      supabaseAdmin
        .from("order_items")
        .update({ variant_name: p.variant_name, course: p.course, station: p.station })
        .eq("order_id", order.id)
        .eq("menu_item_id", p.menu_item_id)
        .eq("unit_price", p.unit_price),
    ),
  );

  await logOrderEvent(org.id, order.id, {
    kind: "placed",
    message: `${me.name} took ${priced.length} item${priced.length === 1 ? "" : "s"} at table ${table.label}`,
    actor: "captain",
  });

  const fired = await fireKot(org.id, order.id, "captain");
  revalidatePath("/org/captain");

  if ("error" in fired) {
    // The order is saved either way; saying so stops the captain re-entering
    // the whole round and double-feeding the table.
    return {
      ok: false,
      error: `Order ${order.display_no} is saved, but no KOT printed: ${fired.error}`,
    };
  }

  return { ok: true, kotNo: fired.kotNo, orderId: order.id, displayNo: order.display_no };
}
