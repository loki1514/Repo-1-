import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { computeBill, type BillCharges } from "@/lib/bill";
import { billCharges, logOrderEvent } from "@/lib/guest";

/**
 * Staff-side operations: the floor, the kitchen, the bill, the channels.
 *
 * Reads go through service_role but are always filtered by an organization id
 * the caller has already been authorized for (getMyOrg()), matching the
 * pattern in lib/org.ts. The tenancy check lives at the page boundary; this
 * file never guesses which org it is serving.
 */

export type Area = { id: string; name: string; sort_order: number };

export type TableState = {
  id: string;
  label: string;
  seats: number;
  areaId: string | null;
  areaName: string;
  qrToken: string | null;
  /** blank | seated | running | food_ready | printed | paid */
  state: "blank" | "seated" | "running" | "food_ready" | "printed" | "paid";
  sessionId: string | null;
  pin: string | null;
  openedAt: string | null;
  orderId: string | null;
  displayNo: string | null;
  amount: number;
  itemCount: number;
  guestCount: number;
  pendingItems: number;
  readyItems: number;
};

export type KotLine = {
  id: string;
  name: string;
  variant_name: string | null;
  qty: number;
  status: "pending" | "preparing" | "ready" | "delivered" | "cancelled";
  notes: string | null;
  course: string;
};

export type KotCard = {
  id: string;
  kot_no: number;
  station: string;
  status: "new" | "preparing" | "ready" | "delivered";
  priority: "normal" | "urgent";
  created_at: string;
  orderId: string;
  displayNo: string;
  tableLabel: string | null;
  channel: string;
  placedBy: string;
  lines: KotLine[];
};

export type ServiceRequest = {
  id: string;
  kind: string;
  note: string | null;
  status: string;
  created_at: string;
  tableLabel: string | null;
};

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

export async function listAreas(orgId: string): Promise<Area[]> {
  const { data, error } = await supabaseAdmin
    .from("dining_areas")
    .select("id, name, sort_order")
    .eq("organization_id", orgId)
    .order("sort_order");
  if (error) throw new Error(`listAreas: ${error.message}`);
  return (data ?? []) as Area[];
}

/**
 * The floor view in one query set: every table, plus whatever is live on it.
 *
 * Colour on the reference table view is a function of the *order*, not the
 * table, so the state is derived here — once — rather than in the component.
 * Anything reading `state` gets the same answer as the printer and the report.
 */
export async function listFloor(orgId: string): Promise<TableState[]> {
  const [areas, tables, orders, sessions] = await Promise.all([
    listAreas(orgId),
    supabaseAdmin
      .from("dining_tables")
      .select("id, label, seats, area_id, qr_token, sort_order, is_active")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("sort_order"),
    supabaseAdmin
      .from("orders")
      .select("id, display_no, table_id, session_id, status, total, guest_count, created_at")
      .eq("organization_id", orgId)
      .in("status", ["new", "in_billing", "sent_to_kitchen", "ready", "awaiting_payment"]),
    supabaseAdmin
      .from("table_sessions")
      .select("id, table_id, pin, guest_count, opened_at, status")
      .eq("organization_id", orgId)
      .neq("status", "closed"),
  ]);

  for (const r of [tables, orders, sessions]) {
    if (r.error) throw new Error(`listFloor: ${r.error.message}`);
  }

  const openOrders = orders.data ?? [];
  const lineCounts = await countLines(openOrders.map((o) => o.id));

  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const sessionByTable = new Map((sessions.data ?? []).map((s) => [s.table_id, s]));

  return (tables.data ?? []).map((t) => {
    const mine = openOrders.filter((o) => o.table_id === t.id);
    const session = sessionByTable.get(t.id) ?? null;

    const amount = mine.reduce((s, o) => s + Number(o.total), 0);
    const counts = mine.reduce(
      (acc, o) => {
        const c = lineCounts.get(o.id);
        acc.items += c?.total ?? 0;
        acc.pending += c?.pending ?? 0;
        acc.ready += c?.ready ?? 0;
        return acc;
      },
      { items: 0, pending: 0, ready: 0 },
    );

    // Most urgent thing first: food waiting to be run beats a bill waiting to
    // be paid, because one of them gets cold.
    let state: TableState["state"] = "blank";
    if (mine.some((o) => o.status === "awaiting_payment")) state = "printed";
    if (counts.ready > 0) state = "food_ready";
    else if (mine.some((o) => o.status === "sent_to_kitchen" || o.status === "ready")) state = "running";
    else if (mine.length > 0) state = "running";
    else if (session) state = "seated";

    const primary = mine[0] ?? null;

    return {
      id: t.id,
      label: t.label,
      seats: t.seats,
      areaId: t.area_id,
      areaName: t.area_id ? (areaName.get(t.area_id) ?? "Other") : "Other",
      qrToken: t.qr_token,
      state,
      sessionId: session?.id ?? null,
      pin: session?.pin ?? null,
      openedAt: session?.opened_at ?? primary?.created_at ?? null,
      orderId: primary?.id ?? null,
      displayNo: primary?.display_no ?? null,
      amount,
      itemCount: counts.items,
      guestCount: session?.guest_count ?? primary?.guest_count ?? 0,
      pendingItems: counts.pending,
      readyItems: counts.ready,
    };
  });
}

async function countLines(orderIds: string[]) {
  const out = new Map<string, { total: number; pending: number; ready: number }>();
  if (orderIds.length === 0) return out;

  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("order_id, qty, status")
    .in("order_id", orderIds);
  if (error) throw new Error(`countLines: ${error.message}`);

  for (const row of data ?? []) {
    const c = out.get(row.order_id) ?? { total: 0, pending: 0, ready: 0 };
    c.total += row.qty;
    if (row.status === "pending" || row.status === "preparing") c.pending += row.qty;
    if (row.status === "ready") c.ready += row.qty;
    out.set(row.order_id, c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

/** Live KOT cards with their lines — the kitchen display board. */
export async function listKotBoard(orgId: string): Promise<KotCard[]> {
  const { data: kots, error } = await supabaseAdmin
    .from("kot_tickets")
    .select("id, kot_no, station, status, priority, created_at, order_id")
    .eq("organization_id", orgId)
    .in("status", ["new", "preparing", "ready"])
    .order("created_at");
  if (error) throw new Error(`listKotBoard: ${error.message}`);
  if (!kots || kots.length === 0) return [];

  const orderIds = [...new Set(kots.map((k) => k.order_id))];
  const [{ data: orders }, { data: lines }, { data: tables }] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("id, display_no, table_id, channel, placed_by")
      .in("id", orderIds),
    supabaseAdmin
      .from("order_items")
      .select("id, kot_ticket_id, name, variant_name, qty, status, notes, course")
      .in("kot_ticket_id", kots.map((k) => k.id))
      .order("created_at"),
    supabaseAdmin.from("dining_tables").select("id, label").eq("organization_id", orgId),
  ]);

  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const tableLabel = new Map((tables ?? []).map((t) => [t.id, t.label]));

  return kots.map((k) => {
    const o = orderById.get(k.order_id);
    return {
      id: k.id,
      kot_no: k.kot_no,
      station: k.station,
      status: k.status,
      priority: k.priority,
      created_at: k.created_at,
      orderId: k.order_id,
      displayNo: o?.display_no ?? "—",
      tableLabel: o?.table_id ? (tableLabel.get(o.table_id) ?? null) : null,
      channel: o?.channel ?? "dine_in",
      placedBy: o?.placed_by ?? "pos",
      lines: ((lines ?? []).filter((l) => l.kot_ticket_id === k.id) ?? []) as KotLine[],
    };
  }) as KotCard[];
}

/**
 * Fires everything not yet on a ticket to the kitchen.
 *
 * Only unfired lines are picked up, which is what makes a second round work:
 * the guest adds two more dishes to a running bill and the kitchen gets a
 * second KOT with only those two, not a reprint of the whole table.
 */
export async function fireKot(
  orgId: string,
  orderId: string,
  actor = "pos",
): Promise<{ kotNo: number; lines: number } | { error: string }> {
  // The order id arrives from a screen, so ownership is established before
  // anything is read or written — otherwise a forged id would fire a ticket
  // onto another restaurant's pass and move that order's status. Same reason
  // setLineStatus checks through the parent order.
  const { data: owned, error: ownErr } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (ownErr) throw new Error(`fireKot: ${ownErr.message}`);
  if (!owned) return { error: "That bill does not belong to this restaurant." };

  const { data: unfired, error } = await supabaseAdmin
    .from("order_items")
    .select("id, station, name, qty")
    .eq("order_id", orderId)
    .is("kot_ticket_id", null)
    .neq("status", "cancelled");
  if (error) throw new Error(`fireKot: ${error.message}`);
  if (!unfired || unfired.length === 0) return { error: "Everything on this bill is already with the kitchen." };

  const { data: kotNo, error: seqErr } = await supabaseAdmin.rpc("next_org_seq", {
    org: orgId,
    counter_kind: "kot",
  });
  if (seqErr) throw new Error(`fireKot (sequence): ${seqErr.message}`);

  const station = unfired[0].station ?? "main";
  const { data: kot, error: kotErr } = await supabaseAdmin
    .from("kot_tickets")
    .insert({ organization_id: orgId, order_id: orderId, kot_no: kotNo, station })
    .select("id, kot_no")
    .single();
  if (kotErr) throw new Error(`fireKot (ticket): ${kotErr.message}`);

  const { error: linkErr } = await supabaseAdmin
    .from("order_items")
    .update({ kot_ticket_id: kot.id, status: "preparing" })
    .in("id", unfired.map((u) => u.id));
  if (linkErr) throw new Error(`fireKot (link): ${linkErr.message}`);

  await supabaseAdmin.from("orders").update({ status: "sent_to_kitchen" }).eq("id", orderId);
  await logOrderEvent(orgId, orderId, {
    kind: "kot_fired",
    message: `KOT #${kot.kot_no} fired to ${station} — ${unfired.length} item${unfired.length === 1 ? "" : "s"}`,
    actor,
    meta: { kot_no: kot.kot_no, station },
  });

  return { kotNo: kot.kot_no, lines: unfired.length };
}

/** Bumps a whole ticket. The order follows its lines, never the other way round. */
export async function setKotStatus(
  orgId: string,
  kotId: string,
  status: "preparing" | "ready" | "delivered",
  actor = "kitchen",
): Promise<void> {
  const { data: kot, error } = await supabaseAdmin
    .from("kot_tickets")
    .update({ status })
    .eq("id", kotId)
    .eq("organization_id", orgId)
    .select("kot_no, order_id")
    .single();
  if (error) throw new Error(`setKotStatus: ${error.message}`);

  const lineStatus = status === "delivered" ? "delivered" : status;
  await supabaseAdmin
    .from("order_items")
    .update({ status: lineStatus })
    .eq("kot_ticket_id", kotId);

  await reconcileOrderStatus(orgId, kot.order_id);
  await logOrderEvent(orgId, kot.order_id, {
    kind: `kot_${status}`,
    message: `KOT #${kot.kot_no} marked ${status}`,
    actor,
  });
}

export async function setLineStatus(
  orgId: string,
  itemId: string,
  status: "preparing" | "ready" | "delivered",
  actor = "kitchen",
): Promise<void> {
  // order_items carries no organization_id of its own, so the tenant check has
  // to go through the parent order. The item uuid arrives from the KDS tablet,
  // which is the least supervised device in the building; without this an id
  // lifted from another restaurant would be writable.
  const { data: line, error: lookupError } = await supabaseAdmin
    .from("order_items")
    .select("order_id, name, orders!inner(organization_id)")
    .eq("id", itemId)
    .eq("orders.organization_id", orgId)
    .maybeSingle();
  if (lookupError) throw new Error(`setLineStatus: ${lookupError.message}`);
  if (!line) throw new Error("setLineStatus: that dish is not on this organization's pass.");

  const { error } = await supabaseAdmin
    .from("order_items")
    .update({ status })
    .eq("id", itemId);
  if (error) throw new Error(`setLineStatus: ${error.message}`);

  await reconcileOrderStatus(orgId, line.order_id);
  await logOrderEvent(orgId, line.order_id, {
    kind: `item_${status}`,
    message: `${line.name} → ${status}`,
    actor,
  });
}

/**
 * The order's status is a summary of its lines, so it is recomputed rather
 * than set. Two screens flipping different lines at the same time therefore
 * cannot disagree about whether the table is ready.
 */
async function reconcileOrderStatus(orgId: string, orderId: string): Promise<void> {
  const { data: lines } = await supabaseAdmin
    .from("order_items")
    .select("status")
    .eq("order_id", orderId)
    .neq("status", "cancelled");
  if (!lines || lines.length === 0) return;

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();
  // Money has already changed hands — nothing in the kitchen reopens that.
  if (!order || order.status === "paid" || order.status === "cancelled") return;

  const all = (s: string) => lines.every((l) => l.status === s);
  const any = (s: string) => lines.some((l) => l.status === s);

  let next = order.status;
  if (all("delivered")) next = "awaiting_payment";
  else if (any("ready") && !any("pending")) next = "ready";
  else if (any("preparing") || any("ready")) next = "sent_to_kitchen";

  if (next !== order.status) {
    await supabaseAdmin.from("orders").update({ status: next }).eq("id", orderId);
  }
}

// ---------------------------------------------------------------------------
// Service requests
// ---------------------------------------------------------------------------

export async function listServiceRequests(orgId: string): Promise<ServiceRequest[]> {
  const [{ data, error }, { data: tables }] = await Promise.all([
    supabaseAdmin
      .from("service_requests")
      .select("id, kind, note, status, created_at, table_id")
      .eq("organization_id", orgId)
      .neq("status", "done")
      .order("created_at", { ascending: false })
      .limit(30),
    supabaseAdmin.from("dining_tables").select("id, label").eq("organization_id", orgId),
  ]);
  if (error) throw new Error(`listServiceRequests: ${error.message}`);

  const label = new Map((tables ?? []).map((t) => [t.id, t.label]));
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    note: r.note,
    status: r.status,
    created_at: r.created_at,
    tableLabel: r.table_id ? (label.get(r.table_id) ?? null) : null,
  }));
}

export async function resolveServiceRequest(orgId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("service_requests")
    .update({ status: "done", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) throw new Error(`resolveServiceRequest: ${error.message}`);
}

// ---------------------------------------------------------------------------
// The bill
// ---------------------------------------------------------------------------

export type BillView = {
  order: {
    id: string;
    display_no: string;
    status: string;
    channel: string;
    created_at: string;
    guest_count: number;
    discount: number;
    tableLabel: string | null;
    customer_name: string | null;
    customer_phone: string | null;
  };
  lines: { id: string; name: string; variant_name: string | null; qty: number; unit_price: number }[];
  charges: BillCharges;
  bill: ReturnType<typeof computeBill>;
  paid: number;
  outlet: {
    legal_name: string | null;
    address: string | null;
    gstin: string | null;
    fssai: string | null;
    phone: string | null;
    footer_note: string | null;
  };
};

export async function getBill(orgId: string, orderId: string): Promise<BillView | null> {
  const [{ data: order }, { data: lines }, charges, { data: settings }, { data: paidRows }] =
    await Promise.all([
      supabaseAdmin
        .from("orders")
        .select(
          "id, display_no, status, channel, created_at, guest_count, discount, table_id, customer_name, customer_phone",
        )
        .eq("id", orderId)
        .eq("organization_id", orgId)
        .maybeSingle(),
      supabaseAdmin
        .from("order_items")
        .select("id, name, variant_name, qty, unit_price, status")
        .eq("order_id", orderId)
        .order("created_at"),
      billCharges(orgId),
      supabaseAdmin
        .from("org_bill_settings")
        .select("legal_name, address, gstin, fssai, phone, footer_note")
        .eq("organization_id", orgId)
        .maybeSingle(),
      supabaseAdmin.from("payments").select("amount").eq("order_id", orderId),
    ]);

  if (!order) return null;

  let tableLabel: string | null = null;
  if (order.table_id) {
    const { data: t } = await supabaseAdmin
      .from("dining_tables")
      .select("label")
      .eq("id", order.table_id)
      .maybeSingle();
    tableLabel = t?.label ?? null;
  }

  const billable = (lines ?? [])
    .filter((l) => l.status !== "cancelled")
    .map((l) => ({ ...l, unit_price: Number(l.unit_price) }));

  return {
    order: {
      id: order.id,
      display_no: order.display_no,
      status: order.status,
      channel: order.channel,
      created_at: order.created_at,
      guest_count: order.guest_count,
      discount: Number(order.discount),
      tableLabel,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
    },
    lines: billable,
    charges,
    bill: computeBill(billable, charges, Number(order.discount)),
    paid: (paidRows ?? []).reduce((s, p) => s + Number(p.amount), 0),
    outlet: settings ?? {
      legal_name: null,
      address: null,
      gstin: null,
      fssai: null,
      phone: null,
      footer_note: null,
    },
  };
}

/**
 * Takes money and closes the table.
 *
 * The amount is recomputed here from the stored lines — the caller says how
 * the guest paid, never how much. Settling also closes the table session, so
 * the next guest scanning the same QR starts a clean bill.
 */
export async function settleBill(
  orgId: string,
  orderId: string,
  tenders: { method: string; amount: number; reference?: string }[],
  actor = "pos",
): Promise<{ ok: true; total: number } | { error: string }> {
  const view = await getBill(orgId, orderId);
  if (!view) return { error: "That bill no longer exists." };
  if (view.order.status === "paid") return { error: "This bill is already settled." };

  const total = view.bill.payable;
  const offered = tenders.reduce((s, t) => s + Number(t.amount), 0);
  if (offered + 0.5 < total) {
    return { error: `Short by ₹${(total - offered).toFixed(2)}.` };
  }

  const { error: payErr } = await supabaseAdmin.from("payments").insert(
    tenders
      .filter((t) => Number(t.amount) > 0)
      .map((t) => ({
        organization_id: orgId,
        order_id: orderId,
        method: t.method,
        // Overtender is change given, not revenue collected.
        amount: Math.min(Number(t.amount), total),
        reference: t.reference ?? null,
      })),
  );
  if (payErr) throw new Error(`settleBill: ${payErr.message}`);

  await supabaseAdmin
    .from("orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      payment_method: tenders.length > 1 ? "split" : (tenders[0]?.method ?? "cash"),
      subtotal: view.bill.itemTotal,
      gst_amount: view.bill.sgst + view.bill.cgst,
      service_charge: view.bill.serviceCharge,
      round_off: view.bill.roundOff,
      total,
    })
    .eq("id", orderId);

  await supabaseAdmin
    .from("order_items")
    .update({ status: "delivered" })
    .eq("order_id", orderId)
    .neq("status", "cancelled");

  const { data: o } = await supabaseAdmin
    .from("orders")
    .select("session_id")
    .eq("id", orderId)
    .single();
  if (o?.session_id) {
    const { data: siblings } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("session_id", o.session_id)
      .not("status", "in", "(paid,cancelled)");
    // Only the last unpaid order on a session frees the table.
    if (!siblings || siblings.length === 0) {
      await supabaseAdmin
        .from("table_sessions")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", o.session_id);
    }
  }

  await logOrderEvent(orgId, orderId, {
    kind: "paid",
    message: `Settled ₹${total.toFixed(2)} by ${tenders.map((t) => t.method).join(" + ")}`,
    actor,
    meta: { total, tenders },
  });

  return { ok: true, total };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export type Channel = {
  id: string;
  channel: string;
  display_name: string;
  is_connected: boolean;
  is_accepting: boolean;
  next_open_at: string | null;
  auto_accept: boolean;
  commission_pct: number;
};

export async function listChannels(orgId: string): Promise<Channel[]> {
  const { data, error } = await supabaseAdmin
    .from("channel_integrations")
    .select("id, channel, display_name, is_connected, is_accepting, next_open_at, auto_accept, commission_pct")
    .eq("organization_id", orgId)
    .order("channel");
  if (error) throw new Error(`listChannels: ${error.message}`);
  return (data ?? []).map((c) => ({ ...c, commission_pct: Number(c.commission_pct) }));
}

export async function setChannelAccepting(
  orgId: string,
  channel: string,
  accepting: boolean,
  reopenAt: string | null = null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("channel_integrations")
    .update({ is_accepting: accepting, next_open_at: accepting ? null : reopenAt })
    .eq("organization_id", orgId)
    .eq("channel", channel);
  if (error) throw new Error(`setChannelAccepting: ${error.message}`);
}

/** Item on/off for one channel. `hours` null = indefinitely. */
export async function setItemChannelAvailability(
  orgId: string,
  menuItemId: string,
  channel: string,
  available: boolean,
  hours: number | null = null,
): Promise<void> {
  const offUntil =
    !available && hours != null ? new Date(Date.now() + hours * 3600_000).toISOString() : null;

  const { error } = await supabaseAdmin.from("item_channel_status").upsert(
    {
      organization_id: orgId,
      menu_item_id: menuItemId,
      channel,
      is_available: available,
      off_until: offUntil,
    },
    { onConflict: "menu_item_id,channel" },
  );
  if (error) throw new Error(`setItemChannelAvailability: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Live operations — the ball-by-ball view
// ---------------------------------------------------------------------------

export type LiveSnapshot = {
  salesToday: number;
  ordersToday: number;
  covers: number;
  averageBill: number;
  preparing: number;
  ready: number;
  delivered: number;
  awaitingPayment: number;
  tablesOccupied: number;
  tablesTotal: number;
  byChannel: { channel: string; orders: number; sales: number }[];
  timeline: {
    id: string;
    kind: string;
    message: string;
    actor: string | null;
    created_at: string;
    displayNo: string | null;
  }[];
};

/**
 * One call, everything the manager's board shows. Deliberately a snapshot
 * rather than a subscription: it is re-fetched on an interval by the client so
 * a stalled websocket can never leave the board silently frozen on stale
 * numbers — the worst failure mode for a screen people trust at a glance.
 */
export async function liveSnapshot(orgId: string): Promise<LiveSnapshot> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const since = dayStart.toISOString();

  const [{ data: today }, { data: openLines }, { data: events }, { data: tables }, { data: sessions }] =
    await Promise.all([
      supabaseAdmin
        .from("orders")
        .select("id, display_no, channel, status, total, guest_count")
        .eq("organization_id", orgId)
        .gte("created_at", since)
        .neq("status", "cancelled"),
      supabaseAdmin
        .from("order_items")
        .select("status, orders!inner(organization_id, status)")
        .eq("orders.organization_id", orgId)
        .not("orders.status", "in", "(paid,cancelled)"),
      supabaseAdmin
        .from("order_events")
        .select("id, kind, message, actor, created_at, order_id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(40),
      supabaseAdmin
        .from("dining_tables")
        .select("id")
        .eq("organization_id", orgId)
        .eq("is_active", true),
      supabaseAdmin
        .from("table_sessions")
        .select("id")
        .eq("organization_id", orgId)
        .neq("status", "closed"),
    ]);

  const orders = today ?? [];
  const paid = orders.filter((o) => o.status === "paid");
  const salesToday = paid.reduce((s, o) => s + Number(o.total), 0);

  const byChannel = new Map<string, { orders: number; sales: number }>();
  for (const o of orders) {
    const c = byChannel.get(o.channel) ?? { orders: 0, sales: 0 };
    c.orders += 1;
    if (o.status === "paid") c.sales += Number(o.total);
    byChannel.set(o.channel, c);
  }

  const lineStates = (openLines ?? []).reduce(
    (acc, l) => {
      if (l.status === "preparing" || l.status === "pending") acc.preparing += 1;
      if (l.status === "ready") acc.ready += 1;
      if (l.status === "delivered") acc.delivered += 1;
      return acc;
    },
    { preparing: 0, ready: 0, delivered: 0 },
  );

  const orderNo = new Map(orders.map((o) => [o.id, o.display_no]));

  return {
    salesToday,
    ordersToday: orders.length,
    covers: orders.reduce((s, o) => s + (o.guest_count ?? 0), 0),
    averageBill: paid.length > 0 ? salesToday / paid.length : 0,
    ...lineStates,
    awaitingPayment: orders.filter((o) => o.status === "awaiting_payment").length,
    tablesOccupied: (sessions ?? []).length,
    tablesTotal: (tables ?? []).length,
    byChannel: [...byChannel.entries()]
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.orders - a.orders),
    timeline: (events ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      message: e.message,
      actor: e.actor,
      created_at: e.created_at,
      displayNo: orderNo.get(e.order_id) ?? null,
    })),
  };
}
