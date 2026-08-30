"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import type { GuestCategory, GuestMenuItem, GuestVariant } from "@/lib/guest";
import { inr } from "@/lib/bill";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

/**
 * The captain's order pad.
 *
 * The cart shape lives here rather than in CaptainApp so the dependency runs
 * one way — the shell imports the pad, never the reverse.
 */
export type CartLine = {
  key: string;
  item: GuestMenuItem;
  variant: GuestVariant | null;
  qty: number;
};

/** Half and Full are two lines on the KOT, so they are two keys in the cart. */
export const lineKey = (itemId: string, variantId?: string | null) =>
  variantId ? `${itemId}:${variantId}` : itemId;

export const linePrice = (l: CartLine) => l.variant?.price ?? l.item.price;

/** What a dish "starts at" — the cheapest way it can be ordered. */
export function fromPrice(item: GuestMenuItem): number {
  if (item.variants.length === 0) return item.price;
  return Math.min(...item.variants.map((v) => v.price));
}

export function QuickMenu({
  categories,
  items,
  cart,
  onAdd,
  onStep,
}: {
  categories: GuestCategory[];
  items: GuestMenuItem[];
  cart: Map<string, CartLine>;
  onAdd: (item: GuestMenuItem, variant: GuestVariant | null) => void;
  onStep: (key: string, delta: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [variantFor, setVariantFor] = useState<GuestMenuItem | null>(null);

  const q = query.trim().toLowerCase();

  // A search deliberately escapes the category chip. A captain typing "cof"
  // wants the coffee, not to be told there is none in Starters.
  const visible = useMemo(() => {
    if (q) return items.filter((i) => i.name.toLowerCase().includes(q));
    return category === "all" ? items : items.filter((i) => i.category_id === category);
  }, [items, q, category]);

  // Headings survive filtering: on a 35-item menu the category is what tells a
  // captain at a glance whether the row they are about to tap is the starter
  // or the main with nearly the same name.
  const groups = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const out = new Map<string, { name: string; sort: number; rows: GuestMenuItem[] }>();
    for (const item of visible) {
      const cat = item.category_id ? byId.get(item.category_id) : undefined;
      const id = cat?.id ?? "more";
      const entry = out.get(id) ?? { name: cat?.name ?? "More", sort: cat?.sort_order ?? 999, rows: [] };
      entry.rows.push(item);
      out.set(id, entry);
    }
    return [...out.entries()]
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => a.sort - b.sort);
  }, [visible, categories]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of items) {
      if (!i.category_id) continue;
      map.set(i.category_id, (map.get(i.category_id) ?? 0) + 1);
    }
    return map;
  }, [items]);

  return (
    <>
      <div className="sticky top-0 z-20 -mx-1 bg-[var(--canvas)]/95 px-1 pb-2 pt-1 backdrop-blur-md">
        <div className="glass-inset flex h-12 items-center gap-2 rounded-[var(--r-md)] px-3">
          <Search size={17} strokeWidth={2.4} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the menu"
            aria-label="Search the menu"
            enterKeyHint="search"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-muted"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                haptic("light");
                setQuery("");
              }}
              className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted"
            >
              <X size={16} strokeWidth={2.6} />
            </button>
          )}
        </div>

        <div className="rail mt-2 flex gap-2 overflow-x-auto pb-1">
          <Chip
            label="All"
            count={items.length}
            active={category === "all" && !q}
            onPick={() => {
              setCategory("all");
              setQuery("");
            }}
          />
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              count={counts.get(c.id) ?? 0}
              active={category === c.id && !q}
              onPick={() => {
                setCategory(c.id);
                setQuery("");
              }}
            />
          ))}
        </div>
      </div>

      {groups.length === 0 && (
        <p className="py-20 text-center text-[14px] text-muted">
          Nothing on the menu matches {q ? `“${query}”` : "that section"}.
        </p>
      )}

      <div className="space-y-3 pb-4">
        {groups.map((g) => (
          <section key={g.id} className="dim overflow-hidden rounded-[var(--r-lg)]">
            <h2 className="t-label flex items-center gap-2 px-3.5 pb-1.5 pt-3 text-muted">
              {g.name}
              <span className="tnum font-bold">{g.rows.length}</span>
            </h2>
            <ul>
              {g.rows.map((item) => (
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
          </section>
        ))}
      </div>

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

function Chip({
  label,
  count,
  active,
  onPick,
}: {
  label: string;
  count: number;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        haptic("light");
        onPick();
      }}
      className={cn(
        "press flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--r-md)] px-3.5 text-[13.5px] font-bold",
        active ? "raise-accent" : "dim text-ink-2",
      )}
      style={active ? { background: "var(--lime)", color: "var(--lime-ink)" } : undefined}
    >
      {label}
      <span className="tnum text-[12px] opacity-70">{count}</span>
    </button>
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
  const inCart = [...cart.values()].filter((l) => l.item.id === item.id);
  const qty = inCart.reduce((s, l) => s + l.qty, 0);
  // Only an unambiguous single line can be stepped from the row; two sizes of
  // the same dish send the captain back to the sheet rather than guessing.
  const single = inCart.length === 1 ? inCart[0] : null;
  const hasVariants = item.variants.length > 0;

  function tap() {
    haptic("medium");
    if (hasVariants) onPickVariant();
    else onAdd(item, null);
  }

  return (
    <li className="flex items-stretch border-t border-[var(--line)]">
      <button
        type="button"
        onClick={tap}
        aria-label={`Add ${item.name}`}
        className="press flex min-h-[60px] flex-1 items-center gap-2.5 py-2.5 pl-3.5 pr-2 text-left"
      >
        <span
          className={`food-mark food-mark-${item.food_type}`}
          aria-label={item.food_type.replace("_", "-")}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold leading-tight">{item.name}</span>
          <span className="tnum mt-0.5 block truncate text-[12.5px] font-semibold text-muted">
            {hasVariants && "from "}
            {inr(fromPrice(item))}
            {hasVariants && ` · ${item.variants.map((v) => v.name).join(" / ")}`}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center pr-3">
        {qty === 0 ? (
          <button
            type="button"
            onClick={tap}
            aria-label={`Add ${item.name}`}
            className="press raise-accent h-12 w-[72px] rounded-[var(--r-md)] text-[14px] font-extrabold"
            style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
          >
            ADD
          </button>
        ) : (
          <div
            className="raise-accent flex h-12 w-[128px] items-center rounded-[var(--r-md)]"
            style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
          >
            <button
              type="button"
              aria-label={`One less ${item.name}`}
              onClick={() => {
                haptic("light");
                if (single) onStep(single.key, -1);
                else onPickVariant();
              }}
              className="press flex h-12 w-12 items-center justify-center rounded-l-[var(--r-md)]"
            >
              <Minus size={16} strokeWidth={3} />
            </button>
            <span className="tnum w-8 text-center text-[15px] font-extrabold">{qty}</span>
            <button
              type="button"
              aria-label={`One more ${item.name}`}
              onClick={() => {
                haptic("light");
                if (single) onStep(single.key, 1);
                else onPickVariant();
              }}
              className="press flex h-12 w-12 items-center justify-center rounded-r-[var(--r-md)]"
            >
              <Plus size={16} strokeWidth={3} />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Sizes, one tap each. Deliberately anchored to the bottom of the screen: the
 * captain is holding the phone in one hand and the choice has to land under
 * the thumb, not in the middle of the display.
 */
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
    <div
      className="fixed inset-0 z-50 flex items-end"
      role="dialog"
      aria-label={`Choose a size for ${item.name}`}
    >
      <button aria-label="Close" className="fade-in absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="sheet-up dim pb-safe relative w-full rounded-t-[var(--r-xl)] px-4 pb-5 pt-3">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--line-strong)]" />
        <div className="flex items-center gap-2">
          <span className={`food-mark food-mark-${item.food_type}`} />
          <h3 className="truncate text-[17px] font-extrabold">{item.name}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted"
          >
            <X size={18} strokeWidth={2.6} />
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {item.variants.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                haptic("medium");
                onPick(v);
              }}
              className="press dim flex h-14 w-full items-center justify-between rounded-[var(--r-md)] px-4 text-left"
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
