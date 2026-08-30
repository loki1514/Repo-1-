/**
 * Seeds three fully-operational demo restaurants.
 *
 *   node scripts/seed-restaurants.mjs           # create / refresh
 *   node scripts/seed-restaurants.mjs --remove  # delete everything it made
 *
 * "Fully operational" is the point. Anyone signing in should land on a
 * restaurant mid-service — tables occupied, food on the pass, a bill waiting
 * to be settled, a guest asking for water — because an empty POS demonstrates
 * nothing. Every screen in the product has something real to render the second
 * this finishes.
 *
 * Idempotent: re-running refreshes in place rather than duplicating, and every
 * row is tagged settings.demo_seed = 'restaurant' so --remove can find exactly
 * what it created and nothing else.
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_), SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { RESTAURANTS, STAFF, PASSWORD } from "./restaurants.data.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MARKER = "restaurant";
const remove = process.argv.includes("--remove");

const die = (label, error) => {
  if (error) {
    console.error(`\n✗ ${label}: ${error.message}`);
    process.exit(1);
  }
};

const token = () => randomBytes(8).toString("hex").slice(0, 10);
const pin = () => String(1000 + Math.floor(Math.random() * 9000));
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

async function teardown() {
  const { data: orgs } = await db
    .from("organizations")
    .select("id, name")
    .eq("settings->>demo_seed", MARKER);

  if (!orgs?.length) {
    console.log("Nothing seeded by this script — nothing to remove.");
    return;
  }

  for (const org of orgs) {
    // Auth users are not reachable by cascade, so they go first and by hand.
    const { data: members } = await db
      .from("org_users")
      .select("user_id, email")
      .eq("organization_id", org.id);

    for (const m of members ?? []) {
      if (!m.email?.endsWith(".example")) continue; // never touch a real account
      await db.auth.admin.deleteUser(m.user_id).catch(() => {});
    }
    // Everything else hangs off organizations by ON DELETE CASCADE.
    await db.from("organizations").delete().eq("id", org.id);
    console.log(`removed  ${org.name}`);
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function upsertOrg(r) {
  const { data: existing } = await db
    .from("organizations")
    .select("id")
    .eq("slug", r.slug)
    .maybeSingle();

  // Appearance lives in organizations.theme (migration 0009), not in
  // settings — writing it into settings looked right and rendered nothing.
  const settings = { demo_seed: MARKER, tagline: r.tagline };

  if (existing) {
    const { error } = await db
      .from("organizations")
      .update({ name: r.name, type: r.type, status: "active", settings, theme: r.theme })
      .eq("id", existing.id);
    die("update org", error);
    return existing.id;
  }

  const { data, error } = await db
    .from("organizations")
    .insert({ slug: r.slug, name: r.name, type: r.type, status: "active", settings, theme: r.theme })
    .select("id")
    .single();
  die("create org", error);
  return data.id;
}

async function seedStaff(orgId, r, roleIdBySlug) {
  const domain = `${r.slug.replace(/-/g, "")}.example`;
  const logins = [];

  for (const [handle, roleSlug, title] of STAFF) {
    const email = `${handle}@${domain}`;
    let userId;

    const { data: created, error } = await db.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `${r.name} ${title}` },
    });

    if (error) {
      // Already there from a previous run — reset the password so the printed
      // credentials are always true, and reuse the account.
      const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
      const found = list?.users?.find((u) => u.email === email);
      if (!found) die(`create user ${email}`, error);
      userId = found.id;
      await db.auth.admin.updateUserById(userId, { password: PASSWORD });
    } else {
      userId = created.user.id;
    }

    const { error: linkErr } = await db.from("org_users").upsert(
      {
        organization_id: orgId,
        user_id: userId,
        role_id: roleIdBySlug.get(roleSlug),
        email,
        full_name: `${r.name} ${title}`,
        status: "active",
      },
      { onConflict: "organization_id,user_id" },
    );
    die(`link ${email}`, linkErr);

    logins.push({ email, role: roleSlug, title });
  }
  return logins;
}

async function seedFloor(orgId, r) {
  // QR tokens are printed on physical stickers, so re-seeding must never
  // reissue one for a table that already exists — that would silently kill
  // every sticker on the floor. Areas and tables are upserted by name/label
  // and existing tokens are carried forward.
  const { data: priorTables } = await db
    .from("dining_tables")
    .select("id, label, qr_token")
    .eq("organization_id", orgId);
  const priorToken = new Map((priorTables ?? []).map((t) => [t.label, t.qr_token]));

  const areas = [];
  for (const [i, a] of r.areas.entries()) {
    const { data, error } = await db
      .from("dining_areas")
      .upsert(
        { organization_id: orgId, name: a.name, sort_order: i },
        { onConflict: "organization_id,name" },
      )
      .select("id")
      .single();
    die("area", error);
    areas.push({ id: data.id, ...a });
  }

  const rows = [];
  let n = 0;
  for (const a of areas) {
    for (const label of a.tables) {
      rows.push({
        organization_id: orgId,
        area_id: a.id,
        label,
        seats: label.toLowerCase().startsWith("room") ? 10 : 4,
        qr_token: priorToken.get(label) ?? token(),
        sort_order: n++,
      });
    }
  }
  const { data: tables, error } = await db
    .from("dining_tables")
    .upsert(rows, { onConflict: "organization_id,label" })
    .select("id, label, area_id");
  die("tables", error);

  // Tables the blueprint no longer lists (a floor plan that shrank) go, but
  // only the ones with nothing live on them.
  const keep = new Set(rows.map((t) => t.label));
  const stale = (priorTables ?? []).filter((t) => !keep.has(t.label)).map((t) => t.id);
  if (stale.length > 0) await db.from("dining_tables").delete().in("id", stale);

  const { error: stErr } = await db.from("kitchen_stations").upsert(
    r.stations.map(([k, name, colour], i) => ({
      organization_id: orgId,
      key: k,
      name,
      colour,
      sort_order: i,
    })),
    { onConflict: "organization_id,key" },
  );
  die("stations", stErr);

  return tables;
}

async function seedMenu(orgId, r) {
  await db.from("menu_categories").delete().eq("organization_id", orgId);
  await db.from("menu_items").delete().eq("organization_id", orgId);

  const items = [];
  let sort = 0;

  for (const [ci, block] of r.menu.entries()) {
    const { data: cat, error } = await db
      .from("menu_categories")
      .insert({ organization_id: orgId, name: block.category, sort_order: ci })
      .select("id")
      .single();
    die("category", error);

    for (const it of block.items) {
      const { data: row, error: itErr } = await db
        .from("menu_items")
        .insert({
          organization_id: orgId,
          category_id: cat.id,
          name: it.name,
          description: it.desc ?? null,
          price: it.price,
          food_type: it.foodType ?? "veg",
          course: it.course,
          is_recommended: Boolean(it.recommended),
          prep_minutes: it.prep ?? 10,
          station: it.station ?? "main",
          sort_order: sort++,
        })
        .select("id, name, price, station, course")
        .single();
      die(`item ${it.name}`, itErr);

      if (it.variants?.length) {
        const { error: vErr } = await db.from("menu_item_variants").insert(
          it.variants.map(([name, price], i) => ({
            organization_id: orgId,
            menu_item_id: row.id,
            name,
            price,
            is_default: i === 0,
            sort_order: i,
          })),
        );
        die(`variants ${it.name}`, vErr);
      }
      items.push({ ...row, variants: it.variants ?? [] });
    }
  }
  return items;
}

async function seedConfig(orgId, r) {
  const { error: billErr } = await db
    .from("org_bill_settings")
    .upsert({ organization_id: orgId, ...r.bill }, { onConflict: "organization_id" });
  die("bill settings", billErr);

  const { error: chErr } = await db.from("channel_integrations").upsert(
    r.channels.map(([channel, display_name, is_connected, commission_pct]) => ({
      organization_id: orgId,
      channel,
      display_name,
      is_connected,
      is_accepting: is_connected,
      commission_pct,
    })),
    { onConflict: "organization_id,channel" },
  );
  die("channels", chErr);

  // Module toggles: everything on unless the blueprint switches something off.
  const { data: modules } = await db.from("modules").select("key, is_core");
  const { error: modErr } = await db.from("org_modules").upsert(
    (modules ?? []).map((m) => ({
      organization_id: orgId,
      module_key: m.key,
      enabled: m.is_core ? true : (r.modules?.[m.key] ?? true),
    })),
    { onConflict: "organization_id,module_key" },
  );
  die("org modules", modErr);
}

/**
 * A restaurant mid-service.
 *
 * Six tables at six different points of the same journey, so every screen has
 * a real example of each state without anyone having to click through a demo
 * script first.
 */
async function seedService(orgId, tables, items, r) {
  const dineIn = tables.filter((t) => !/parcel|takeaway/i.test(t.label));
  const pick = (n) => items[Math.floor(Math.random() * items.length)] ?? items[0];
  const priceOf = (it) => Number(it.variants?.[0]?.[1] ?? it.price);

  const scenarios = [
    { table: dineIn[0], minsAgo: 41, stage: "just_placed", lines: 3 },
    { table: dineIn[1], minsAgo: 34, stage: "in_kitchen", lines: 4 },
    { table: dineIn[2], minsAgo: 22, stage: "food_ready", lines: 2 },
    { table: dineIn[3], minsAgo: 68, stage: "eating", lines: 5 },
    { table: dineIn[4], minsAgo: 82, stage: "awaiting_payment", lines: 3 },
    { table: null, minsAgo: 12, stage: "aggregator", lines: 2, channel: r.channels.some(c => c[0] === "swiggy") ? "swiggy" : "zomato" },
  ].filter((s) => s.stage === "aggregator" || s.table);

  for (const s of scenarios) {
    let sessionId = null;
    let pinCode = null;

    if (s.table) {
      pinCode = pin();
      const { data: session, error } = await db
        .from("table_sessions")
        .insert({
          organization_id: orgId,
          table_id: s.table.id,
          pin: pinCode,
          guest_count: 2 + Math.floor(Math.random() * 4),
          opened_at: minutesAgo(s.minsAgo),
        })
        .select("id, guest_count")
        .single();
      die("session", error);
      sessionId = session.id;
    }

    const chosen = Array.from({ length: s.lines }, () => pick()).filter(Boolean);
    const lines = chosen.map((it) => ({
      menu_item_id: it.id,
      name: it.name,
      qty: 1 + Math.floor(Math.random() * 2),
      unit_price: priceOf(it),
      course: it.course,
      station: it.station,
    }));

    const subtotal = lines.reduce((t, l) => t + l.qty * l.unit_price, 0);
    const svc = (subtotal * (r.bill.service_charge_pct ?? 0)) / 100;
    const taxable = subtotal + svc;
    const gst = Math.round(taxable * (r.bill.sgst_pct + r.bill.cgst_pct)) / 100;
    const gross = taxable + gst;
    const roundOff = Math.round(gross) - gross;

    const { data: orderNo } = await db.rpc("next_org_seq", { org: orgId, counter_kind: "order" });

    const status =
      s.stage === "just_placed" ? "new"
      : s.stage === "in_kitchen" ? "sent_to_kitchen"
      : s.stage === "food_ready" ? "ready"
      : s.stage === "eating" ? "sent_to_kitchen"
      : s.stage === "awaiting_payment" ? "awaiting_payment"
      : "sent_to_kitchen";

    const { data: order, error: oErr } = await db
      .from("orders")
      .insert({
        organization_id: orgId,
        order_no: orderNo,
        display_no: `ORD-${String(orderNo).padStart(5, "0")}`,
        channel: s.channel ?? "dine_in",
        placed_by: s.channel ? "integration" : s.stage === "just_placed" ? "guest" : "captain",
        status,
        table_id: s.table?.id ?? null,
        session_id: sessionId,
        guest_count: s.table ? 2 + Math.floor(Math.random() * 3) : 1,
        captain_name: s.channel ? null : `${r.name} Captain`,
        customer_name: s.channel ? "Aggregator Guest" : null,
        external_ref: s.channel ? `${s.channel.toUpperCase()}-${100000 + Math.floor(Math.random() * 899999)}` : null,
        subtotal,
        gst_pct: r.bill.sgst_pct + r.bill.cgst_pct,
        gst_amount: gst,
        service_charge: svc,
        round_off: roundOff,
        total: Math.round(gross + roundOff),
        created_at: minutesAgo(s.minsAgo),
      })
      .select("id, display_no")
      .single();
    die("order", oErr);

    const lineStatus =
      s.stage === "just_placed" ? "pending"
      : s.stage === "food_ready" ? "ready"
      : s.stage === "eating" || s.stage === "awaiting_payment" ? "delivered"
      : "preparing";

    // Everything past "just placed" has been to the kitchen, so it needs a real
    // ticket — otherwise the KDS would be empty while the floor looks busy.
    let kotId = null;
    if (s.stage !== "just_placed") {
      const { data: kotNo } = await db.rpc("next_org_seq", { org: orgId, counter_kind: "kot" });
      const { data: kot, error: kErr } = await db
        .from("kot_tickets")
        .insert({
          organization_id: orgId,
          order_id: order.id,
          kot_no: kotNo,
          station: lines[0]?.station ?? "main",
          status: s.stage === "food_ready" ? "ready" : s.stage === "in_kitchen" ? "preparing" : "delivered",
          priority: s.minsAgo > 60 ? "urgent" : "normal",
          created_at: minutesAgo(s.minsAgo - 2),
        })
        .select("id")
        .single();
      die("kot", kErr);
      kotId = kot.id;
    }

    const { error: liErr } = await db.from("order_items").insert(
      lines.map((l) => ({
        order_id: order.id,
        menu_item_id: l.menu_item_id,
        name: l.name,
        qty: l.qty,
        unit_price: l.unit_price,
        course: l.course,
        station: l.station,
        status: lineStatus,
        kot_ticket_id: kotId,
      })),
    );
    die("order items", liErr);

    const events = [
      { kind: "placed", message: `Order ${order.display_no} placed — ${lines.length} items`, actor: s.channel ?? "captain", at: s.minsAgo },
    ];
    if (kotId) events.push({ kind: "kot_fired", message: `KOT fired to ${lines[0]?.station ?? "main"}`, actor: "pos", at: s.minsAgo - 2 });
    if (s.stage === "food_ready") events.push({ kind: "kot_ready", message: "All items ready on the pass", actor: "kitchen", at: s.minsAgo - 14 });
    if (s.stage === "eating" || s.stage === "awaiting_payment")
      events.push({ kind: "kot_delivered", message: "Items delivered to table", actor: "captain", at: s.minsAgo - 20 });
    if (s.stage === "awaiting_payment")
      events.push({ kind: "bill_requested", message: "Guest asked for the bill", actor: "guest", at: s.minsAgo - 60 });

    await db.from("order_events").insert(
      events.map((e) => ({
        organization_id: orgId,
        order_id: order.id,
        kind: e.kind,
        message: e.message,
        actor: e.actor,
        created_at: minutesAgo(Math.max(1, e.at)),
      })),
    );
  }

  // A couple of settled bills so "today's sales" is not zero.
  for (let i = 0; i < 4; i++) {
    const chosen = Array.from({ length: 2 + (i % 3) }, () => pick()).filter(Boolean);
    const lines = chosen.map((it) => ({ name: it.name, qty: 1, unit_price: priceOf(it), menu_item_id: it.id, station: it.station, course: it.course }));
    const subtotal = lines.reduce((t, l) => t + l.qty * l.unit_price, 0);
    const svc = (subtotal * (r.bill.service_charge_pct ?? 0)) / 100;
    const gst = Math.round((subtotal + svc) * (r.bill.sgst_pct + r.bill.cgst_pct)) / 100;
    const total = Math.round(subtotal + svc + gst);
    const { data: orderNo } = await db.rpc("next_org_seq", { org: orgId, counter_kind: "order" });
    const method = ["upi", "card", "cash", "upi"][i];

    const { data: order } = await db
      .from("orders")
      .insert({
        organization_id: orgId,
        order_no: orderNo,
        display_no: `ORD-${String(orderNo).padStart(5, "0")}`,
        channel: i % 2 === 0 ? "dine_in" : (r.channels[0]?.[0] ?? "dine_in"),
        placed_by: i % 2 === 0 ? "pos" : "integration",
        status: "paid",
        guest_count: 2,
        subtotal,
        gst_pct: r.bill.sgst_pct + r.bill.cgst_pct,
        gst_amount: gst,
        service_charge: svc,
        total,
        payment_method: method,
        paid_at: minutesAgo(120 + i * 45),
        created_at: minutesAgo(150 + i * 45),
      })
      .select("id, display_no")
      .single();

    if (!order) continue;
    await db.from("order_items").insert(
      lines.map((l) => ({ order_id: order.id, ...l, status: "delivered" })),
    );
    await db.from("payments").insert({
      organization_id: orgId,
      order_id: order.id,
      method,
      amount: total,
      created_at: minutesAgo(120 + i * 45),
    });
    await db.from("order_events").insert({
      organization_id: orgId,
      order_id: order.id,
      kind: "paid",
      message: `Settled ₹${total.toFixed(2)} by ${method}`,
      actor: "pos",
      created_at: minutesAgo(120 + i * 45),
    });
  }

  // One guest waiting on a jug of water, so the floor screen has a live ask.
  if (dineIn[3]) {
    await db.from("service_requests").insert({
      organization_id: orgId,
      table_id: dineIn[3].id,
      kind: "water",
      created_at: minutesAgo(3),
    });
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (remove) return teardown();

  const { data: roles, error: roleErr } = await db.from("roles").select("id, slug");
  die("roles", roleErr);
  const roleIdBySlug = new Map(roles.map((r) => [r.slug, r.id]));

  const report = [];

  for (const r of RESTAURANTS) {
    process.stdout.write(`\n▸ ${r.name}\n`);
    const orgId = await upsertOrg(r);

    // Wipe only this org's operational rows so re-running is a refresh, not a
    // duplication. Configuration (users, modules) is upserted instead.
    for (const t of ["order_events", "payments", "service_requests", "kot_tickets", "orders", "table_sessions"]) {
      await db.from(t).delete().eq("organization_id", orgId);
    }
    await db.from("org_counters").delete().eq("organization_id", orgId);

    const logins = await seedStaff(orgId, r, roleIdBySlug);
    console.log(`  staff     ${logins.length} logins`);

    const tables = await seedFloor(orgId, r);
    console.log(`  floor     ${r.areas.length} areas · ${tables.length} tables (QR)`);

    const items = await seedMenu(orgId, r);
    console.log(`  menu      ${r.menu.length} categories · ${items.length} items`);

    await seedConfig(orgId, r);
    console.log(`  channels  ${r.channels.map((c) => c[1]).join(", ")}`);

    await seedService(orgId, tables, items, r);
    console.log(`  service   6 live tables · 4 settled bills`);

    const { data: qr } = await db
      .from("dining_tables")
      .select("label, qr_token")
      .eq("organization_id", orgId)
      .limit(1)
      .order("sort_order");

    report.push({ r, logins, sampleQr: qr?.[0] });
  }

  console.log("\n" + "═".repeat(74));
  console.log("DEMO CREDENTIALS — password for every account below:  " + PASSWORD);
  console.log("═".repeat(74));
  for (const { r, logins, sampleQr } of report) {
    console.log(`\n${r.name}   (/org after sign-in)`);
    for (const l of logins) console.log(`   ${l.role.padEnd(10)} ${l.email}`);
    if (sampleQr) console.log(`   guest QR   /t/${sampleQr.qr_token}   → table ${sampleQr.label}`);
  }
  console.log("\nRemove everything again with:  node scripts/seed-restaurants.mjs --remove\n");
}

await main();
