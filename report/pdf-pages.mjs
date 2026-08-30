/**
 * Renders every page of the finished PDF to a PNG, for eyeballing pagination.
 *
 * Chromium refuses to display a PDF in headless (it downloads it) and pdf.js in
 * a page proved flaky here, so this goes the other way: ask Chromium for each
 * page as its own one-page PDF, then let macOS `sips` rasterise it. Slower, but
 * it renders the actual deliverable rather than an approximation of it.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, ".pages-tmp");
const OUT = join(HERE, "pdfpages");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const TOTAL = Number(process.argv[2] ?? 22);

const b = await chromium.launch();
const p = await b.newPage();
await p.goto("file://" + join(HERE, "report.html"), { waitUntil: "networkidle" });
await p.emulateMedia({ media: "print" });
await p.evaluate(() => document.fonts.ready);

try {
for (let i = 1; i <= TOTAL; i++) {
  const one = join(TMP, `p${i}.pdf`);
  await p.pdf({
    path: one, format: "A4", printBackground: true, pageRanges: String(i),
    displayHeaderFooter: true, headerTemplate: "<div></div>",
    footerTemplate: `<div style="width:100%;font-family:-apple-system,sans-serif;font-size:7.5pt;
      color:#a8ae9d;padding:0 17mm;text-align:right;"><span class="pageNumber"></span></div>`,
    margin: { top: "0", bottom: "12mm", left: "0", right: "0" },
  });
  execFileSync("sips", ["-s", "format", "png", "-Z", "1400", one,
    "--out", join(OUT, `p${String(i).padStart(2, "0")}.png`)], { stdio: "ignore" });
}
  console.log(`  rendered ${TOTAL} true PDF pages`);
} finally {
  // Always runs — an out-of-range page range used to throw here and leave the
  // whole temp directory behind for git to pick up.
  await b.close();
  rmSync(TMP, { recursive: true, force: true });
}
