"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Search, TriangleAlert, UtensilsCrossed, X } from "lucide-react";
import { elapsed, inrShort } from "@/lib/bill";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";
import { setItemAvailabilityAction } from "@/app/org/channels/actions";
import { OnOff, tint } from "./ChannelDrawer";

export type ChannelOption = { channel: string; label: string };
export type ItemCategory = { id: string; name: string };

export type AvailabilityItem = {
  id: string;
  name: string;
  price: number;
  foodType: "veg" | "non_veg" | "egg";
  categoryId: string | null;
  /** menu_items.is_available — a separate axis to channels, edited under Menu Items. */
  onMenu: boolean;
  /**
   * Channels this item is off on right now, mapped to the moment it comes
   * back (null = indefinitely). Channels that are on are simply absent, so an
   * empty object is the common case and costs nothing to ship.
   */
  off: Record<string, string | null>;
};

const ALL = "all";

/**
 * Off-durations, exactly the reference's set.
 *
 * "Custom" is deliberately missing. A free-form datetime picker is a support
 * burden — wrong day, wrong AM/PM, off for a year by accident — and in every
 * real outage the answer is one of these six. If a manager truly needs an odd
 * window they pick Indefinite and switch it back on.
 */
const ITEM_DURATIONS: { id: string; label: string; hours: (nowMs: number) => number | null }[] = [
  { id: "2h", label: "2 Hours", hours: () => 2 },
  { id: "4h", label: "4 Hours", hours: () => 4 },
  { id: "8h", label: "8 Hours", hours: () => 8 },
  { id: "24h", label: "24 Hours", hours: () => 24 },
  {
    // 6am tomorrow, expressed as hours because that is the unit the ops layer
    // takes; it re-derives the timestamp server-side from the same offset.
    id: "nbd",
    label: "Next Business Day",
    hours: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(6, 0, 0, 0);
      return (d.getTime() - now) / 3_600_000;
    },
  },
  { id: "indefinite", label: "Indefinite", hours: () => null },
];

/**
 * "back on in 1 h 40 m".
 *
 * elapsed() measures a window backwards from its second argument, so handing
 * it `now` as the start and `off_until` as the clock reads the same window
 * forwards — and the countdown here is then spelled exactly like every other
 * duration in the app instead of drifting from it.
 */
function remaining(untilIso: string | null, now: number): string {
  if (!untilIso) return "Off indefinitely";
  return `back on in ${elapsed(new Date(now).toISOString(), new Date(untilIso).getTime())}`;
}

/** Off means present in the map and not already expired — the read rule, client side. */
function isOffOn(off: Record<string, string | null>, channel: string, now: number): boolean {
  if (!(channel in off)) return false;
  const until = off[channel];
  return until === null || new Date(until).getTime() > now;
}

export function ItemAvailability({
  channels,
  categories,
  items,
  now: serverNow,
}: {
  channels: ChannelOption[];
  categories: ItemCategory[];
  items: AvailabilityItem[];
  /** Rendered at server time so the first client paint matches; the ticker takes over. */
  now: number;
}) {
  const [scope, setScope] = useState<string>(ALL);
  const [catId, setCatId] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  // Only the rows this session has touched live here; everything else reads
  // straight off the server props, so a refresh never has to be merged back in.
  const [edits, setEdits] = useState<Map<string, Record<string, string | null>>>(() => new Map());
  const [sheet, setSheet] = useState<AvailabilityItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(serverNow);
  const [pending, start] = useTransition();

  // An item switched off for two hours has to come back on its own. The page
  // may also have been rendered minutes ago, so the first tick is immediate.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5_000);
    return () => clearTimeout(id);
  }, [error]);

  const scopeChannels = useMemo(
    () => (scope === ALL ? channels.map((c) => c.channel) : [scope]),
    [scope, channels],
  );

  // Optimistic edits shadow the server prop here rather than at the call
  // sites, so the header count, the rail badges and the row all read one
  // number and cannot disagree mid-flight.
  const offCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of items) {
      const off = edits.get(item.id) ?? item.off;
      m.set(item.id, scopeChannels.filter((ch) => isOffOn(off, ch, now)).length);
    }
    return m;
  }, [items, edits, scopeChannels, now]);

  const fullyOff = (id: string) => (offCounts.get(id) ?? 0) === scopeChannels.length && scopeChannels.length > 0;

  const offTotal = items.filter((i) => (offCounts.get(i.id) ?? 0) > 0).length;

  const catOffCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of items) {
      if ((offCounts.get(item.id) ?? 0) === 0) continue;
      const key = item.categoryId ?? "none";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [items, offCounts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (catId !== ALL && (i.categoryId ?? "none") !== catId) return false;
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, catId, query]);

  const scopeLabel = scope === ALL ? "all channels" : (channels.find((c) => c.channel === scope)?.label ?? scope);

  /**
   * Flip first, ask later.
   *
   * A manager clearing a sold-out section taps a dozen rows in a few seconds;
   * making each one wait on a round-trip turns that into a stutter and they
   * lose their place. The row moves now, and only a failure moves it back.
   *
   * `untilIso` is the same instant `hours` describes, resolved by whoever
   * handled the tap: the row has to draw a countdown before the server has
   * written one, and reading the clock in here would make the render impure.
   */
  function toggle(
    item: AvailabilityItem,
    on: boolean,
    hours: number | null,
    untilIso: string | null,
  ) {
    const previous = edits.get(item.id) ?? item.off;
    const next = { ...previous };

    for (const ch of scopeChannels) {
      if (on) delete next[ch];
      else next[ch] = untilIso;
    }

    setEdits((m) => new Map(m).set(item.id, next));
    setSheet(null);
    haptic(on ? "light" : "medium");

    start(async () => {
      const results = await Promise.all(
        scopeChannels.map((ch) => setItemAvailabilityAction(item.id, ch, on, hours)),
      );
      const failed = results.find((r) => !r.ok);
      // A partial failure across channels rolls the whole row back: there is no
      // honest way to draw "off on Swiggy, still on on Zomato because the write
      // fell over", and a stale row here is a dish that keeps getting sold.
      if (failed && !failed.ok) {
        setEdits((m) => new Map(m).set(item.id, previous));
        setError(failed.error);
      }
    });
  }

  const catName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <section className="dim rounded-[var(--r-xl)] p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-[12px]"
          style={{ background: "var(--lime)", color: "var(--lime-ink)" }}
        >
          <UtensilsCrossed size={17} strokeWidth={2.4} />
        </span>
        <div className="min-w-0">
          <h2 className="t-h3">Item availability</h2>
          <p className="t-small text-muted">
            Switch a dish off on one channel without touching the rest.
          </p>
        </div>
        <span
          className="tnum ml-auto rounded-full px-3 py-1 text-[12px] font-extrabold"
          style={tint(offTotal > 0 ? "danger" : "ok", 14)}
        >
          {/* Off on *any* in-scope channel: "3 items off" is the number a
              manager checks before service, and it must not quietly exclude a
              dish that is only dark on Swiggy. */}
          {scope === ALL
            ? `${offTotal} item${offTotal === 1 ? "" : "s"} off`
            : `${offTotal} off on ${scopeLabel}`}
        </span>
      </header>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="glass-inset flex h-10 items-center gap-2 rounded-[var(--r-md)] px-3 sm:w-[240px]">
          <Search size={15} strokeWidth={2.4} className="shrink-0 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an item"
            aria-label="Find an item by name"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold outline-none placeholder:text-muted"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                haptic("light");
                setQuery("");
              }}
              className="press text-muted"
            >
              <X size={14} strokeWidth={2.6} />
            </button>
          )}
        </div>

        <div className="rail -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5" role="group" aria-label="Channel">
          <Chip active={scope === ALL} onClick={() => setScope(ALL)}>
            All channels
          </Chip>
          {channels.map((c) => (
            <Chip key={c.channel} active={scope === c.channel} onClick={() => setScope(c.channel)}>
              {c.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[188px_1fr]">
        {/* A rail on a phone, a column on a desktop — same list, same order. */}
        <nav
          aria-label="Menu categories"
          className="rail -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0 lg:pb-0"
        >
          <Rail
            active={catId === ALL}
            count={offTotal}
            onClick={() => setCatId(ALL)}
            label="All items"
          />
          {categories.map((c) => (
            <Rail
              key={c.id}
              active={catId === c.id}
              count={catOffCounts.get(c.id) ?? 0}
              onClick={() => setCatId(c.id)}
              label={c.name}
            />
          ))}
        </nav>

        <div className="min-w-0">
          {visible.length === 0 ? (
            <p className="rounded-[var(--r-md)] border border-dashed border-[var(--line-strong)] px-5 py-10 text-center text-[13.5px] text-muted">
              {query ? `Nothing on the menu matches “${query.trim()}”.` : "No items in this section yet."}
            </p>
          ) : (
            <ul>
              {visible.map((item) => {
                const off = edits.get(item.id) ?? item.off;
                const offCount = offCounts.get(item.id) ?? 0;
                const allOff = fullyOff(item.id);
                const until = scope === ALL ? backOnAt(off, scopeChannels, now) : (off[scope] ?? null);

                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 border-b border-[var(--line)] py-2.5 last:border-b-0"
                  >
                    <span className={`food-mark food-mark-${item.foodType}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold leading-tight">{item.name}</p>
                      <p className="t-small truncate text-muted">
                        <span className="tnum">{inrShort(item.price)}</span>
                        {item.categoryId && catName.has(item.categoryId) && (
                          <> · {catName.get(item.categoryId)}</>
                        )}
                        {!item.onMenu && <> · hidden on the menu</>}
                      </p>
                    </div>

                    {allOff ? (
                      <span
                        className="hidden shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-extrabold sm:block"
                        style={tint("danger", 12)}
                      >
                        {remaining(until, now)}
                      </span>
                    ) : offCount > 0 ? (
                      // Mixed across channels: saying "On" alone would be a lie,
                      // so the row names the channels that are dark.
                      <span
                        className="hidden shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-extrabold sm:block"
                        style={tint("warn", 14)}
                      >
                        Off on {offChannelNames(off, scopeChannels, channels, now)}
                      </span>
                    ) : null}

                    <OnOff
                      size="sm"
                      on={!allOff}
                      label={item.name}
                      onChange={(next) => {
                        if (next) toggle(item, true, null, null);
                        else setSheet(item);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {sheet && (
        <ItemOffSheet
          item={sheet}
          scopeLabel={scopeLabel}
          onCancel={() => setSheet(null)}
          onPick={(hours, untilIso) => toggle(sheet, false, hours, untilIso)}
        />
      )}

      {error && (
        <p
          role="alert"
          className="fade-in mt-3 flex items-center gap-2 rounded-[var(--r-sm)] px-3 py-2 text-[13px] font-bold"
          style={tint("danger", 12)}
        >
          <TriangleAlert size={14} strokeWidth={2.5} />
          {error}
        </p>
      )}

      {pending && (
        <p className="t-small mt-2 text-muted" aria-live="polite">
          Saving…
        </p>
      )}
    </section>
  );
}

/**
 * When a row that is off everywhere is genuinely sellable again: the *last*
 * in-scope channel to return, not the first. One channel switched off
 * indefinitely makes the whole row indefinite — the pessimistic reading is the
 * only one that cannot promise a dish the kitchen still does not have.
 */
function backOnAt(
  off: Record<string, string | null>,
  scopeChannels: string[],
  now: number,
): string | null {
  let last: string | null = null;
  for (const ch of scopeChannels) {
    if (!isOffOn(off, ch, now)) continue;
    const until = off[ch];
    if (until === null) return null;
    if (!last || new Date(until).getTime() > new Date(last).getTime()) last = until;
  }
  return last;
}

function offChannelNames(
  off: Record<string, string | null>,
  scopeChannels: string[],
  channels: ChannelOption[],
  now: number,
): string {
  const label = new Map(channels.map((c) => [c.channel, c.label]));
  return scopeChannels
    .filter((ch) => isOffOn(off, ch, now))
    .map((ch) => label.get(ch) ?? ch)
    .join(", ");
}

// ---------------------------------------------------------------------------

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onPointerDown={() => haptic("light")}
      onClick={onClick}
      className={cn(
        "press h-9 shrink-0 rounded-[var(--r-md)] px-3.5 text-[13px] font-bold",
        active ? "raise-accent" : "glass-inset text-muted",
      )}
      style={active ? { background: "var(--lime)", color: "var(--lime-ink)" } : undefined}
    >
      {children}
    </button>
  );
}

function Rail({
  active,
  count,
  onClick,
  label,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onPointerDown={() => haptic("light")}
      onClick={onClick}
      className={cn(
        "press flex h-10 w-full shrink-0 items-center gap-2 rounded-[var(--r-md)] px-3 text-left text-[13px] font-bold",
        active ? "glass-solid text-ink" : "text-muted",
      )}
    >
      <span className="truncate lg:flex-1">{label}</span>
      {count > 0 && (
        <span
          className="tnum shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-extrabold"
          style={tint("danger", 14)}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ItemOffSheet({
  item,
  scopeLabel,
  onCancel,
  onPick,
}: {
  item: AvailabilityItem;
  scopeLabel: string;
  onCancel: () => void;
  /** The chosen window, both as the ops layer wants it and as the row must draw it. */
  onPick: (hours: number | null, untilIso: string | null) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Turn ${item.name} off`}
    >
      <button
        type="button"
        aria-label="Cancel"
        className="fade-in absolute inset-0 bg-black/55"
        onClick={onCancel}
      />
      <div className="sheet-up dim relative w-full max-w-[440px] rounded-t-[var(--r-xl)] p-5 sm:rounded-[var(--r-xl)]">
        <div className="flex items-start gap-3">
          <span className={`food-mark food-mark-${item.foodType} mt-1`} aria-hidden />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[16px] font-extrabold leading-tight">{item.name}</h3>
            <p className="t-small text-muted">Off on {scopeLabel} for how long?</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="press flex h-8 w-8 items-center justify-center rounded-full text-muted"
          >
            <X size={17} strokeWidth={2.6} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {ITEM_DURATIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              onPointerDown={() => haptic("medium")}
              onClick={() => {
                const now = Date.now();
                const hours = d.hours(now);
                onPick(hours, hours === null ? null : new Date(now + hours * 3_600_000).toISOString());
              }}
              className="glass-inset press flex h-12 items-center justify-center rounded-[var(--r-md)] px-3 text-center text-[13.5px] font-bold"
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
