/**
 * Downloads the two webfaces and writes them as a base64 @font-face stylesheet.
 *
 * page.pdf() emitted a Times-Roman-only PDF even though the page reported
 * document.fonts.status === "loaded" — the print render does not wait for
 * network faces. Inlining removes the race and the network dependency, and
 * leaves report.html openable offline.
 */
import { writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const SPEC = "family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";

const css = await (await fetch(`https://fonts.googleapis.com/css2?${SPEC}`, { headers: { "User-Agent": UA } })).text();

// Each face is preceded by a /* subset */ comment; keep latin only — the other
// subsets triple the payload and this document is English throughout.
const faces = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]+\})/g)];
let out = "";
let bytes = 0;
let kept = 0;

for (const [, subset, rule] of faces) {
  if (subset !== "latin") continue;
  const url = rule.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  if (!url) continue;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  bytes += buf.length;
  kept += 1;
  out += rule.replace(/url\(https:[^)]+\.woff2\)/, `url(data:font/woff2;base64,${buf.toString("base64")})`) + "\n";
}

if (kept === 0) throw new Error("no latin faces parsed — Google Fonts CSS shape changed");
writeFileSync("fonts/inline.css", out);
console.log(`  faces kept: ${kept}  woff2: ${(bytes / 1024).toFixed(0)}k  css: ${(out.length / 1024).toFixed(0)}k`);
