import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const doc = await getDocument({ url: process.argv[2], useSystemFonts: true }).promise;
console.log(`PAGES: ${doc.numPages}\n`);
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  let last = null, line = [];
  const out = [];
  for (const it of tc.items) {
    const y = Math.round(it.transform[5]);
    if (last !== null && Math.abs(y - last) > 2) { out.push(line.join("")); line = []; }
    line.push(it.str);
    last = y;
  }
  out.push(line.join(""));
  console.log(`─── page ${i} ───`);
  console.log(out.filter(l => l.trim()).join("\n"));
  console.log();
}
