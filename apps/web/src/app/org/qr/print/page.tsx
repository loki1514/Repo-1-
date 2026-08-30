import type { Metadata } from "next";
import { AutoPrint, PrintBar } from "@/components/org/qr/QrManager";
import { listQrTables } from "../actions";

export const metadata: Metadata = { title: "Print Table QR Codes" };
export const dynamic = "force-dynamic";

/**
 * /org/qr/print — one A4 sheet of table stickers, six to a page.
 *
 * The sheet renders inside the org shell (rail, top bar, aurora) because the
 * route sits under app/org/layout.tsx, which this screen does not own. Rather
 * than restructure the app for one printout, the print stylesheet below drops
 * that chrome by element type and flattens the shell's gutters, so what leaves
 * the printer is only the sheet.
 */
const SHEET_CSS = `
@page { size: A4 portrait; margin: 12mm; }

.qr-sheet {
  /* A sticker is ink on paper, so the sheet pins itself to the light end of
     the system palette. Painting it in --ink would print white-on-white for
     any manager whose browser is in dark mode, and a scanner would see
     nothing. color-scheme: light is what forces Canvas/CanvasText to resolve
     to paper and ink regardless of the surrounding theme. */
  color-scheme: light;
  background: Canvas;
  color: CanvasText;
  width: 190mm;
  max-width: 100%;
  margin-inline: auto;
  padding: 8mm;
  border-radius: var(--r-lg);
  box-shadow: 0 18px 40px -20px rgb(var(--shadow-color) / 0.45);
}

.qr-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6mm;
}

.qr-card {
  /* A sticker split across a page break is waste paper. */
  break-inside: avoid;
  page-break-inside: avoid;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2mm;
  padding: 7mm 4mm;
  text-align: center;
  border: 1px dashed color-mix(in srgb, CanvasText 26%, Canvas);
  border-radius: 3mm;
}

.qr-org { font-size: 11pt; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; }
.qr-scan { font-size: 8pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; opacity: 0.6; }
.qr-plate { width: 46mm; height: 46mm; margin: 1mm 0; }
.qr-plate svg { display: block; width: 100%; height: 100%; }
.qr-label { font-size: 27pt; font-weight: 800; line-height: 1; letter-spacing: -0.03em; }
.qr-area { font-size: 8.5pt; opacity: 0.6; }

@media print {
  /* Shell owned by app/org/layout.tsx — removed by type, not by class, so it
     stays correct if the layout is restyled. */
  .aurora, aside, header, .no-print { display: none !important; }
  .grain::after { display: none !important; }

  /* Flatten every ancestor of the sheet so it starts at the @page margin
     instead of inside the app's content gutters. */
  body :has(.qr-sheet) {
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
  }

  .qr-sheet {
    width: auto;
    max-width: none;
    padding: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .qr-grid { gap: 4mm; }
}
`;

export default async function QrPrintPage() {
  const floor = await listQrTables();
  if (!floor) return null;
  const { orgName, tables } = floor;

  // Only tables that actually resolve get a sticker: printing a card for a
  // table with no token would put a dead code on a real table.
  const sheet = tables.filter((t) => t.svg && t.isActive);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SHEET_CSS }} />
      <PrintBar count={sheet.length} />
      {sheet.length > 0 && <AutoPrint />}

      {sheet.length === 0 ? (
        <p className="dim rounded-[var(--r-lg)] px-4 py-10 text-center t-small text-muted">
          No active table has a code yet. Generate one on the QR screen first.
        </p>
      ) : (
        <div className="qr-sheet">
          <ol className="qr-grid">
            {sheet.map((table) => (
              <li key={table.id} className="qr-card">
                <p className="qr-org">{orgName}</p>
                <p className="qr-scan">Scan to order</p>
                <div
                  aria-hidden="true"
                  className="qr-plate"
                  dangerouslySetInnerHTML={{ __html: table.svg ?? "" }}
                />
                <p className="qr-label">{table.label}</p>
                <p className="qr-area">{table.areaName}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
