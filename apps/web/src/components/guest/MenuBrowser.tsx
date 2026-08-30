"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Info, List, Minus, Plus, Sparkles, Utensils, Wine, X } from "lucide-react";
import type { GuestCategory, GuestMenuItem, GuestVariant } from "@/lib/guest";
import { inr } from "@/lib/bill";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";
import { fromPrice, type CartLine } from "./types";

type Tab = "for_you" | "eat" | "drink";

const TABS: { id: Tab; label: string; icon: typeof Utensils }[] = [
  { id: "for_you", label: "For You", icon: Sparkles },
  { id: "eat", label: "Eat", icon: Utensils },
  { id: "drink", label: "Drink", icon: Wine },
];

export function MenuBrowser({
  categories,
  items,
  cart,
  onAdd,
  onStep,
  pin,
}: {
  categories: GuestCategory[];
  items: GuestMenuItem[];
  cart: Map<string, CartLine>;
  onAdd: (item: GuestMenuItem, variant: GuestVariant | null) => void;
  onStep: (key: string, delta: number) => void;
  pin: string;
}) {
  const [tab, setTab] = useState<Tab>("for_you");
  // Tracks which sections are CLOSED, not which are open.
  //
  // The other way round needs an empty set to mean "all open", and then the
  // first tap on any header — which adds that section to the set — silently
  // collapses every other section as a side effect. Storing the closed ones
  // makes the default state genuinely empty and every toggle independent.
  const [closedCats, setClosedCats] = useState<Set<string>>(new Set());
  const [jump, setJump] = useState(false);
  const [variantFor, setVariantFor] = useState<GuestMenuItem | null>(null);

  const visible = useMemo(
    () => (tab === "for_you" ? items.filter((i) => i.is_recommended) : items.filter((i) => i.course === tab)),
    [items, tab],
  );

  // For You is a flat shortlist — grouping a handful of recommendations under
  // their categories produced a page of headings each reading "(1)".
  const grouped = useMemo(() => {
    if (tab === "for_you") {
      return visible.length === 0
        ? []
        : [{ cat: { id: "for_you", name: "Recommended", sort_order: 0 }, items: visible }];
    }
    const byId = new Map(categories.map((c) => [c.id, c]));
    const out = new Map<string, { cat: GuestCategory; items: GuestMenuItem[] }>();
    for (const it of visible) {
      const cat = it.category_id ? byId.get(it.category_id) : undefined;
      const id = cat?.id ?? "uncategorised";
      const entry =
        out.get(id) ?? { cat: cat ?? { id, name: "More", sort_order: 999 }, items: [] };
      entry.items.push(it);
      out.set(id, entry);
    }
    return [...out.values()].sort((a, b) => a.cat.sort_order - b.cat.sort_order);
  }, [visible, categories, tab]);

  // Collapsed-by-default only once there are enough sections to make scrolling
  // a chore; a three-section menu should just be open.
  // One section is nothing to collapse; the chevrons only earn their place
  // once the menu is long enough to scroll.
  const collapsible = grouped.length > 1;
  const isOpen = (id: string) => !collapsible || !closedCats.has(id);

  function toggle(id: string) {
    haptic("light");
    setClosedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {/* Course tabs */}
      <div className="sticky top-[var(--guest-header-h,64px)] z-20 -mx-4 border-b border-[var(--line)] bg-[var(--canvas)]/95 px-4 backdrop-blur-md">
        <div className="grid grid-cols-3">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  haptic("light");
                  setTab(t.id);
                }}
                aria-pressed={active}
                className={cn(
                  "press relative flex flex-col items-center gap-1 py-2.5 text-[13px] font-bold transition-colors",
                  active ? "text-ink" : "text-muted",
                )}
              >
                <Icon size={17} strokeWidth={2.2} style={active ? { color: "var(--lime-deep)" } : undefined} />
                {t.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full"
                    style={{ background: "var(--lime-deep)" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "for_you" && (
        <div
          className="mt-4 flex items-center gap-3 rounded-[16px] px-4 py-3"
          style={{ background: "rgb(var(--shadow-color) / 0.05)" }}
        >
          <p className="text-[13px] font-semibold leading-snug text-ink-2">
            Share this PIN with anyone joining your table
          </p>
          <span
            className="tnum raise ml-auto shrink-0 rounded-[10px] px-3 py-1.5 text-[16px] font-extrabold"
            style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
          >
            {pin}
          </span>
        </div>
      )}

      <div className="mt-4 space-y-3 pb-4">
        {grouped.length === 0 && (
          <p className="py-16 text-center text-[14px] text-muted">
            Nothing here yet — try the other tabs.
          </p>
        )}

        {grouped.map(({ cat, items: list }) => {
          const open = isOpen(cat.id);
          return (
            <section
              key={cat.id}
              id={`cat-${cat.id}`}
              className="dim scroll-mt-32 overflow-hidden rounded-[var(--r-lg)]"
            >
              <button
                type="button"
                onClick={() => collapsible && toggle(cat.id)}
                aria-expanded={open}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-3.5 text-left",
                  collapsible && "press",
                )}
              >
                {collapsible && (
                  <ChevronDown
                    size={17}
                    strokeWidth={2.6}
                    className={cn("shrink-0 transition-transform", open && "rotate-180")}
                  />
                )}
                <h2 className="text-[16px] font-extrabold">{cat.name}</h2>
                <span className="tnum text-[14px] font-bold text-muted">({list.length})</span>
              </button>

              {open && (
                <ul>
                  {list.map((item) => (
                    <MenuRow
                      key={item.id}
                      item={item}
                      cart={cart}
                      onAdd={onAdd}
                      onStep={onStep}
                      onPickVariant={() => setVariantFor(item)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* Category jump — the reference's floating Menu button. */}
      {grouped.length > 3 && (
        <button
          type="button"
          onClick={() => {
            haptic("medium");
            setJump(true);
          }}
          className="press raise fixed bottom-[100px] right-4 z-20 flex items-center gap-2 rounded-[14px] px-4 py-3 text-[14px] font-extrabold"
          style={{ background: "#14170f", color: "#fff" }}
        >
          <List size={17} strokeWidth={2.6} />
          Menu
        </button>
      )}

      {jump && (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-label="Jump to a section">
          <button
            aria-label="Close"
            className="fade-in absolute inset-0 bg-black/55"
            onClick={() => setJump(false)}
          />
          <div className="sheet-up dim relative max-h-[70vh] w-full overflow-y-auto rounded-t-[26px] px-4 pb-8 pt-3">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--line-strong)]" />
            {grouped.map(({ cat, items: list }) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setClosedCats((prev) => {
                    const next = new Set(prev);
                    next.delete(cat.id);
                    return next;
                  });
                  setJump(false);
                  haptic("light");
                  document.getElementById(`cat-${cat.id}`)?.scrollIntoView({ behavior: "smooth" });
                }}
                className="press flex w-full items-center justify-between border-b border-[var(--line)] px-1 py-3.5 text-left text-[15px] font-bold last:border-0"
              >
                {cat.name}
                <span className="tnum text-[13px] font-semibold text-muted">{list.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {variantFor && (
        <VariantSheet
          item={variantFor}
          onClose={() => setVariantFor(null)}
          onPick={(v) => {
            onAdd(variantFor, v);
            setVariantFor(null);
          }}
        />
      )}
    </>
  );
}

function MenuRow({
  item,
  cart,
  onAdd,
  onStep,
  onPickVariant,
}: {
  item: GuestMenuItem;
  cart: Map<string, CartLine>;
  onAdd: (item: GuestMenuItem, variant: GuestVariant | null) => void;
  onStep: (key: string, delta: number) => void;
  onPickVariant: () => void;
}) {
  const [showDesc, setShowDesc] = useState(false);

  // How many of this dish are in the cart, across all its variants.
  const inCart = [...cart.values()].filter((l) => l.item.id === item.id);
  const qty = inCart.reduce((s, l) => s + l.qty, 0);
  const single = inCart.length === 1 ? inCart[0] : null;
  const hasVariants = item.variants.length > 0;

  return (
    <li id={`item-${item.id}`} className="border-t border-[var(--line)] px-4 py-3.5 first:border-t-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`food-mark food-mark-${item.food_type}`} aria-label={item.food_type.replace("_", "-")} />
            <h3 className="truncate text-[15px] font-bold leading-tight">{item.name}</h3>
            {item.description && (
              <button
                type="button"
                aria-label={`About ${item.name}`}
                onClick={() => setShowDesc((v) => !v)}
                className="press shrink-0 text-muted"
              >
                <Info size={13} strokeWidth={2.4} />
              </button>
            )}
          </div>

          {item.description && showDesc && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{item.description}</p>
          )}

          <p className="tnum mt-1.5 text-[14px] font-extrabold">
            {hasVariants && (
              <span className="mr-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                from
              </span>
            )}
            {inr(fromPrice(item))}
          </p>
          {hasVariants && (
            <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">
              {item.variants.map((v) => v.name).join(" · ")}
            </p>
          )}
        </div>

        <div className="shrink-0">
          {qty === 0 ? (
            <button
              type="button"
              onClick={() => {
                haptic("medium");
                if (hasVariants) onPickVariant();
                else onAdd(item, null);
              }}
              className="press raise-accent h-9 w-[78px] rounded-[11px] text-[13.5px] font-extrabold"
              style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
            >
              ADD
            </button>
          ) : (
            <div
              className="raise-accent flex h-9 w-[78px] items-center justify-between rounded-[11px] px-1"
              style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
            >
              <button
                type="button"
                aria-label={`Remove one ${item.name}`}
                onClick={() => {
                  haptic("light");
                  // With more than one variant in the cart the stepper is
                  // ambiguous, so it defers to the cart sheet instead of
                  // guessing which half the guest meant to drop.
                  if (single) onStep(single.key, -1);
                  else onPickVariant();
                }}
                className="press flex h-7 w-7 items-center justify-center"
              >
                <Minus size={14} strokeWidth={3} />
              </button>
              <span className="tnum text-[14px] font-extrabold">{qty}</span>
              <button
                type="button"
                aria-label={`Add one ${item.name}`}
                onClick={() => {
                  haptic("light");
                  if (single) onStep(single.key, 1);
                  else onPickVariant();
                }}
                className="press flex h-7 w-7 items-center justify-center"
              >
                <Plus size={14} strokeWidth={3} />
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function VariantSheet({
  item,
  onClose,
  onPick,
}: {
  item: GuestMenuItem;
  onClose: () => void;
  onPick: (v: GuestVariant) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-label={`Choose a size for ${item.name}`}>
      <button aria-label="Close" className="fade-in absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="sheet-up dim relative w-full rounded-t-[26px] px-4 pb-8 pt-3">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--line-strong)]" />
        <div className="flex items-center gap-2">
          <span className={`food-mark food-mark-${item.food_type}`} />
          <h3 className="text-[17px] font-extrabold">{item.name}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press ml-auto flex h-8 w-8 items-center justify-center rounded-full text-muted"
          >
            <X size={17} strokeWidth={2.6} />
          </button>
        </div>
        <p className="t-label mt-4 text-muted">Choose a size</p>
        <div className="mt-2 space-y-2">
          {item.variants.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                haptic("medium");
                onPick(v);
              }}
              className="press flex w-full items-center justify-between rounded-[14px] border border-[var(--line-strong)] px-4 py-3.5 text-left"
            >
              <span className="text-[15px] font-bold">{v.name}</span>
              <span className="tnum text-[15px] font-extrabold">{inr(v.price)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
