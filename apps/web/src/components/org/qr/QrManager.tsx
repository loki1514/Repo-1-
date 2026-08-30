"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";
import { regenerateTokenAction, type QrTable } from "@/app/org/qr/actions";

export type QrGroup = { id: string; name: string; tables: QrTable[] };

/**
 * A QR is an optical target, not chrome. Painting the modules in --ink means
 * a dark-themed manager prints white-on-white and a scanner sees nothing, so
 * the plate pins itself to the light end of the system palette: `color-scheme:
 * light` forces Canvas/CanvasText to resolve to paper and ink no matter what
 * the surrounding theme is doing. Token-free and hex-free by construction.
 */
const PLATE: React.CSSProperties = {
  colorScheme: "light",
  background: "Canvas",
  color: "CanvasText",
};

export function QrManager({
  groups,
  canManage,
}: {
  groups: QrGroup[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const q = query.trim().toLowerCase();
  const visible = groups
    .map((g) => ({
      ...g,
      tables: q
        ? g.tables.filter(
            (t) =>
              t.label.toLowerCase().includes(q) ||
              g.name.toLowerCase().includes(q) ||
              (t.token ?? "").includes(q),
          )
        : g.tables,
    }))
    .filter((g) => g.tables.length > 0);

  async function copyLink(table: QrTable) {
    if (!table.url) return;
    haptic("light");
    try {
      await navigator.clipboard.writeText(table.url);
      setCopiedId(table.id);
      window.setTimeout(
        () => setCopiedId((c) => (c === table.id ? null : c)),
        1600,
      );
    } catch {
      // Clipboard access needs a secure context; on plain http the link text
      // under the code is still selectable, so point at it rather than failing
      // silently.
      setToast("Clipboard blocked here — the link under the code is selectable.");
    }
  }

  function regenerate(table: QrTable) {
    haptic("heavy");
    setBusyId(table.id);
    start(async () => {
      const res = await regenerateTokenAction(table.id);
      setBusyId(null);
      setConfirmId(null);
      if (res.ok) {
        setToast(`${table.label} has a new code — reprint its sticker.`);
        router.refresh();
      } else {
        setToast(res.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <label className="dim flex h-11 items-center gap-2.5 rounded-[var(--r-md)] px-3.5 sm:max-w-sm">
        <Search size={15} strokeWidth={2.4} className="shrink-0 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a table or code…"
          aria-label="Filter tables"
          className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted/75"
        />
      </label>

      {visible.map((group) => (
        <section key={group.id} aria-labelledby={`area-${group.id}`}>
          <div className="mb-2.5 flex items-baseline gap-2 px-0.5">
            <h2 id={`area-${group.id}`} className="t-label text-muted">
              {group.name}
            </h2>
            <span className="tnum t-small text-muted/70">
              {group.tables.length}
            </span>
          </div>

          <ul className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3.5">
            {group.tables.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                canManage={canManage}
                copied={copiedId === table.id}
                confirming={confirmId === table.id}
                busy={busyId === table.id}
                onCopy={() => copyLink(table)}
                onAskConfirm={() => {
                  haptic("medium");
                  setConfirmId(table.id);
                }}
                onCancel={() => setConfirmId(null)}
                onConfirm={() => regenerate(table)}
              />
            ))}
          </ul>
        </section>
      ))}

      {visible.length === 0 && (
        <p className="dim rounded-[var(--r-lg)] px-4 py-10 text-center t-small text-muted">
          {groups.length === 0
            ? "No tables on the floor plan yet. Add them under Floor, then come back to print their codes."
            : `Nothing matches “${query}”.`}
        </p>
      )}

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4"
      >
        {toast && (
          <p className="glass fade-in max-w-sm rounded-[var(--r-md)] px-4 py-2.5 text-center text-[13.5px] font-semibold">
            <span className="relative z-10">{toast}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function TableCard({
  table,
  canManage,
  copied,
  confirming,
  busy,
  onCopy,
  onAskConfirm,
  onCancel,
  onConfirm,
}: {
  table: QrTable;
  canManage: boolean;
  copied: boolean;
  confirming: boolean;
  busy: boolean;
  onCopy: () => void;
  onAskConfirm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <li className="dim fade-in flex flex-col gap-3 rounded-[var(--r-lg)] p-3.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-[15.5px] font-extrabold leading-none">
          {table.label}
        </span>
        {!table.isActive && (
          <span className="glass-inset ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-muted">
            Off floor
          </span>
        )}
      </div>

      {table.svg ? (
        <div
          aria-hidden="true"
          className="mx-auto grid h-[150px] w-[150px] place-items-center rounded-[var(--r-md)] p-2 [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
          style={PLATE}
          dangerouslySetInnerHTML={{ __html: table.svg }}
        />
      ) : (
        <div className="glass-inset mx-auto grid h-[150px] w-[150px] place-items-center gap-1.5 rounded-[var(--r-md)] text-center">
          <QrCode size={26} strokeWidth={1.8} className="mx-auto text-muted" />
          <span className="t-small px-3 text-muted">No code yet</span>
        </div>
      )}

      <p className="tnum truncate text-center text-[12.5px] font-semibold text-muted">
        {table.token ? `/t/${table.token}` : "—"}
      </p>

      {confirming ? (
        <div
          className="rounded-[var(--r-md)] p-2.5"
          style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)" }}
        >
          <p className="flex gap-2 text-[12.5px] font-semibold leading-snug">
            <TriangleAlert
              size={15}
              strokeWidth={2.4}
              className="mt-px shrink-0"
              style={{ color: "var(--danger)" }}
            />
            <span>
              Any sticker already on {table.label} stops working. You will have
              to reprint it.
            </span>
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onPointerDown={() => haptic("light")}
              onClick={onCancel}
              className="press h-9 flex-1 rounded-[var(--r-sm)] text-[12.5px] font-bold text-ink-2 disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="press h-9 flex-1 rounded-[var(--r-sm)] text-[12.5px] font-bold disabled:opacity-45"
              style={{ background: "var(--danger)", color: "var(--canvas)" }}
            >
              {busy ? "Reissuing…" : "Regenerate"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {table.url && table.svg ? (
            <>
              <Mini
                label={copied ? "Copied" : "Copy link"}
                ariaLabel={
                  copied
                    ? `${table.label} link copied`
                    : `Copy the link for ${table.label}`
                }
                icon={copied ? Check : Copy}
                onClick={onCopy}
                weight="light"
              />
              <MiniLink
                label="Open"
                ariaLabel={`Open ${table.label}'s menu in a new tab`}
                icon={ExternalLink}
                href={table.url}
                target="_blank"
              />
              <MiniLink
                label="SVG"
                ariaLabel={`Download ${table.label}'s code as an SVG`}
                icon={Download}
                href={svgFileHref(table.svg)}
                download={`qr-${slug(table.label)}.svg`}
              />
              <Mini
                label="Regenerate"
                ariaLabel={`Reissue the code for ${table.label}`}
                icon={RefreshCw}
                onClick={onAskConfirm}
                weight="medium"
                disabled={!canManage}
                title={
                  canManage
                    ? "Issue a new code for this table"
                    : "Only an owner or manager can reissue a code"
                }
              />
            </>
          ) : (
            <button
              type="button"
              aria-label={`Generate a code for ${table.label}`}
              disabled={!canManage || busy}
              onPointerDown={() => haptic("medium")}
              onClick={onConfirm}
              className="press btn-lime col-span-2 inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--r-sm)] text-[12.5px] font-bold disabled:opacity-45"
            >
              <span className="relative z-10 inline-flex items-center gap-1.5">
                <QrCode size={14} strokeWidth={2.4} />
                {busy ? "Generating…" : "Generate"}
              </span>
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Compact action inside a card. Icon + word, so nothing relies on the icon alone. */
function Mini({
  label,
  ariaLabel,
  icon: Icon,
  onClick,
  weight,
  disabled,
  title,
}: {
  label: string;
  ariaLabel: string;
  icon: typeof Copy;
  onClick: () => void;
  weight: "light" | "medium";
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      title={title}
      onPointerDown={() => !disabled && haptic(weight)}
      onClick={onClick}
      className={cn(
        "press glass-inset inline-flex h-9 items-center justify-center gap-1.5",
        "rounded-[var(--r-sm)] text-[12.5px] font-bold text-ink-2",
        "hover:text-ink disabled:opacity-40",
      )}
    >
      <Icon size={14} strokeWidth={2.4} />
      {label}
    </button>
  );
}

function MiniLink({
  label,
  ariaLabel,
  icon: Icon,
  href,
  target,
  download,
}: {
  label: string;
  ariaLabel: string;
  icon: typeof Copy;
  href: string;
  target?: string;
  download?: string;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      target={target}
      rel={target === "_blank" ? "noreferrer" : undefined}
      download={download}
      onPointerDown={() => haptic("light")}
      className={cn(
        "press glass-inset inline-flex h-9 items-center justify-center gap-1.5",
        "rounded-[var(--r-sm)] text-[12.5px] font-bold text-ink-2 hover:text-ink",
      )}
    >
      <Icon size={14} strokeWidth={2.4} />
      {label}
    </a>
  );
}

/**
 * The download is built from the SVG the server already sent, so "save this
 * code" costs no round trip and works offline once the page is open.
 *
 * Width/height are stamped on for the download only: the inline copy is sized
 * by its plate, but a bare viewBox confuses print shops and design tools.
 * `currentColor` resolves to black in a standalone document, which is exactly
 * what a sticker printer wants.
 */
function svgFileHref(svg: string): string {
  const file = svg.replace("<svg ", '<svg width="512" height="512" ');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file)}`;
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "table";
}

// ---------------------------------------------------------------------------
// Print sheet helpers — the only client behaviour /org/qr/print needs.
// ---------------------------------------------------------------------------

/**
 * Opens the print dialog once the sheet has laid out.
 *
 * The ref guard — with no cleanup that cancels it — is deliberate: React's
 * StrictMode double-invokes effects in development, and a cleanup here would
 * cancel the only scheduled print before the second (early-returning) run.
 * Waiting on document.fonts stops the dialog capturing a half-styled sheet.
 */
export function AutoPrint() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const ready = document.fonts?.ready ?? Promise.resolve();
    void ready.then(() => {
      window.setTimeout(() => window.print(), 150);
    });
  }, []);

  return null;
}

/** Screen-only chrome above the sheet; `.no-print` drops it from the paper. */
export function PrintBar({ count }: { count: number }) {
  return (
    <div className="no-print mb-5 flex flex-wrap items-center gap-2.5">
      <Link
        href="/org/qr"
        onPointerDown={() => haptic("light")}
        className="press glass inline-flex h-10 items-center gap-1.5 rounded-[var(--r-md)] px-3.5 text-[13.5px] font-bold"
      >
        <span className="relative z-10 inline-flex items-center gap-1.5">
          <ArrowLeft size={15} strokeWidth={2.4} />
          Back
        </span>
      </Link>

      <p className="tnum t-small text-muted">
        {count} sticker{count === 1 ? "" : "s"} · 6 per A4 page
      </p>

      <button
        type="button"
        onPointerDown={() => haptic("medium")}
        onClick={() => window.print()}
        className="press btn-lime ml-auto inline-flex h-10 items-center gap-1.5 rounded-[var(--r-md)] px-4 text-[13.5px] font-bold"
      >
        <span className="relative z-10 inline-flex items-center gap-1.5">
          <Printer size={15} strokeWidth={2.4} />
          Print
        </span>
      </button>
    </div>
  );
}
