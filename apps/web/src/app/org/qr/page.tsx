import type { Metadata } from "next";
import { Printer, QrCode, TriangleAlert } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { QrManager, type QrGroup } from "@/components/org/qr/QrManager";
import { listQrTables } from "./actions";

export const metadata: Metadata = { title: "Table QR Codes" };
export const dynamic = "force-dynamic";

/**
 * /org/qr — the sticker workshop.
 *
 * The codes are drawn on the server (see ./actions.ts) and handed down as SVG
 * strings, so the browser never loads a QR library and the printed sheet and
 * the on-screen card are provably the same image.
 */
export default async function QrPage() {
  const floor = await listQrTables();
  if (!floor) return null;
  const { canManage, areas, tables } = floor;

  // Areas first, in floor-plan order, then anything unassigned — the same
  // grouping the reference table view uses, so staff read one mental map.
  const groups: QrGroup[] = [
    ...areas.map((a) => ({
      id: a.id,
      name: a.name,
      tables: tables.filter((t) => t.areaId === a.id),
    })),
    {
      id: "unassigned",
      name: "Unassigned",
      tables: tables.filter((t) => !t.areaId),
    },
  ].filter((g) => g.tables.length > 0);

  const withCode = tables.filter((t) => t.token).length;
  const missing = tables.length - withCode;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="t-h1">Table QR Codes</h1>
          <p className="mt-2 max-w-xl text-[15px] text-muted">
            Every sticker points at <span className="tnum">/t/&lt;code&gt;</span>{" "}
            on this restaurant&rsquo;s own domain. A guest who scans lands on
            their table&rsquo;s menu with no app and no login.
          </p>
        </div>

        {tables.length > 0 && (
          <ButtonLink
            href="/org/qr/print"
            target="_blank"
            variant="lime"
            feedback="medium"
          >
            <Printer size={16} strokeWidth={2.4} />
            Print all
          </ButtonLink>
        )}
      </div>

      <div className="flex flex-wrap gap-2.5">
        <Stat icon={QrCode} value={withCode} label="tables with a code" />
        {missing > 0 && (
          <Stat
            icon={TriangleAlert}
            value={missing}
            label="waiting for a code"
            tone="var(--warn)"
          />
        )}
      </div>

      <QrManager groups={groups} canManage={canManage} />
    </div>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof QrCode;
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <div className="dim flex items-center gap-2.5 rounded-[var(--r-md)] px-3.5 py-2.5">
      <Icon
        size={16}
        strokeWidth={2.4}
        style={{ color: tone ?? "var(--lime-deep)" }}
      />
      <span className="tnum text-[16px] font-extrabold leading-none">{value}</span>
      <span className="t-small text-muted">{label}</span>
    </div>
  );
}
