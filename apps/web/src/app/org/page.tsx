import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ChefHat,
  ClipboardList,
  IndianRupee,
  QrCode,
  Receipt,
  Table2,
  Users,
} from "lucide-react";
import { getMyOrg } from "@/lib/org";
import { getEnabledModuleKeys } from "@/lib/org-modules";
import { listFloor, liveSnapshot } from "@/lib/ops";
import { inrShort, inr } from "@/lib/bill";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

/**
 * The org landing page.
 *
 * Deliberately a summary with exits, not a dashboard: the live board, the
 * floor and the kitchen each have a screen built for standing in front of.
 * This page's job is to say what shape the service is in and get the user to
 * the right one in a single tap.
 */
export default async function OrgOverview() {
  const org = await getMyOrg();
  if (!org) return null;

  const [snap, floor, enabled] = await Promise.all([
    liveSnapshot(org.id),
    listFloor(org.id),
    getEnabledModuleKeys(org.id, org.myRole),
  ]);

  const can = (key: string) => enabled === null || enabled.has(key);
  const busy = floor.filter((t) => t.state !== "blank");
  const needsRunning = floor.filter((t) => t.readyItems > 0);

  return (
    <div className="space-y-5 py-5">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="t-h1">{org.name}</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            {busy.length > 0
              ? `${busy.length} table${busy.length === 1 ? "" : "s"} in service right now.`
              : "Nothing in service — a quiet moment."}
          </p>
        </div>
        <span
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold capitalize"
          style={{ background: "color-mix(in srgb, var(--lime) 18%, transparent)", color: "var(--lime-deep)" }}
        >
          {org.type} · {org.myRole.replace("_", " ")}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={IndianRupee} label="Today's sales" value={inrShort(snap.salesToday)} hint={`${snap.ordersToday} orders`} />
        <Tile icon={Users} label="Covers" value={String(snap.covers)} hint={`Avg bill ${inrShort(snap.averageBill)}`} />
        <Tile icon={Table2} label="Tables in use" value={`${snap.tablesOccupied} of ${snap.tablesTotal}`} hint="Occupied now" />
        <Tile
          icon={ChefHat}
          label="On the pass"
          value={String(snap.ready)}
          hint={snap.ready > 0 ? "Waiting to be run" : "Kitchen is clear"}
          alert={snap.ready > 0}
        />
      </div>

      {needsRunning.length > 0 && (
        <Link
          href="/org/tables"
          className="press glass flex items-center gap-3 rounded-[var(--r-lg)] p-4"
        >
          <span className="relative z-10 flex items-center gap-3">
            <ChefHat size={18} style={{ color: "var(--ok)" }} strokeWidth={2.4} />
            <span className="text-[14px] font-bold">
              Food ready on {needsRunning.map((t) => t.label).join(", ")}
            </span>
          </span>
          <ArrowRight size={16} className="relative z-10 ml-auto text-muted" />
        </Link>
      )}

      <section className="glass rounded-[var(--r-xl)] p-5">
        <div className="relative z-10">
          <div className="flex items-center gap-2.5">
            <Receipt size={16} style={{ color: "var(--lime-deep)" }} />
            <h2 className="t-h3">Open tables</h2>
            <Link href="/org/tables" className="press ml-auto text-[13px] font-bold text-muted hover:text-ink">
              Floor view →
            </Link>
          </div>

          {busy.length === 0 ? (
            <p className="mt-4 rounded-[14px] border border-dashed border-[var(--line-strong)] px-5 py-8 text-center text-[13.5px] text-muted">
              No open bills. Seat a table or scan a QR to start one.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {busy.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <span className="tnum w-14 shrink-0 text-[14px] font-extrabold">{t.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                    {t.areaName} · {t.itemCount} item{t.itemCount === 1 ? "" : "s"}
                    {t.guestCount > 0 && ` · ${t.guestCount} covers`}
                  </span>
                  <span className="tnum shrink-0 text-[14px] font-extrabold">{inr(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {can("dashboard") && (
          <Quick href="/org/live" icon={Activity} title="Live operations" blurb="Ball-by-ball view of the whole service." />
        )}
        {can("kds_kot") && (
          <Quick href="/org/kds" icon={ChefHat} title="Kitchen display" blurb="What the pass is cooking right now." />
        )}
        {can("orders") && (
          <Quick href="/org/qr" icon={QrCode} title="Table QR codes" blurb="Print the stickers guests scan to order." />
        )}
      </div>
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  hint,
  alert,
}: {
  icon: typeof IndianRupee;
  label: string;
  value: string;
  hint: string;
  alert?: boolean;
}) {
  return (
    <div className="glass rounded-[var(--r-lg)] p-4">
      <div className="relative z-10">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-[12px]"
          // The tile used a hardcoded near-black with a --lime glyph. Under a
          // themed org --lime is that org's accent, so a red restaurant got
          // dark red on near-black and three of four icons vanished. Painting
          // the tile in the accent and the glyph in --lime-ink borrows the
          // contrast solver in lib/theme.ts, which guarantees 3.05:1 for any
          // accent the picker can produce.
          style={{
            background: alert ? "var(--ok)" : "var(--lime)",
            color: alert ? "#0b1a0f" : "var(--lime-ink)",
          }}
        >
          <Icon size={16} />
        </span>
        <p className="tnum mt-3 text-[26px] font-extrabold leading-none tracking-tight">{value}</p>
        <p className="mt-1.5 text-[13px] font-bold">{label}</p>
        <p className="t-small text-muted">{hint}</p>
      </div>
    </div>
  );
}

function Quick({
  href,
  icon: Icon,
  title,
  blurb,
}: {
  href: string;
  icon: typeof IndianRupee;
  title: string;
  blurb: string;
}) {
  return (
    <Link href={href} className="press glass rounded-[var(--r-lg)] p-4">
      <div className="relative z-10">
        <Icon size={17} style={{ color: "var(--lime-deep)" }} strokeWidth={2.3} />
        <p className="mt-2.5 text-[14px] font-extrabold">{title}</p>
        <p className="t-small mt-0.5 text-muted">{blurb}</p>
      </div>
    </Link>
  );
}
