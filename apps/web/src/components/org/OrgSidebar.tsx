"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Building2,
  ChefHat,
  ClipboardList,
  CreditCard,
  HeartHandshake,
  LayoutGrid,
  LifeBuoy,
  type LucideIcon,
  Menu,
  Monitor,
  Package,
  Plug,
  QrCode,
  Receipt,
  Settings,
  ShieldCheck,
  Smartphone,
  Table2,
  Truck,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { haptic } from "@/lib/haptics";

type Item = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Screens whose module hasn't been built yet still route — they show a Planned page. */
  ready?: boolean;
  /**
   * Module key from the registry (migration 0007). When the org has this
   * module disabled the entry disappears from the nav entirely — not badged,
   * genuinely absent. Items without a key are org administration, which is
   * never module-gated.
   */
  moduleKey?: string;
};

const SECTIONS: { heading: string | null; items: Item[] }[] = [
  {
    heading: null,
    items: [
      { href: "/org", label: "Overview", icon: LayoutGrid, ready: true, moduleKey: "dashboard" },
    ],
  },
  {
    heading: "Organization",
    items: [
      // Staff administration — gated on the `staff` module, which by default
      // only org_admin and manager may see. A captain has no business on the
      // user roster or the permission matrix.
      { href: "/org/users", label: "Users & Roles", icon: Users, ready: true, moduleKey: "staff" },
      { href: "/org/roles", label: "Permissions", icon: ShieldCheck, moduleKey: "staff" },
      { href: "/org/locations", label: "Locations", icon: Building2, moduleKey: "settings" },
    ],
  },
  {
    heading: "Service",
    items: [
      // Ordered the way a shift actually runs: the floor first, because that
      // is the screen a manager leaves open all night.
      { href: "/org/tables", label: "Floor", icon: Table2, ready: true, moduleKey: "orders" },
      { href: "/org/live", label: "Live Operations", icon: Activity, ready: true, moduleKey: "dashboard" },
      { href: "/org/captain", label: "Captain", icon: Smartphone, ready: true, moduleKey: "orders" },
      { href: "/org/kds", label: "Kitchen Display", icon: Monitor, ready: true, moduleKey: "kds_kot" },
      { href: "/org/kot", label: "Kitchen (KOT)", icon: ChefHat, ready: true, moduleKey: "kds_kot" },
      { href: "/org/pos", label: "POS Billing", icon: Receipt, ready: true, moduleKey: "pos" },
      { href: "/org/orders", label: "Order History", icon: ClipboardList, moduleKey: "orders" },
    ],
  },
  {
    heading: "Catalog & Channels",
    items: [
      { href: "/org/menu-items", label: "Menu Items", icon: UtensilsCrossed, ready: true, moduleKey: "menu" },
      { href: "/org/qr", label: "Table QR Codes", icon: QrCode, ready: true, moduleKey: "orders" },
      { href: "/org/channels", label: "Channels & Item On/Off", icon: Plug, ready: true, moduleKey: "settings" },
      { href: "/org/delivery", label: "Delivery", icon: Truck, moduleKey: "orders" },
    ],
  },
  {
    heading: "Business",
    items: [
      { href: "/org/inventory", label: "Inventory", icon: Package, moduleKey: "inventory" },
      { href: "/org/customers", label: "Customers & CRM", icon: HeartHandshake, moduleKey: "marketing_crm" },
      { href: "/org/payments", label: "Payments", icon: CreditCard, moduleKey: "finance" },
      { href: "/org/reports", label: "Reports", icon: BarChart3, moduleKey: "finance" },
    ],
  },
  {
    heading: null,
    items: [
      { href: "/org/settings", label: "Settings", icon: Settings, moduleKey: "settings" },
    ],
  },
];

function NavLink({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onPointerDown={() => haptic("light")}
      aria-current={active ? "page" : undefined}
      className={cn(
        "press group relative flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[13.5px] font-semibold transition-colors",
        active
          ? "bg-[rgb(180_238_42_/_0.16)] text-ink"
          : "text-muted hover:bg-[rgb(18_21_15_/_0.05)] hover:text-ink",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full"
          style={{ background: "var(--lime-deep)" }}
        />
      )}
      <Icon
        size={16}
        strokeWidth={2.1}
        className={cn("shrink-0", active && "text-[var(--lime-deep)]")}
      />
      <span className="truncate">{item.label}</span>
      {!item.ready && (
        <span
          className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide"
          style={{ background: "rgb(242 169 59 / 0.15)", color: "var(--warn)" }}
        >
          Soon
        </span>
      )}
    </Link>
  );
}

export function OrgSidebar({
  orgName,
  orgType,
  enabledModules,
}: {
  orgName: string;
  orgType: string;
  /**
   * Module keys this org may see. `null` means the control plane isn't
   * available (migration 0007 unapplied) — show everything rather than
   * blanking the nav.
   */
  enabledModules: string[] | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/org" ? pathname === "/org" : pathname.startsWith(href);

  const allowed = enabledModules === null ? null : new Set(enabledModules);
  const isVisible = (item: Item) =>
    !item.moduleKey || allowed === null || allowed.has(item.moduleKey);

  // Drop disabled entries, then drop any section left with nothing in it so
  // no orphan heading is rendered.
  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(isVisible),
  })).filter((section) => section.items.length > 0);

  const nav = (
    <>
      <div className="flex items-center gap-2.5 px-2 pb-5">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
          style={{
            background: "linear-gradient(180deg, var(--lime-bright), var(--lime-deep))",
            boxShadow: "0 6px 18px -6px rgb(121 188 13 / .6)",
          }}
        >
          <span className="text-[17px] font-extrabold text-[var(--lime-ink)]">V</span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-extrabold leading-tight">
            {orgName}
          </span>
          <span className="block truncate text-[11.5px] capitalize text-muted">
            {orgType} · Vini POS
          </span>
        </span>
      </div>

      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto pb-4">
        {sections.map((section, i) => (
          <div key={section.heading ?? `s${i}`}>
            {section.heading && (
              <div className="t-label mb-1.5 px-3 text-muted/70">
                {section.heading}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(item.href)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="glass-inset mt-auto flex items-center gap-2.5 rounded-[13px] px-3 py-2.5">
        <LifeBuoy size={15} className="shrink-0 text-muted" />
        <span className="min-w-0">
          <span className="block text-[12.5px] font-bold leading-tight">
            Need help?
          </span>
          <span className="block text-[11px] text-muted">Contact support</span>
        </span>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile trigger */}
      <button
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="press glass fixed left-4 top-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-[13px] lg:hidden"
      >
        <Menu size={18} className="relative z-10" />
      </button>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-[var(--line)] bg-[rgb(255_255_255_/_0.45)] px-3 py-4 backdrop-blur-xl lg:flex dark:bg-[rgb(255_255_255_/_0.03)]">
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="glass rise absolute inset-y-0 left-0 flex w-[268px] flex-col px-3 py-4">
            <button
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="press absolute right-3 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-[11px] text-muted hover:text-ink"
            >
              <X size={16} />
            </button>
            <div className="relative z-10 flex min-h-0 flex-1 flex-col">{nav}</div>
          </aside>
        </div>
      )}
    </>
  );
}
