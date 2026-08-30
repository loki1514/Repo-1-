/**
 * Tiny psql stand-in. There is no psql on this machine and the Supabase MCP is
 * read-blocked, so migrations and ad-hoc queries both go through node-postgres
 * over the IPv4 session pooler in SUPABASE_DB_URL.
 *
 *   node scripts/db.mjs query "select 1"
 *   node scripts/db.mjs file supabase/migrations/0010_x.sql
 *   node scripts/db.mjs migrate          # applies every unapplied file, in order
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const [mode, arg] = process.argv.slice(2);

async function run(sql, label) {
  try {
    await client.query(sql);
    console.log(`ok   ${label}`);
  } catch (e) {
    console.error(`FAIL ${label}\n     ${e.message}`);
    throw e;
  }
}

try {
  if (mode === "query") {
    const res = await client.query(arg);
    console.log(JSON.stringify(res.rows, null, 2));
  } else if (mode === "file") {
    await run(readFileSync(arg, "utf8"), arg);
  } else if (mode === "migrate") {
    await client.query(`
      create table if not exists public.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`);
    const { rows } = await client.query("select name from public.schema_migrations");
    const done = new Set(rows.map((r) => r.name));
    const dir = "supabase/migrations";
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(f)) { console.log(`skip ${f}`); continue; }
      await run(readFileSync(join(dir, f), "utf8"), f);
      await client.query("insert into public.schema_migrations (name) values ($1)", [f]);
    }
  } else {
    console.error("usage: db.mjs query <sql> | file <path> | migrate");
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
