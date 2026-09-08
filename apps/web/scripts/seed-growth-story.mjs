/**
 * Seeds the Annapurna storyline (docs/os claude .txt) as demo Growth data.
 *
 *   node scripts/seed-growth-story.mjs            # wipe demo rows and reseed
 *   node scripts/seed-growth-story.mjs --remove   # wipe only
 *
 * EVERY ROW THIS WRITES IS DUMMY DATA. Contacts are fictional, phone numbers
 * are not real, and every organization it creates is on a .example domain.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const DUMMY = "DUMMY DATA — seeded demo row, not a real business.";
const remove = process.argv.includes("--remove");

const STORY_NAMES = [
  "Annapurna Hospitality",
  "More Supermart",
  "Shree Ganesh Restaurant",
];

// ---------------------------------------------------------------------------
// wipe: organizations created from a seeded lead, then the leads themselves
// ---------------------------------------------------------------------------
const { data: seededLeads } = await db.from("leads").select("id, business_name");
const seededIds = (seededLeads ?? [])
  .filter((l) => STORY_NAMES.includes(l.business_name) || /Kamat Family Kitchen/.test(l.business_name))
  .map((l) => l.id);

if (seededIds.length) {
  const { data: orgs } = await db
    .from("organizations")
    .select("id, name")
    .in("source_lead_id", seededIds);
  for (const o of orgs ?? []) {
    // work_items / activities / handoffs / requirements cascade on org delete
    await db.from("org_users").delete().eq("organization_id", o.id);
    await db.from("organizations").delete().eq("id", o.id);
    console.log(`removed org  ${o.name}`);
  }
  await db.from("leads").delete().in("id", seededIds);
  console.log(`removed ${seededIds.length} seeded lead(s)`);
}

if (remove) {
  console.log("\nDemo growth data removed.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// people — leads are attributed to the real platform accounts
// ---------------------------------------------------------------------------
const { data: team } = await db.from("platform_admins").select("user_id, email, role, full_name");
const by = (email) => team?.find((t) => t.email === email)?.user_id ?? null;

const tanvi = by("tanvi@proviyaa.example");
const omkar = by("omkar@proviyaa.example");
if (!tanvi) {
  console.error("Run scripts/seed-platform-team.mjs first — Tanvi does not exist.");
  process.exit(1);
}

async function makeLead(row, events = []) {
  const { data, error } = await db.from("leads").insert(row).select("id, business_name").single();
  if (error) throw new Error(`${row.business_name}: ${error.message}`);
  for (const e of events) {
    const { error: evErr } = await db.from("lead_events").insert({ ...e, lead_id: data.id });
    if (evErr) throw new Error(`${row.business_name} event: ${evErr.message}`);
  }
  console.log(`lead   ${data.business_name.padEnd(26)} ${row.status}`);
  return data.id;
}

// 1. Annapurna — the hero of the storyline, ready to convert
const annapurna = await makeLead(
  {
    business_name: "Annapurna Hospitality",
    contact_name: "Sunita Deshmukh",
    contact_phone: "+91 98600 21140",
    source: "referral",
    referrer_name: "Dr. Farhan Shaikh",
    assigned_to: tanvi,
    status: "qualified",
    created_by: tanvi,
  },
  [
    {
      from_status: "new",
      to_status: "contacted",
      note: "Three outlets, kitchen can't read handwritten KOTs on Sundays. Owner is the decision-maker.",
      actor: tanvi,
    },
    {
      from_status: "contacted",
      to_status: "qualified",
      note: "Demo on the tablet went well. Asked about franchise visibility and offline. Requests scoping.",
      actor: tanvi,
    },
  ],
);

const { error: dealErr } = await db.from("deals").insert({
  lead_id: annapurna,
  brief:
    "Annapurna Main — 24 tables in three zones, family hall needs its own zone manager, tandoor as a separate kitchen station; " +
    "Annapurna Express — 8 tables, counter service, no reservations; " +
    "Annapurna Ganj Golai — franchised to Deepak Bansode, franchise organization type; " +
    "Sunday thali as a fixed-price bundle on One Latur; kitchen screen in Marathi; Zydus corporate contract billed monthly",
  quote_amount: 240000,
  plan: "Annual",
  status: "quoted",
  created_by: omkar ?? tanvi,
});
if (dealErr) throw new Error(`Annapurna deal: ${dealErr.message}`);
console.log("deal   Annapurna Hospitality      quoted · ₹2,40,000 · Annual");

// Farhan's commission exists from the moment the deal is quoted — greyed and
// not payable until the money lands (docs/os claude .txt:431).
const { data: annDeal } = await db.from("deals").select("id").eq("lead_id", annapurna).single();
if (annDeal) {
  await db.from("commissions").upsert(
    {
      deal_id: annDeal.id,
      lead_id: annapurna,
      partner_name: "Dr. Farhan Shaikh",
      basis: "referral",
      rate_percent: 10,
      amount: 24000,
    },
    { onConflict: "deal_id" },
  );
  console.log("comm   Dr. Farhan Shaikh          provisional · ₹24,000");
}

// 2. More Supermart — untouched, so the queue has a fresh lead in it
await makeLead({
  business_name: "More Supermart",
  contact_name: "Rajesh Kulkarni",
  contact_phone: "+91 98220 41188",
  source: "cold",
  assigned_to: tanvi,
  status: "new",
  created_by: tanvi,
});

// 3. Shree Ganesh — mid-conversation
await makeLead(
  {
    business_name: "Shree Ganesh Restaurant",
    contact_name: "Suresh Pawar",
    contact_phone: "+91 90210 77450",
    source: "inbound",
    assigned_to: tanvi,
    status: "contacted",
    created_by: tanvi,
  },
  [
    {
      from_status: "new",
      to_status: "contacted",
      note: "35 tables, manual KOT coordination, stock discrepancies, delivery handled separately.",
      actor: tanvi,
    },
  ],
);

console.log(`\n${DUMMY}`);
console.log("Seeded 3 leads. Annapurna is quoted and ready to be marked won.");
