import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyOrg } from "@/lib/org";
import { listChannels } from "@/lib/ops";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ChannelDrawer, type StoreChannel } from "@/components/org/channels/ChannelDrawer";
import {
  ItemAvailability,
  type AvailabilityItem,
  type ChannelOption,
  type ItemCategory,
} from "@/components/org/channels/ItemAvailability";

export const metadata: Metadata = { title: "Channels & Item On/Off" };

// Availability is a function of the clock, so this page can never be cached.
export const dynamic = "force-dynamic";

/** Mirrors the gate in actions.ts — this one only decides what is worth rendering. */
const MANAGE_ROLES = new Set(["org_admin", "manager"]);

type CategoryRow = { id: string; name: string };
type ItemRow = {
  id: string;
  name: string;
  price: number | string;
  food_type: "veg" | "non_veg" | "egg";
  category_id: string | null;
  is_available: boolean;
};
type StatusRow = {
  menu_item_id: string;
  channel: string;
  is_available: boolean;
  off_until: string | null;
};

/**
 * The menu, with each item's live per-channel state folded in.
 *
 * Not in lib/ops.ts because nothing else needs it: this is the only screen
 * that reads item_channel_status, and the read rule below is a property of
 * this view rather than of the table.
 *
 * That rule: `off_until` in the past means the item is already back. The
 * column is a promise to reopen, and honouring it here is what lets the
 * schema get away with no sweeper job — so a stored `is_available = false`
 * with an expired timestamp must render as ON, not as off.
 *
 * The clock is read here and handed back with the data: the expiry test above
 * and the countdown the client ticks from must measure from the same instant,
 * or a row can read "back on in 0 min" while still drawn as off.
 */
async function readMenuAvailability(
  orgId: string,
): Promise<{ now: number; categories: ItemCategory[]; items: AvailabilityItem[] }> {
  const nowMs = Date.now();

  const [cats, items, statuses] = await Promise.all([
    supabaseAdmin
      .from("menu_categories")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("sort_order"),
    supabaseAdmin
      .from("menu_items")
      .select("id, name, price, food_type, category_id, is_available")
      .eq("organization_id", orgId)
      .order("sort_order"),
    supabaseAdmin
      .from("item_channel_status")
      .select("menu_item_id, channel, is_available, off_until")
      .eq("organization_id", orgId),
  ]);

  for (const r of [cats, items, statuses]) {
    if (r.error) throw new Error(`readMenuAvailability: ${r.error.message}`);
  }

  const offByItem = new Map<string, Record<string, string | null>>();
  for (const s of (statuses.data ?? []) as StatusRow[]) {
    if (s.is_available) continue;
    if (s.off_until && new Date(s.off_until).getTime() <= nowMs) continue;
    const entry = offByItem.get(s.menu_item_id) ?? {};
    entry[s.channel] = s.off_until;
    offByItem.set(s.menu_item_id, entry);
  }

  return {
    now: nowMs,
    categories: ((cats.data ?? []) as CategoryRow[]).map((c) => ({ id: c.id, name: c.name })),
    items: ((items.data ?? []) as ItemRow[]).map((i) => ({
      id: i.id,
      name: i.name,
      price: Number(i.price),
      foodType: i.food_type,
      categoryId: i.category_id,
      onMenu: i.is_available,
      off: offByItem.get(i.id) ?? {},
    })),
  };
}

export default async function ChannelsPage() {
  const org = await getMyOrg();
  if (!org) redirect("/login?next=/org/channels");
  if (!MANAGE_ROLES.has(org.myRole)) redirect("/org");

  const [channels, menu] = await Promise.all([
    listChannels(org.id),
    readMenuAvailability(org.id),
  ]);

  const stores: StoreChannel[] = channels.map((c) => ({
    id: c.id,
    channel: c.channel,
    displayName: c.display_name,
    connected: c.is_connected,
    accepting: c.is_accepting,
    nextOpenAt: c.next_open_at,
    commissionPct: c.commission_pct,
  }));

  const options: ChannelOption[] = channels.map((c) => ({
    channel: c.channel,
    label: c.display_name,
  }));

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="t-h1">Channels</h1>
        <p className="mt-1 text-[14.5px] text-muted">
          Aggregator store status and what {org.name} is selling on each channel right now.
        </p>
      </div>

      <ChannelDrawer channels={stores} />

      <ItemAvailability
        channels={options}
        categories={menu.categories}
        items={menu.items}
        now={menu.now}
      />
    </div>
  );
}
