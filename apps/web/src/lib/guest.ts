import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { computeBill, DEFAULT_CHARGES, type BillCharges } from "@/lib/bill";

/**
 * The guest side of the restaurant — everything reachable from the QR sticker
 * on the table, by someone with no account and no session.
 *
 * Authorization model, stated once because it is the whole security story:
 *
 *   • The QR token is the credential for the *table*. It is random and
 *     globally unique, so possessing it means you are (or were) at that table.
 *   • The 4-digit PIN is the credential for the *party*. It only ever widens
 *     access to a session already open on that same table.
 *   • Every mutation re-derives the organization from the row it is touching.
 *     Nothing trusts an organization id sent by the browser.
 *
 * All of this runs on service_role, deliberately. The alternative — opening
 * these tables to the `anon` Postgres role — would make every guest-reachable
 * policy a tenancy boundary, and there would be a dozen of them. Here there is
 * one boundary, in this file, and it is enforced by lookup rather than by
 * policy.
 */

export type GuestVariant = { id: string; name: string; price: number; is_default: boolean };

export type GuestMenuItem = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  food_type: "veg" | "non_veg" | "egg";
  course: "eat" | "drink";
  is_recommended: boolean;
  is_available: boolean;
  variants: GuestVariant[];
};

export type GuestCategory = { id: string; name: string; sort_order: number };

export type GuestTable = {
  tableId: string;
  label: string;
  areaName: string | null;
  orgId: string;
  orgName: string;
  orgSlug: string;
  theme: Record<string, unknown>;
};

export type GuestSession = {
  id: string;
  pin: string;
  tableId: string;
  organizationId: string;
  guestCount: number;
  status: "open" | "billed" | "closed";
  opened_at: string;
};

export type GuestOrderItem = {
  id: string;
  name: string;
  variant_name: string | null;
  qty: number;
  unit_price: number;
  status: "pending" | "preparing" | "ready" | "delivered" | "cancelled";
  course: string;
};

export type GuestOrder = {
  id: string;
  display_no: string;
  status: string;
  created_at: string;
  items: GuestOrderItem[];
};

// ---------------------------------------------------------------------------
// Table + session
// ---------------------------------------------------------------------------

/** Resolves a QR token to its table and organization. Null = bad or retired QR. */
export async function resolveQrToken(token: string): Promise<GuestTable | null> {
  const clean = token.trim().toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(clean)) return null;

  const { data, error } = await supabaseAdmin
    .from("dining_tables")
    .select(
      "id, label, is_active, organization_id, dining_areas(name), organizations!inner(id, name, slug, theme)",
    )
    .eq("qr_token", clean)
    .maybeSingle();

  if (error) throw new Error(`resolveQrToken: ${error.message}`);
  if (!data || !data.is_active) return null;

  const org = data.organizations as unknown as {
    id: string;
    name: string;
    slug: string;
    theme: Record<string, unknown> | null;
  };
  const area = data.dining_areas as unknown as { name: string } | null;

  return {
    tableId: data.id,
    label: data.label,
    areaName: area?.name ?? null,
    orgId: org.id,
    orgName: org.name,
    orgSlug: org.slug,
    theme: org.theme ?? {},
  };
}

function makePin(): string {
  // Four digits, never starting at 0 so the guest reads it back correctly and
  // it stays four characters in every font.
  return String(1000 + Math.floor(Math.random() * 9000));
}

/**
 * The first scan opens the table; every later scan lands on the same session.
 *
 * The partial unique index (one non-closed session per table) is the actual
 * guarantee. Two phones scanning simultaneously race here, one loses on the
 * index, and the loser simply re-reads — which is why the conflict path
 * re-selects instead of erroring.
 */
export async function openOrJoinSession(
  table: GuestTable,
  guestCount = 1,
): Promise<GuestSession> {
  const existing = await currentSessionForTable(table.tableId);
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from("table_sessions")
    .insert({
      organization_id: table.orgId,
      table_id: table.tableId,
      pin: makePin(),
      guest_count: Math.max(1, Math.min(guestCount, 40)),
    })
    .select("id, pin, table_id, organization_id, guest_count, status, opened_at")
    .single();

  if (error) {
    const raced = await currentSessionForTable(table.tableId);
    if (raced) return raced;
    throw new Error(`openOrJoinSession: ${error.message}`);
  }
  return shapeSession(data);
}

export async function currentSessionForTable(tableId: string): Promise<GuestSession | null> {
  const { data, error } = await supabaseAdmin
    .from("table_sessions")
    .select("id, pin, table_id, organization_id, guest_count, status, opened_at")
    .eq("table_id", tableId)
    .neq("status", "closed")
    .maybeSingle();

  if (error) throw new Error(`currentSessionForTable: ${error.message}`);
  return data ? shapeSession(data) : null;
}

/** Joining by PIN is scoped to one table — a PIN is not a key to the restaurant. */
export async function joinSessionByPin(
  tableId: string,
  pin: string,
): Promise<GuestSession | null> {
  if (!/^[0-9]{4}$/.test(pin)) return null;

  const { data, error } = await supabaseAdmin
    .from("table_sessions")
    .select("id, pin, table_id, organization_id, guest_count, status, opened_at")
    .eq("table_id", tableId)
    .eq("pin", pin)
    .neq("status", "closed")
    .maybeSingle();

  if (error) throw new Error(`joinSessionByPin: ${error.message}`);
  return data ? shapeSession(data) : null;
}

/** Confirms a cookie-held session really belongs to the scanned table. */
export async function sessionForTable(
  sessionId: string,
  tableId: string,
): Promise<GuestSession | null> {
  const { data, error } = await supabaseAdmin
    .from("table_sessions")
    .select("id, pin, table_id, organization_id, guest_count, status, opened_at")
    .eq("id", sessionId)
    .eq("table_id", tableId)
    .neq("status", "closed")
    .maybeSingle();

  if (error) throw new Error(`sessionForTable: ${error.message}`);
  return data ? shapeSession(data) : null;
}

function shapeSession(row: Record<string, unknown>): GuestSession {
  return {
    id: row.id as string,
    pin: row.pin as string,
    tableId: row.table_id as string,
    organizationId: row.organization_id as string,
    guestCount: row.guest_count as number,
    status: row.status as GuestSession["status"],
    opened_at: row.opened_at as string,
  };
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

/**
 * The menu as the guest sees it: only what is on, with per-channel switch-offs
 * applied. An `off_until` in the past counts as back on, which is what lets the
 * "off for 2 hours" button work without anything sweeping the table later.
 */
export async function guestMenu(
  orgId: string,
): Promise<{ categories: GuestCategory[]; items: GuestMenuItem[] }> {
  const [cats, items, variants, offs] = await Promise.all([
    supabaseAdmin
      .from("menu_categories")
      .select("id, name, sort_order")
      .eq("organization_id", orgId)
      .order("sort_order"),
    supabaseAdmin
      .from("menu_items")
      .select(
        "id, category_id, name, description, price, image_url, food_type, course, is_recommended, is_available, sort_order",
      )
      .eq("organization_id", orgId)
      .eq("is_available", true)
      .order("sort_order"),
    supabaseAdmin
      .from("menu_item_variants")
      .select("id, menu_item_id, name, price, is_default, sort_order")
      .eq("organization_id", orgId)
      .order("sort_order"),
    supabaseAdmin
      .from("item_channel_status")
      .select("menu_item_id, is_available, off_until")
      .eq("organization_id", orgId)
      .eq("channel", "qr"),
  ]);

  for (const r of [cats, items, variants, offs]) {
    if (r.error) throw new Error(`guestMenu: ${r.error.message}`);
  }

  const now = Date.now();
  const suppressed = new Set(
    (offs.data ?? [])
      .filter(
        (o) =>
          !o.is_available && (!o.off_until || new Date(o.off_until).getTime() > now),
      )
      .map((o) => o.menu_item_id),
  );

  const byItem = new Map<string, GuestVariant[]>();
  for (const v of variants.data ?? []) {
    const list = byItem.get(v.menu_item_id) ?? [];
    list.push({ id: v.id, name: v.name, price: Number(v.price), is_default: v.is_default });
    byItem.set(v.menu_item_id, list);
  }

  return {
    categories: (cats.data ?? []) as GuestCategory[],
    items: (items.data ?? [])
      .filter((i) => !suppressed.has(i.id))
      .map((i) => ({
        ...i,
        price: Number(i.price),
        variants: byItem.get(i.id) ?? [],
      })) as GuestMenuItem[],
  };
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

export type GuestLine = {
  menu_item_id: string;
  variant_id?: string | null;
  qty: number;
  notes?: string | null;
};

/**
 * Places a guest order.
 *
 * Prices are never taken from the browser. Each line is re-priced from the
 * menu row (or its variant) inside this function, so a tampered payload buys
 * nothing cheaper than the menu says. Anything the guest asks for that is off
 * the menu is dropped rather than silently priced at zero.
 */
export async function placeGuestOrder(
  session: GuestSession,
  lines: GuestLine[],
): Promise<{ orderId: string; display_no: string } | { error: string }> {
  if (lines.length === 0) return { error: "Your cart is empty." };
  if (session.status !== "open") return { error: "This table has already been billed." };

  const ids = [...new Set(lines.map((l) => l.menu_item_id))];
  const [{ data: menuRows, error: menuErr }, { data: varRows }] = await Promise.all([
    supabaseAdmin
      .from("menu_items")
      .select("id, name, price, is_available, course, station")
      .eq("organization_id", session.organizationId)
      .in("id", ids),
    supabaseAdmin
      .from("menu_item_variants")
      .select("id, menu_item_id, name, price")
      .eq("organization_id", session.organizationId)
      .in("menu_item_id", ids),
  ]);
  if (menuErr) throw new Error(`placeGuestOrder: ${menuErr.message}`);

  const menu = new Map((menuRows ?? []).map((m) => [m.id, m]));
  const vars = new Map((varRows ?? []).map((v) => [v.id, v]));

  const priced = lines.flatMap((l) => {
    const item = menu.get(l.menu_item_id);
    if (!item || !item.is_available) return [];
    const qty = Math.max(1, Math.min(Math.floor(l.qty), 99));

    const variant = l.variant_id ? vars.get(l.variant_id) : null;
    // A variant id that doesn't belong to this item is treated as absent, not
    // as a licence to price the dish from someone else's menu row.
    const usable = variant && variant.menu_item_id === l.menu_item_id ? variant : null;

    return [
      {
        menu_item_id: item.id,
        name: item.name,
        variant_name: usable?.name ?? null,
        qty,
        unit_price: Number(usable?.price ?? item.price),
        course: item.course,
        station: item.station,
        notes: (l.notes ?? "").slice(0, 200) || null,
      },
    ];
  });

  if (priced.length === 0) return { error: "Those items are no longer available." };

  const charges = await billCharges(session.organizationId);
  const bill = computeBill(priced, charges);

  const { data: orderNo, error: seqErr } = await supabaseAdmin.rpc("next_org_seq", {
    org: session.organizationId,
    counter_kind: "order",
  });
  if (seqErr) throw new Error(`placeGuestOrder (sequence): ${seqErr.message}`);

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .insert({
      organization_id: session.organizationId,
      order_no: orderNo,
      display_no: `ORD-${String(orderNo).padStart(5, "0")}`,
      channel: "dine_in",
      placed_by: "guest",
      status: "new",
      table_id: session.tableId,
      session_id: session.id,
      guest_count: session.guestCount,
      subtotal: bill.itemTotal,
      gst_pct: charges.sgst_pct + charges.cgst_pct,
      gst_amount: bill.sgst + bill.cgst,
      service_charge: bill.serviceCharge,
      round_off: bill.roundOff,
      total: bill.payable,
    })
    .select("id, display_no")
    .single();
  if (error) throw new Error(`placeGuestOrder: ${error.message}`);

  const { error: itemErr } = await supabaseAdmin.from("order_items").insert(
    priced.map((p) => ({
      order_id: order.id,
      menu_item_id: p.menu_item_id,
      name: p.name,
      variant_name: p.variant_name,
      qty: p.qty,
      unit_price: p.unit_price,
      course: p.course,
      station: p.station,
      notes: p.notes,
    })),
  );
  if (itemErr) throw new Error(`placeGuestOrder (items): ${itemErr.message}`);

  await logOrderEvent(session.organizationId, order.id, {
    kind: "placed",
    message: `Guest placed ${priced.length} item${priced.length === 1 ? "" : "s"} from the table`,
    actor: "guest",
  });

  return { orderId: order.id, display_no: order.display_no };
}

/** Every order this party has placed, newest first, with their line states. */
export async function sessionOrders(sessionId: string): Promise<GuestOrder[]> {
  const { data: orders, error } = await supabaseAdmin
    .from("orders")
    .select("id, display_no, status, created_at")
    .eq("session_id", sessionId)
    .neq("status", "cancelled")
    .order("created_at");
  if (error) throw new Error(`sessionOrders: ${error.message}`);
  if (!orders || orders.length === 0) return [];

  const { data: items, error: itemErr } = await supabaseAdmin
    .from("order_items")
    .select("id, order_id, name, variant_name, qty, unit_price, status, course")
    .in(
      "order_id",
      orders.map((o) => o.id),
    )
    .order("created_at");
  if (itemErr) throw new Error(`sessionOrders (items): ${itemErr.message}`);

  return orders.map((o) => ({
    ...o,
    items: (items ?? [])
      .filter((i) => i.order_id === o.id)
      .map((i) => ({ ...i, unit_price: Number(i.unit_price) })) as GuestOrderItem[],
  }));
}

// ---------------------------------------------------------------------------
// Service + bill
// ---------------------------------------------------------------------------

export async function callWaiter(
  session: GuestSession,
  kind: "water" | "cutlery" | "clean_up" | "bill" | "assistance" | "other",
  note?: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("service_requests").insert({
    organization_id: session.organizationId,
    table_id: session.tableId,
    session_id: session.id,
    kind,
    note: (note ?? "").slice(0, 200) || null,
  });
  if (error) throw new Error(`callWaiter: ${error.message}`);
}

export async function billCharges(orgId: string): Promise<BillCharges> {
  const { data, error } = await supabaseAdmin
    .from("org_bill_settings")
    .select("sgst_pct, cgst_pct, service_charge_pct, round_off_enabled")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) throw new Error(`billCharges: ${error.message}`);
  if (!data) return DEFAULT_CHARGES;
  return {
    sgst_pct: Number(data.sgst_pct),
    cgst_pct: Number(data.cgst_pct),
    service_charge_pct: Number(data.service_charge_pct),
    round_off_enabled: data.round_off_enabled,
  };
}

export async function logOrderEvent(
  orgId: string,
  orderId: string,
  e: { kind: string; message: string; actor?: string; meta?: Record<string, unknown> },
): Promise<void> {
  const { error } = await supabaseAdmin.from("order_events").insert({
    organization_id: orgId,
    order_id: orderId,
    kind: e.kind,
    message: e.message,
    actor: e.actor ?? null,
    meta: e.meta ?? {},
  });
  // A missing audit line must never fail the operation it was describing.
  if (error) console.error("logOrderEvent:", error.message);
}
