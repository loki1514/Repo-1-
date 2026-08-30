/**
 * Gives every demo restaurant one real, applicable workflow.
 *
 *   node scripts/seed-workflows.mjs
 *
 * Without this the workflow builder opens empty for a seeded org, and
 * "Apply to organization" has nothing to act on — which makes the one feature
 * that connects the canvas to the product impossible to demonstrate.
 *
 * The flow drawn here is the ordinary dine-in journey, with the roles each
 * module belongs to written onto the blocks. Applying it is what answers
 * "can the kitchen user see finances" — it cannot, because no Finance block
 * names the kitchen role.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const node = (id, kind, label, config, x, y) => ({
  id,
  // The canvas resolves the real node type from data.kind; type here is only
  // the coarse shape the older renderer understood.
  type: kind === "signin" ? "trigger" : kind === "end" ? "end" : "state",
  label,
  data: { kind, config, position: { x, y } },
});

const DINE_IN = {
  nodes: [
    node("n1", "signin", "Captain signs in", { role: "captain" }, 40, 200),
    node("n2", "module:orders", "Takes the order at the table",
      { roles: ["captain", "biller", "manager"], submodules: ["live_orders", "dine_in", "captain_ordering", "tables", "qr_ordering"] }, 280, 200),
    node("n3", "module:kds_kot", "Kitchen cooks it",
      { roles: ["kitchen", "manager"], submodules: ["kitchen_screen", "station_tickets", "item_states", "bump"] }, 520, 200),
    node("n4", "rule", "Bill over ₹5,000?", { expression: "total > 5000" }, 760, 200),
    node("n5", "approval", "Manager approves the discount", { role: "manager" }, 1000, 100),
    node("n6", "module:pos", "Cashier settles the bill",
      { roles: ["biller", "manager"], submodules: ["billing", "held_bills", "bill_settings", "printers"] }, 1000, 300),
    node("n7", "automation", "Print the bill", { action: "print_kot" }, 1240, 300),
    node("n8", "end", "Table closed", {}, 1480, 300),
  ],
  edges: [
    { from: "n1", to: "n2" },
    { from: "n2", to: "n3" },
    { from: "n3", to: "n4" },
    { from: "n4", to: "n5", if: "true" },
    { from: "n4", to: "n6", if: "false" },
    { from: "n5", to: "n6" },
    { from: "n6", to: "n7" },
    { from: "n7", to: "n8" },
  ],
};

const { data: orgs, error } = await db
  .from("organizations")
  .select("id, name")
  .eq("settings->>demo_seed", "restaurant");
if (error) {
  console.error(error.message);
  process.exit(1);
}

for (const org of orgs ?? []) {
  const { data: existing } = await db
    .from("org_workflows")
    .select("id, version")
    .eq("organization_id", org.id)
    .eq("key", "dine_in_service")
    .order("version", { ascending: false })
    .limit(1);

  const version = (existing?.[0]?.version ?? 0) + 1;
  const { error: wErr } = await db.from("org_workflows").insert({
    organization_id: org.id,
    key: "dine_in_service",
    name: "Dine-in service",
    module: "orders",
    version,
    definition: DINE_IN,
  });
  if (wErr) {
    console.error(`${org.name}: ${wErr.message}`);
    continue;
  }
  console.log(`ok  ${org.name} — dine_in_service v${version}`);
}
