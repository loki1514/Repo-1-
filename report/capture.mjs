/**
 * Drives the running app and captures every screen for the handover report.
 *
 * Deliberately a real journey rather than a set of isolated page loads: the
 * guest's order in shot 4 is the same order the floor shows in shot 8, the
 * kitchen bumps in shot 10 and the bill settles in shot 9. A report assembled
 * from unrelated screenshots would look fine and prove nothing.
 *
 *   node report/capture.mjs [baseUrl]
 */
import { chromium } from "playwright";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://localhost:51139";
// fileURLToPath, not .pathname — the repo path contains a space, and
// .pathname hands back "Vinni%20Pos", which mkdirSync happily creates.
const OUT = join(dirname(fileURLToPath(import.meta.url)), "shots");
mkdirSync(OUT, { recursive: true });

const QR_BLANK = "c7c91b3e8b";       // Table 29 — no session, shows the welcome gate
const DEMO_TABLE = "29";             // the table the whole journey runs on
const ORG_ID = "91fab9e6-6e16-49ca-8bb7-8c6d0c97f36d";        // Mysore — the flow is already applied here
const ORG_UNAPPLIED = process.env.REPORT_DIFF_ORG ?? "";   // an org whose flow has NOT been applied, so the diff is real

const OWNER = { email: "owner@mysoredininghall.example", password: "Vini@2026" };
const CAPTAIN = { email: "captain@mysoredininghall.example", password: "Vini@2026" };
const ADMIN = { email: "vinipos.mas-admin@vinipos.com", password: "operator1234%" };

const PHONE = { width: 402, height: 874 };
const DESK = { width: 1512, height: 950 };

const shots = [];
let n = 0;

const HIDE_DEV_CHROME = `
  nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }
`;

let currentAct = "guest";
async function shot(page, name, caption, { full = false } = {}) {
  n += 1;
  const file = `${String(n).padStart(2, "0")}-${name}.png`;
  await page.addStyleTag({ content: HIDE_DEV_CHROME }).catch(() => {});
  // A beat for transitions and lazy paint; the sheets animate in over 340ms.
  await page.waitForTimeout(700);

  const restore = page.viewportSize();
  if (full) {
    // Not fullPage: the org shell pins its sidebar with position:fixed, and a
    // fullPage capture stitches beyond the viewport without extending fixed
    // elements — leaving the sidebar cut off at a hard edge with white below.
    // Growing the viewport to the document height makes the whole page real.
    const h = await page.evaluate(() =>
      Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)),
    );
    // Cap it: a very long page rendered at one height becomes unreadable once
    // it is scaled into a print column.
    await page.setViewportSize({ width: restore.width, height: Math.min(h + 24, 2200) });
    await page.waitForTimeout(600);
  }

  await page.screenshot({ path: join(OUT, file) });
  if (full) await page.setViewportSize(restore);

  shots.push({ file, name, caption, act: currentAct });
  console.log(`  ✓ ${file}`);
}

async function login(page, who) {
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: who });
  const body = await res.json();
  if (!body.ok) throw new Error(`login failed for ${who.email}: ${JSON.stringify(body)}`);
}

/** Clicks by visible text, which survives class churn in a way selectors do not. */
async function clickText(page, text, { exact = true, nth = 0 } = {}) {
  const found = await page.evaluate(
    ({ text, exact, nth }) => {
      const hits = [...document.querySelectorAll("button, a")].filter((el) => {
        const t = (el.textContent ?? "").trim();
        return exact ? t === text : t.includes(text);
      });
      if (!hits[nth]) return false;
      hits[nth].click();
      return true;
    },
    { text, exact, nth },
  );
  if (!found) throw new Error(`no clickable "${text}"`);
  await page.waitForTimeout(900);
}

/**
 * Adds a specific dish by name, handling the size sheet when the dish has one.
 * Clicking "the second ADD" drifts the moment a section collapses or the tab
 * changes; naming the dish does not.
 */
async function addByName(page, dish) {
  const opened = await page.evaluate((dish) => {
    const row = [...document.querySelectorAll("li")].find((li) =>
      li.textContent?.includes(dish),
    );
    const add = row && [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "ADD");
    if (!add) return "missing";
    add.click();
    return "clicked";
  }, dish);
  if (opened === "missing") throw new Error(`no ADD for "${dish}"`);
  await page.waitForTimeout(700);

  // If a size sheet appeared, take the first size and move on.
  const sized = await page.evaluate(() => {
    const dlg = document.querySelector('[role=dialog][aria-label^="Choose a size"]');
    if (!dlg) return false;
    const first = [...dlg.querySelectorAll("button")].find((b) => /₹/.test(b.textContent ?? ""));
    first?.click();
    return true;
  });
  if (sized) await page.waitForTimeout(700);
}

/** Fails loudly rather than screenshotting whatever happened to be on screen. */
async function expectDialog(page, pattern) {
  const label = await page.evaluate(
    () => document.querySelector("[role=dialog]")?.getAttribute("aria-label") ?? null,
  );
  if (!label || !pattern.test(label)) {
    throw new Error(`expected a dialog matching ${pattern}, got ${JSON.stringify(label)}`);
  }
}

async function expectNoDialog(page) {
  const open = await page.evaluate(() => !!document.querySelector("[role=dialog]"));
  if (open) throw new Error("a dialog is still open when none was expected");
}

/** The order the guest just placed on the demo table — the bill must be theirs. */
async function guestOrderId() {
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select o.id from orders o
         join dining_tables t on t.id = o.table_id
         join organizations g on g.id = o.organization_id
        where g.slug = 'mysore-dining-hall' and t.label = $1 and o.placed_by = 'guest'
        order by o.created_at desc limit 1`,
      [DEMO_TABLE],
    );
    if (!rows[0]) throw new Error(`no guest order on table ${DEMO_TABLE}`);
    return rows[0].id;
  } finally {
    await client.end();
  }
}

/**
 * Bumps the KOT card belonging to one order. Cards are matched by their KOT
 * number rather than position, because the board reorders as tickets move
 * between columns.
 */
async function bumpTicketFor(page, orderId, label) {
  const ok = await page.evaluate(
    ({ label }) => {
      const cards = [...document.querySelectorAll("article, li, div")].filter((el) =>
        [...el.querySelectorAll("button")].some((b) => b.textContent.trim() === label),
      );
      // The innermost element that owns the button is the ticket card.
      const card = cards.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];
      const btn = card && [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
      if (!btn) return false;
      btn.click();
      return true;
    },
    { label },
  );
  if (!ok) throw new Error(`no "${label}" button on the pass`);
  await page.waitForTimeout(2600);
}

const browser = await chromium.launch();

// ---------------------------------------------------------------------------
console.log("\nAct 1 — the guest");
currentAct = "guest";
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    colorScheme: "light",
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/t/${QR_BLANK}`, { waitUntil: "networkidle" });
  await shot(page, "guest-welcome", "The sticker on table 29. No app, no login — the restaurant's own branding, and the one question staff can't infer later.");

  await clickText(page, "4");
  await clickText(page, "Start ordering", { exact: false });
  await page.waitForTimeout(1500);
  await shot(page, "guest-menu", "The table is open. The PIN is what a guest shares with anyone joining them — everyone lands on one bill.");

  await clickText(page, "Eat");
  await shot(page, "guest-eat", "Sections collapse independently. Veg / non-veg / egg marks are drawn, not images, so they stay crisp at 13px.");

  await clickText(page, "ADD");
  await expectDialog(page, /Choose a size/);
  await shot(page, "guest-variant", "An item with sizes asks before it adds. Price comes from the variant, never from the browser.");

  await clickText(page, "Full", { exact: false });
  await expectNoDialog(page);

  // Add a flat-priced dish too, so the cart shows both shapes of line. Picked
  // by name rather than position — the "second ADD" is a different dish
  // depending on which tab and which sections are open.
  await addByName(page, "Palak Paneer");
  await addByName(page, "Masala Dose");

  await clickText(page, "View cart", { exact: false });
  await expectDialog(page, /Your cart/i);
  await shot(page, "guest-cart", "The all-in number before they commit — service charge and tax included, not a subtotal that grows on the printed bill.");

  await clickText(page, "Place order", { exact: false });
  await page.waitForTimeout(3500);
  await shot(page, "guest-orders", "Status lives per dish, not per order. Three starters served and one main still in the pan is the normal case.");

  await clickText(page, "Pay Bill");
  await shot(page, "guest-bill", "Item total, service charge, SGST, CGST, round off. Computed by the same function the POS and the printer use.");

  await clickText(page, "Call Waiter");
  await shot(page, "guest-waiter", "Water, cutlery, clean up. This lands on the floor screen as a live request.");
  await clickText(page, "Water");
  await page.waitForTimeout(1200);

  await ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nAct 2 — the restaurant");
currentAct = "staff";
// ---------------------------------------------------------------------------
let billUrl = null;
{
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await ctx.newPage();
  await login(page, OWNER);

  const orderId = await guestOrderId();

  await page.goto(`${BASE}/org`, { waitUntil: "networkidle" });
  await shot(page, "staff-overview", "Where a manager lands. Real numbers, and an exit to whichever screen the shift needs.");

  await page.goto(`${BASE}/org/tables`, { waitUntil: "networkidle" });
  await shot(page, "staff-floor", "The floor. Table 29 is now running with the guest's order — and their water request has arrived under Guests calling.", { full: true });

  const href = `/org/bills/${orderId}`;
  if (href) {
    billUrl = `${BASE}${href}`;
    await page.goto(billUrl, { waitUntil: "networkidle" });
    await shot(page, "staff-bill", "The same total the guest saw, to the paisa. Change is the most error-prone number at a counter, so it gets the largest type.");
    await clickText(page, "KOT");
    await page.waitForTimeout(2500);
  }

  await page.goto(`${BASE}/org/kds`, { waitUntil: "networkidle" });
  await shot(page, "staff-kds", "The pass, the moment the ticket lands. Read at two metres by someone holding a pan — large type, 44px targets, borders that redden with age rather than by station.", { full: true });

  // Cook it and send it out, so the floor and the guest's phone have something
  // true to show. Without this the report claims a bump that never happened.
  await bumpTicketFor(page, orderId, "Start cooking");
  await bumpTicketFor(page, orderId, "Food is ready");
  await shot(page, "staff-kds-ready", "The same ticket after the kitchen bumps it. Every line is ticked and the card moves to Ready — which is what tells the floor to run the food.", { full: true });

  await page.goto(`${BASE}/org/tables`, { waitUntil: "networkidle" });
  await shot(page, "staff-floor-ready", "The floor, seconds later. Table 29 has flipped to Food ready with a count of what is waiting to be run.", { full: true });

  await page.goto(`${BASE}/org/live`, { waitUntil: "networkidle" });
  await shot(page, "staff-live", "Ball-by-ball. Every event from the journey above is here, attributed to whoever caused it — the guest, the kitchen, or the admin who fired the ticket.", { full: true });

  await page.goto(`${BASE}/org/channels`, { waitUntil: "networkidle" });
  await shot(page, "staff-channels", "Aggregator store on/off and per-item availability. Switching a dish off here removes it from the guest's live menu.", { full: true });

  await page.goto(`${BASE}/org/qr`, { waitUntil: "networkidle" });
  await shot(page, "staff-qr", "A real QR per table, grouped by area. Tokens are random, not table ids — an id would let anyone order to any table.");

  await page.goto(`${BASE}/org/pos`, { waitUntil: "networkidle" });
  await shot(page, "staff-pos", "Counter billing, for the walk-in who never scans anything. Same menu, same bill arithmetic, no table session.");

  await page.goto(`${BASE}/org/menu-items`, { waitUntil: "networkidle" });
  await shot(page, "staff-menu", "The catalogue behind every other screen. A price changed here is the price the guest's phone quotes on the next load.");

  if (billUrl) {
    await page.goto(`${billUrl}/print`, { waitUntil: "networkidle" });
    await shot(page, "staff-thermal", "The 80mm thermal bill. Literal black on white — a thermal printer has no colours and no greys.");
  }

  const mob = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, colorScheme: "light", isMobile: true, hasTouch: true });
  const mp = await mob.newPage();
  await login(mp, OWNER);
  await mp.goto(`${BASE}/org/captain`, { waitUntil: "networkidle" });
  await shot(mp, "staff-captain", "The captain's phone. Used standing, one-handed, in a busy room — everything reachable in the lower two-thirds.");
  await mob.close();

  await ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nAct 2b — back to the guest");
currentAct = "payoff";
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: PHONE, deviceScaleFactor: 2, colorScheme: "light", isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/t/${QR_BLANK}`, { waitUntil: "networkidle" });
  await clickText(page, "My Orders");
  await shot(page, "guest-ready", "The same phone, unchanged and unrefreshed by the guest. The kitchen's bump has reached the table: every dish now reads On its way.");
  await ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nAct 3 — the control plane");
currentAct = "admin";
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await ctx.newPage();
  await login(page, ADMIN);

  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await shot(page, "admin-dashboard", "The platform view: 49 tables and 22 staff accounts across every tenant, not just the three demo restaurants.");

  await page.goto(`${BASE}/admin/organizations`, { waitUntil: "networkidle" });
  await shot(page, "admin-orgs", "One repo, one deployment, tenancy in the data. Seven organizations — the three demo restaurants, plus older investor rows carried over from earlier work.");

  await page.goto(`${BASE}/admin/workflows?org=${ORG_ID}`, { waitUntil: "networkidle" });
  await shot(page, "admin-workflows", "The workflow builder, scoped to one restaurant. Module blocks name the screens a journey touches, and the roles on each block are who keeps them.", { full: true });

  // Deliberately a restaurant the flow has NOT been applied to. Mysore was
  // applied earlier in the build, so its panel reads "Nothing to apply" — a
  // screenshot of an empty diff is no evidence of anything.
  if (!ORG_UNAPPLIED) throw new Error("set REPORT_DIFF_ORG to an org whose dine-in flow is unapplied");
  await page.goto(`${BASE}/admin/workflows?org=${ORG_UNAPPLIED}`, { waitUntil: "networkidle" });
  await clickText(page, "Apply to org", { exact: false });
  await page.waitForTimeout(3000);
  await shot(page, "admin-apply", "The diff, before anything moves: which modules switch on, and exactly which role gains or loses which module. The passcode field below is the second lock.");

  await page.goto(`${BASE}/admin/roles`, { waitUntil: "networkidle" });
  await shot(page, "admin-roles", "The same permissions as a matrix, for the change that is one tick rather than a redrawn journey.");

  await ctx.close();
}

// ---------------------------------------------------------------------------
console.log("\nAct 4 — the proof");
currentAct = "proof";
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: DESK, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await ctx.newPage();
  await login(page, CAPTAIN);
  await page.goto(`${BASE}/org`, { waitUntil: "networkidle" });
  await shot(page, "proof-captain", "Signed in as the captain. Kitchen Display and POS Billing are in the sidebar because the canvas granted them — not because the code says so.");
  await ctx.close();
}

// A second restaurant, to show the theming is per-tenant and not a repaint.
{
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, colorScheme: "light", isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/t/646596c28d`, { waitUntil: "networkidle" });
  await shot(page, "proof-tenant", "The same code, a different restaurant. Accent, font and menu all come from the tenant row.");
  await ctx.close();
}

await browser.close();

const { writeFileSync } = await import("node:fs");
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(shots, null, 2));
console.log(`\n${shots.length} screenshots → report/shots/\n`);
