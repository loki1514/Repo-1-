/**
 * Seeds the platform-side cast from the storylines as real, signed-in-able
 * people — one per role in the Day-1 pack §5.2 / Day-2 §3 / Day-3 §3.
 *
 *   node scripts/seed-platform-team.mjs           # create / update
 *   node scripts/seed-platform-team.mjs --remove  # delete them again
 *
 * Every account is on a .example domain and shares one password, so none of
 * them can receive mail and none can be mistaken for a real person.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const PASSWORD = "Proviyaa@2026";

const TEAM = [
  { email: "tanvi@proviyaa.example",  name: "Tanvi Patil",     role: "sales_executive",      note: "Sales Executive — files leads, runs the pitch" },
  { email: "rahul@proviyaa.example",  name: "Rahul Joshi",     role: "sales_manager",        note: "Sales Manager — pipeline review, approves quotes" },
  { email: "omkar@proviyaa.example",  name: "Omkar Gaikwad",   role: "business_development", note: "Business Development — writes the scoping brief" },
  { email: "nidhi@proviyaa.example",  name: "Nidhi Desai",     role: "onboarding_admin",     note: "Onboarding — verifies the org, creates locations" },
  { email: "aditya@proviyaa.example", name: "Aditya Rao",      role: "customer_success",     note: "Customer Success — requirements, demo, training" },
  { email: "rohit@proviyaa.example",  name: "Rohit Kulkarni",  role: "operations",           note: "Operations — go-live readiness, blocked work" },
];

const remove = process.argv.includes("--remove");

async function findUser(email) {
  // listUsers is paged; the seed set is tiny so one page is enough.
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

for (const person of TEAM) {
  const existing = await findUser(person.email);

  if (remove) {
    if (existing) {
      await db.from("platform_admins").delete().eq("user_id", existing.id);
      await db.auth.admin.deleteUser(existing.id);
      console.log(`removed  ${person.email}`);
    } else {
      console.log(`absent   ${person.email}`);
    }
    continue;
  }

  let userId = existing?.id;
  if (existing) {
    await db.auth.admin.updateUserById(existing.id, { password: PASSWORD });
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: person.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: person.name, platform_role: person.role },
    });
    if (error) throw new Error(`${person.email}: ${error.message}`);
    userId = data.user.id;
  }

  const { error: upsertErr } = await db.from("platform_admins").upsert(
    { user_id: userId, email: person.email, role: person.role, full_name: person.name },
    { onConflict: "user_id" },
  );
  if (upsertErr) throw new Error(`${person.email}: ${upsertErr.message}`);

  console.log(`ok       ${person.email.padEnd(28)} ${person.role.padEnd(22)} ${person.name}`);
}

if (!remove) {
  console.log(`\nPassword for all of them: ${PASSWORD}`);
}
