/**
 * Assembles the handover PDF from the captured journey.
 *
 * The screenshots are one continuous session, so the report is written as a
 * narrative rather than a feature list: the order placed on page 6 is the
 * order billed on page 10 and settled on page 12. Captions say why a screen
 * is the way it is, not what is on it — the picture already says that.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const shots = JSON.parse(readFileSync(join(HERE, "shots/manifest.json"), "utf8"));
const creds = JSON.parse(readFileSync("/tmp/creds.json", "utf8"));
const qr = JSON.parse(readFileSync("/tmp/qr.json", "utf8"));
const FONT_CSS = readFileSync(join(HERE, "fonts/inline.css"), "utf8");
const perms = JSON.parse(readFileSync("/tmp/perms.json", "utf8"));

const BUILT = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const PASSWORD = "Vini@2026";
const PASSCODE = "vini-builder-2026";

const byPrefix = (p) => shots.filter((s) => s.name.startsWith(p));
const isPhone = (s) => /guest|captain|tenant/.test(s.name);
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const figure = (s, i) => `
  <figure class="shot ${isPhone(s) ? "phone" : "wide"}">
    <img src="opt/${s.file.replace(/\.png$/, ".jpg")}" alt="${esc(s.caption)}">
    <figcaption><span class="num">${String(i).padStart(2, "0")}</span>${esc(s.caption)}</figcaption>
  </figure>`;

/** Phone shots read better two-up; wide ones want the full measure. */
function gallery(list, startIndex) {
  const out = [];
  let i = startIndex;
  let buffer = [];
  const flush = () => {
    if (buffer.length) {
      out.push(`<div class="pair">${buffer.join("")}</div>`);
      buffer = [];
    }
  };
  for (const s of list) {
    if (isPhone(s)) {
      buffer.push(figure(s, i++));
      if (buffer.length === 2) flush();
    } else {
      flush();
      out.push(figure(s, i++));
    }
  }
  flush();
  return { html: out.join("\n"), next: i };
}

const orgs = [...new Set(creds.map((c) => c.org))];
const orgBlock = (org) => {
  const rows = creds.filter((c) => c.org === org);
  const meta = rows[0];
  const link = qr.find((q) => q.name === org);
  return `
  <div class="org">
    <div class="org-head">
      <span class="swatch" style="background:${meta.accent}"></span>
      <h3>${esc(org)}</h3>
      <span class="org-meta">${meta.tables} tables · ${meta.items} menu items</span>
    </div>
    <table class="creds">
      <thead><tr><th>Role</th><th>Email</th><th>Sees</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td class="role">${esc(r.role.replace("_", " "))}</td>
          <td class="mono">${esc(r.email)}</td>
          <td class="dim">${seesCell(org, r.role)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${link ? `<p class="qr-line">Guest QR · table ${esc(link.label)} → <span class="mono">/t/${esc(link.qr_token)}</span></p>` : ""}
  </div>`;
};

const MODULE_LABEL = {
  dashboard: "Dashboard", orders: "Orders", pos: "POS / Billing",
  kds_kot: "Kitchen display", menu: "Menu", inventory: "Inventory",
  finance: "Finance", marketing_crm: "Marketing & CRM", staff: "Staff",
  settings: "Settings",
};

const permFor = (org, role) => perms.find((p) => p.org === org && p.role === role);

/** What this role can actually open, with canvas-granted modules called out. */
function seesCell(org, role) {
  const row = permFor(org, role);
  if (!row?.sees) return '<span class="dim">Nothing — every module is switched off</span>';
  const mods = row.sees.split(",");
  const canvas = new Set((row.from_canvas ?? "").split(",").filter(Boolean));

  const body = mods.length >= 9
    ? "Every module"
    : mods.map((m) => {
        const label = MODULE_LABEL[m] ?? m;
        return canvas.has(m) ? `<b class="granted">${label}</b>` : label;
      }).join(", ");

  const note = canvas.size
    ? `<span class="granted-note">Bold: granted by applying the dine-in flow on the canvas.</span>`
    : "";
  return body + note;
}

const g1 = gallery(byPrefix("guest-"), 1);
const g2 = gallery(byPrefix("staff-"), g1.next);
const g3 = gallery(byPrefix("admin-"), g2.next);
const g4 = gallery(byPrefix("proof-"), g3.next);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Vini POS — Restaurant Operations</title>
<style>${FONT_CSS}</style>
<style>
  :root{
    --ink:#12150f; --ink-2:#3b4034; --muted:#71776b;
    --paper:#ffffff; --paper-2:#f5f5f1;
    --line:rgb(18 21 15 / .12); --hair:rgb(18 21 15 / .07);
    --lime:#b4ee2a; --lime-deep:#5f9a08; --lime-ink:#1a2800;
  }
  @page{ size:A4; margin:0 }
  *{ box-sizing:border-box; margin:0; padding:0 }
  body{
    font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,sans-serif;
    color:var(--ink); background:var(--paper);
    font-size:9.6pt; line-height:1.62; -webkit-font-smoothing:antialiased;
  }
  .mono{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:8.6pt; letter-spacing:-.01em }
  .page{ width:210mm; min-height:285mm; padding:18mm 17mm 10mm; page-break-after:always; position:relative }
  .page:last-child{ page-break-after:auto }

  /* ---- cover ---- */
  .cover{ background:#0c0f08; color:#f3f6ec; display:flex; flex-direction:column; justify-content:space-between }
  .cover .mark{ width:46px; height:46px; border-radius:13px; display:flex; align-items:center; justify-content:center;
    background:linear-gradient(180deg,#d6ff63,#79bc0d); color:var(--lime-ink); font-weight:800; font-size:20pt }
  .cover h1{ font-size:40pt; line-height:1.02; letter-spacing:-.035em; font-weight:800; margin-top:14mm }
  .cover h1 em{ font-style:normal; color:var(--lime) }
  .cover .lede{ font-size:12.5pt; line-height:1.55; color:#c3cab7; max-width:135mm; margin-top:7mm; font-weight:500 }
  .cover .facts{ display:grid; grid-template-columns:repeat(4,1fr); gap:6mm; margin-top:14mm;
    border-top:1px solid rgb(255 255 255 / .16); padding-top:7mm }
  .cover .facts b{ display:block; font-size:19pt; font-weight:800; letter-spacing:-.02em }
  .cover .facts span{ font-size:8pt; color:#98a08c; text-transform:uppercase; letter-spacing:.09em; font-weight:700 }
  .cover footer{ font-size:8.6pt; color:#98a08c; display:flex; justify-content:space-between; align-items:flex-end }

  /* ---- structure ---- */
  .kicker{ font-size:7.6pt; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--lime-deep) }
  h2{ font-size:22pt; font-weight:800; letter-spacing:-.03em; line-height:1.1; margin:2mm 0 4mm }
  h3{ font-size:11.5pt; font-weight:800; letter-spacing:-.015em }
  .intro{ font-size:10.6pt; color:var(--ink-2); max-width:150mm; line-height:1.6 }
  .rule{ height:2px; background:var(--ink); width:16mm; margin:6mm 0 }

  /* ---- screenshots ---- */
  .shot{ break-inside:avoid; margin:0 0 7mm }
  .shot img{ display:block; width:100%; border:1px solid var(--line); border-radius:5px }
  .shot.phone img{ border-radius:9px }
  .pair{ display:grid; grid-template-columns:1fr 1fr; gap:7mm; break-inside:avoid }
  figcaption{ font-size:8.6pt; color:var(--ink-2); line-height:1.5; margin-top:2.6mm; display:flex; gap:2.4mm }
  .num{ font-family:'JetBrains Mono',monospace; font-size:7.6pt; font-weight:500; color:var(--lime-deep);
    padding-top:.4mm; flex:none }

  /* ---- credentials ---- */
  .org{ break-inside:avoid; margin-bottom:7mm; border:1px solid var(--line); border-radius:7px; overflow:hidden }
  .org-head{ display:flex; align-items:center; gap:3mm; padding:3.4mm 4mm; background:var(--paper-2);
    border-bottom:1px solid var(--hair) }
  .swatch{ width:11px; height:11px; border-radius:3px; flex:none; box-shadow:inset 0 0 0 1px rgb(0 0 0 / .12) }
  .org-meta{ margin-left:auto; font-size:8.2pt; color:var(--muted); font-weight:600 }
  table.creds{ width:100%; border-collapse:collapse }
  table.creds th{ text-align:left; font-size:7.4pt; text-transform:uppercase; letter-spacing:.1em;
    color:var(--muted); padding:2.6mm 4mm 1.6mm; font-weight:800 }
  table.creds td{ padding:2mm 4mm; border-top:1px solid var(--hair); vertical-align:top }
  td.role{ font-weight:700; text-transform:capitalize; white-space:nowrap }
  td.dim{ color:var(--muted); font-size:8.4pt }
  .granted{ color:var(--ink); font-weight:700 }
  .granted-note{ display:block; margin-top:1mm; font-size:7.4pt; color:var(--lime-deep); font-weight:600 }
  .qr-line{ padding:2.6mm 4mm; border-top:1px solid var(--hair); font-size:8.6pt; color:var(--ink-2); background:var(--paper-2) }

  /* ---- callouts ---- */
  .key{ border-left:3px solid var(--lime-deep); background:var(--paper-2); padding:4mm 5mm; border-radius:0 6px 6px 0;
    margin:5mm 0; break-inside:avoid }
  .key b{ font-weight:800 }
  .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:6mm }
  ol.steps{ counter-reset:s; list-style:none; margin-top:3mm }
  ol.steps li{ counter-increment:s; position:relative; padding-left:9mm; margin-bottom:3.4mm; break-inside:avoid }
  ol.steps li::before{ content:counter(s,decimal-leading-zero); position:absolute; left:0; top:.2mm;
    font-family:'JetBrains Mono',monospace; font-size:8pt; font-weight:500; color:var(--lime-deep) }
  ul.plain{ list-style:none } ul.plain li{ padding-left:5mm; position:relative; margin-bottom:2mm }
  ul.plain li::before{ content:''; position:absolute; left:0; top:2.4mm; width:2.4mm; height:2.4mm;
    border-radius:1px; background:var(--lime-deep) }
  ul.plain li.no::before{ background:var(--muted); opacity:.45 }
  code{ font-family:'JetBrains Mono',monospace; font-size:8.4pt; background:var(--paper-2);
    padding:.6mm 1.4mm; border-radius:3px; border:1px solid var(--hair) }
  pre{ font-family:'JetBrains Mono',monospace; font-size:8.4pt; background:#0c0f08; color:#e7ecdd;
    padding:4mm 5mm; border-radius:6px; line-height:1.65; overflow:hidden; white-space:pre-wrap }
  pre .c{ color:#8a9280 }
</style></head><body>

<!-- COVER -->
<section class="page cover">
  <div>
    <div class="mark">V</div>
    <h1>The whole service,<br><em>QR to printed bill.</em></h1>
    <p class="lede">Vini POS now runs a restaurant end to end. One guest journey crosses five screens
      that all read the same data — scan, order, cook, serve, settle. This is the walkthrough,
      captured from a live session, with every credential you need to repeat it.</p>
    <div class="facts">
      <div><b>26</b><span>Screens captured</span></div>
      <div><b>3</b><span>Demo restaurants</span></div>
      <div><b>15</b><span>Staff logins</span></div>
      <div><b>41</b><span>Tables with QR</span></div>
    </div>
  </div>
  <footer>
    <div>Vini POS · Restaurant Operations · <span class="mono">main @ 20c1b8d</span></div>
    <div>${BUILT}</div>
  </footer>
</section>

<!-- CREDENTIALS -->
<section class="page">
  <div class="kicker">Section 01</div>
  <h2>Credentials</h2>
  <div class="rule"></div>
  <p class="intro">Every account below uses the same password. These are demo accounts on
    <span class="mono">.example</span> domains — they cannot receive mail, which is deliberate:
    nothing here can be mistaken for a real customer.</p>

  <div class="key">
    <b>Password for all 15 staff accounts:</b> <code>${PASSWORD}</code><br>
    <b>Master admin:</b> <code>vinipos.mas-admin@vinipos.com</code> / <code>operator1234%</code><br>
    <b>Workflow builder passcode:</b> <code>${PASSCODE}</code> — the second lock on anything that moves permissions.
  </div>

  ${orgs.map(orgBlock).join("\n")}

  <div class="key">
    <b>The guest side needs no login at all.</b> The QR token is the credential for the table, and the
    4-digit PIN is the credential for the party — it only ever widens access to a bill already open on
    that same table.
  </div>
</section>

<!-- RUNNING IT -->
<section class="page">
  <div class="kicker">Section 02</div>
  <h2>Running it</h2>
  <div class="rule"></div>
  <p class="intro">The database is already migrated and seeded — three restaurants sit mid-service,
    with occupied tables, food on the pass and a guest asking for water. An empty POS demonstrates nothing.</p>

<pre><span class="c"># from the repo root</span>
npm run dev

<span class="c"># reseed the three demo restaurants (idempotent — QR tokens survive)</span>
cd apps/web && node scripts/seed-restaurants.mjs

<span class="c"># give each one a starter workflow to apply</span>
node scripts/seed-workflows.mjs

<span class="c"># remove every demo row again</span>
node scripts/seed-restaurants.mjs --remove</pre>

  <div class="key">
    <b>One thing that will bite you.</b> If arbitrary Tailwind sizes look wrong in dev — buttons squashed,
    sheets clipped — it is a stale <code>.next</code> cache, not the code. Delete <code>apps/web/.next</code>
    and restart. The production build is unaffected; this report was recaptured after hitting exactly that.
  </div>

  <h3 style="margin-top:8mm">The journey these screenshots follow</h3>
  <ol class="steps">
    <li>A guest scans the sticker on table 29 and opens the table.</li>
    <li>They pick a size, build a cart, and see the all-in total before committing.</li>
    <li>The order lands on the restaurant's floor view within a minute, with the table's PIN.</li>
    <li>The biller opens the bill — identical totals, to the paisa — and fires the KOT.</li>
    <li>The kitchen display picks it up; the kitchen bumps it to ready.</li>
    <li>The floor flips to "food ready", and the guest's own phone says "on its way".</li>
    <li>A platform admin redraws the flow on the canvas and applies it — and a role's sidebar changes.</li>
  </ol>
</section>

<!-- ACT 1 -->
<section class="page">
  <div class="kicker">Section 03 · Act one</div>
  <h2>The guest</h2>
  <div class="rule"></div>
  <p class="intro">No app, no sign-up, no account. The table is the credential: everyone scanning
    table 29 lands on one bill, which is what a restaurant actually wants. Prices are re-derived on the
    server for every order, so a tampered payload buys nothing cheaper than the menu says.</p>
  <div style="margin-top:7mm">${g1.html}</div>
</section>

<!-- ACT 2 -->
<section class="page">
  <div class="kicker">Section 04 · Act two</div>
  <h2>The restaurant</h2>
  <div class="rule"></div>
  <p class="intro">The same order, seen from the floor, the pass and the till. Every total on these
    screens comes from one function — five surfaces quote a price, and if any two rounded differently
    there would be an argument at the table.</p>
  <div style="margin-top:7mm">${g2.html}</div>
</section>

<!-- ACT 3 -->
<section class="page">
  <div class="kicker">Section 05 · Act three</div>
  <h2>The control plane</h2>
  <div class="rule"></div>
  <p class="intro">One repo, one deployment, tenancy in the data. The workflow canvas is not
    documentation of how the product is configured — it is how the product is configured.</p>
  <div style="margin-top:7mm">${g3.html}</div>
</section>

<!-- ACT 4 -->
<section class="page">
  <div class="kicker">Section 06 · Act four</div>
  <h2>The proof</h2>
  <div class="rule"></div>
  <p class="intro">Screens used to guard themselves with hardcoded role lists, which silently outranked
    the control plane: an admin could grant access from the canvas, watch it appear in the nav, and still
    be refused at the page. Both now ask the same question of the same source.</p>
  <div style="margin-top:7mm">${g4.html}</div>
</section>

<!-- STATUS -->
<section class="page">
  <div class="kicker">Section 07</div>
  <h2>What is real, and what is not</h2>
  <div class="rule"></div>
  <p class="intro">A demo that hides its edges is worth less than one that names them.</p>

  <div class="grid2" style="margin-top:6mm">
    <div>
      <h3>Built and working</h3>
      <ul class="plain" style="margin-top:3mm">
        <li>Guest QR ordering, variants, cart, per-dish status, bill, call waiter</li>
        <li>Floor view with live service requests and per-table state</li>
        <li>Kitchen display with per-line and per-ticket bumping</li>
        <li>Captain's phone ordering, firing straight to the kitchen</li>
        <li>Bill, split payment, change, and an 80mm thermal print</li>
        <li>Ball-by-ball live operations board with an audit timeline</li>
        <li>Store on/off and per-item, per-channel availability</li>
        <li>QR generation, regeneration and printable sheets</li>
        <li>Workflow canvas that writes real modules and permissions</li>
      </ul>
    </div>
    <div>
      <h3>Not built yet</h3>
      <ul class="plain" style="margin-top:3mm">
        <li class="no"><b>Swiggy and Zomato are modelled, not connected.</b> Store on/off, commission
          and aggregator orders all work — against our own data. Real orders need partner API
          credentials and a webhook.</li>
        <li class="no">Submodule tick-lists are descriptive; modules hide, individual screens inside
          them do not.</li>
        <li class="no">Rule and approval nodes on the canvas are drawn but not enforced at runtime.</li>
        <li class="no">Order history, inventory, CRM, payments, reports and settings are still stubs.</li>
        <li class="no">No deployment yet — see the next section.</li>
      </ul>
    </div>
  </div>

  <div class="key" style="margin-top:7mm">
    <b>Two tenancy holes were found and closed during this build.</b> <code>setLineStatus</code> and
    <code>fireKot</code> both accepted an organization id and never filtered on it, so a forged uuid from
    a kitchen tablet — the least supervised device in the building — could have written to another
    restaurant's orders. Both now verify ownership through the parent order before touching a row.
  </div>
</section>

<!-- DEPLOY -->
<section class="page">
  <div class="kicker">Section 08</div>
  <h2>Deploying</h2>
  <div class="rule"></div>
  <p class="intro">The code is on <span class="mono">main</span>. Nothing is live yet —
    <span class="mono">vinipos.com</span> still serves a Hostinger parking page.</p>

  <h3 style="margin-top:7mm">Environment variables Vercel needs</h3>
  <p style="color:var(--ink-2); margin-top:2mm"><code>.env.local</code> never deploys. Miss the service
    key and login returns a 500; miss the passcode and “Apply to organization” refuses to run, by design.</p>
<pre>SUPABASE_URL                    NEXT_PUBLIC_SUPABASE_URL
SUPABASE_ANON_KEY               NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY       PLATFORM_BASE_DOMAIN
ADMIN_BUILDER_PASSCODE          GROQ_API_KEY</pre>

  <h3 style="margin-top:7mm">Domain</h3>
  <p style="color:var(--ink-2); margin-top:2mm">Tenant subdomains (<span class="mono">saffron.vinipos.com</span>)
    need a wildcard record, and a wildcard needs the nameservers moved to Vercel — a CNAME will not do it.
    Recreate any existing records, MX especially, before the cutover.</p>

  <h3 style="margin-top:7mm">Database</h3>
  <p style="color:var(--ink-2); margin-top:2mm">Migration <span class="mono">0010_restaurant_operations.sql</span>
    is already applied to the live Supabase project, so the database is ahead of the deploy rather than
    behind it. Nothing to run at cutover.</p>

  <div class="key" style="margin-top:8mm">
    <b>The one thing worth checking first.</b> Sign in as the Mysore captain, note the sidebar, then apply
    the dine-in flow from the canvas and sign in again. If the sidebar changes, the control plane is
    genuinely wired — and everything else in this report follows from that.
  </div>
</section>

</body></html>`;

writeFileSync(join(HERE, "report.html"), html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + join(HERE, "report.html"), { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: join(HERE, "Vini-POS-Restaurant-Operations.pdf"),
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate: `<div style="width:100%;font-family:-apple-system,sans-serif;font-size:7.5pt;
    color:#a8ae9d;padding:0 17mm;text-align:right;"><span class="pageNumber"></span></div>`,
  margin: { top: "0", bottom: "12mm", left: "0", right: "0" },
});
await browser.close();
console.log("PDF written");
