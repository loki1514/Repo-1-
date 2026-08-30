"use server";

import { getMyOrg } from "@/lib/org";
import { requireModule } from "@/lib/module-guard";
import { supabaseServer } from "@/lib/supabase-server";
import {
  setKotStatus,
  settleOrder,
  type KotStatus,
  type KotTicket,
  type Order,
  type OrderItem,
  type PaymentMethod,
} from "@/lib/pos";

// Deferred to the control plane rather than a constant, so the workflow
// builder and the permission matrix actually govern this board.
const requireKitchenAccess = () => requireModule("kds_kot", "The KOT board");

export type BoardOrder = Order & { table_label: string | null };
export type BoardItem = OrderItem & { is_available: boolean | null };

export type KotBoardData = {
  tickets: KotTicket[];
  orders: BoardOrder[];
  items: BoardItem[];
  /** Order ids that have at least one unavailable item. */
  ordersWithUnavailableItems: string[];
};

/**
 * Full board snapshot. Used for the realtime refresh path as well as the
 * polling fallback, so it must be role-checked on its own.
 */
export async function getKotBoard(): Promise<KotBoardData> {
  const org = await requireKitchenAccess();
  const supabase = await supabaseServer();

  const { data: ticketRows, error: tErr } = await supabase
    .from("kot_tickets")
    .select("id, order_id, kot_no, station, status, priority, created_at, updated_at")
    .eq("organization_id", org.id)
    .in("status", ["new", "preparing", "ready"])
    .order("created_at");
  if (tErr) throw new Error(`getKotBoard (tickets): ${tErr.message}`);

  const tickets = (ticketRows ?? []) as KotTicket[];
  const orderIds = [...new Set(tickets.map((t) => t.order_id))];
  if (orderIds.length === 0) {
    return { tickets, orders: [], items: [], ordersWithUnavailableItems: [] };
  }

  const { data: orderRows, error: oErr } = await supabase
    .from("orders")
    .select(
      "id, order_no, display_no, channel, status, table_id, customer_name, customer_phone, captain_name, subtotal, gst_pct, gst_amount, total, payment_method, created_at",
    )
    .in("id", orderIds);
  if (oErr) throw new Error(`getKotBoard (orders): ${oErr.message}`);

  const tableIds = [...new Set((orderRows ?? []).map((o) => o.table_id).filter(Boolean))] as string[];
  const tableLabelById = new Map<string, string>();
  if (tableIds.length > 0) {
    const { data: tableRows, error: tbErr } = await supabase
      .from("dining_tables")
      .select("id, label")
      .in("id", tableIds);
    if (tbErr) throw new Error(`getKotBoard (tables): ${tbErr.message}`);
    for (const t of tableRows ?? []) tableLabelById.set(t.id, t.label);
  }

  const orders: BoardOrder[] = ((orderRows ?? []) as Order[]).map((o) => ({
    ...o,
    table_label: o.table_id ? (tableLabelById.get(o.table_id) ?? null) : null,
  }));

  const { data: itemRows, error: iErr } = await supabase
    .from("order_items")
    .select("id, order_id, menu_item_id, name, qty, unit_price, add_ons, notes")
    .in("order_id", orderIds);
  if (iErr) throw new Error(`getKotBoard (items): ${iErr.message}`);

  const menuIds = [...new Set((itemRows ?? []).map((i) => i.menu_item_id).filter(Boolean))] as string[];
  const availableByMenuId = new Map<string, boolean>();
  if (menuIds.length > 0) {
    const { data: menuRows, error: mErr } = await supabase
      .from("menu_items")
      .select("id, is_available")
      .in("id", menuIds);
    if (mErr) throw new Error(`getKotBoard (menu): ${mErr.message}`);
    for (const m of menuRows ?? []) availableByMenuId.set(m.id, m.is_available);
  }

  const items: BoardItem[] = ((itemRows ?? []) as OrderItem[]).map((i) => ({
    ...i,
    is_available: i.menu_item_id ? (availableByMenuId.get(i.menu_item_id) ?? null) : null,
  }));

  const ordersWithUnavailableItems = [
    ...new Set(items.filter((i) => i.is_available === false).map((i) => i.order_id)),
  ];

  return { tickets, orders, items, ordersWithUnavailableItems };
}

export async function setKotStatusAction(kotId: string, status: KotStatus): Promise<void> {
  await requireKitchenAccess();
  await setKotStatus(kotId, status);
}

export async function settleOrderAction(orderId: string, method: PaymentMethod): Promise<void> {
  await requireKitchenAccess();
  await settleOrder(orderId, method);
}
