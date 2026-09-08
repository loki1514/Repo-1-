/**
 * Gap 6 — overdue work has to reach somebody.
 *
 *   node scripts/escalate-overdue.mjs
 *
 * Flags every overdue, unescalated work item once, notifies Operations and
 * writes it to the organization's timeline. Idempotent: an item already
 * escalated is skipped, so this is safe to run on a schedule (cron, a Vercel
 * cron route, or by hand). The logic lives in escalate_overdue_work() in
 * migration 0018 so it runs in one transaction inside the database.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db.rpc("escalate_overdue_work");
if (error) {
  console.error("escalate_overdue_work:", error.message);
  process.exit(1);
}
console.log(`escalated ${data} overdue work item(s) to Operations`);
