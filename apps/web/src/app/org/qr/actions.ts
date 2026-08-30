"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { getMyOrg } from "@/lib/org";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * The QR sticker layer: read the floor plan, draw the codes, mint new tokens.
 *
 * Everything here re-derives the org from the session — no caller may name the
 * organization it wants. Drawing lives here too rather than in the pages,
 * because `qrcode` is a Node library: keeping the only import in one server
 * module is what guarantees it never leaks into a client bundle.
 */

export type QrArea = { id: string; name: string };

export type QrTable = {
  id: string;
  label: string;
  areaId: string | null;
  areaName: string;
  token: string | null;
  /** Absolute `/t/<token>` URL — null until the table has a token. */
  url: string | null;
  /** Inline, theme-agnostic SVG. Null when there is nothing to encode. */
  svg: string | null;
  isActive: boolean;
};

export type QrFloor = {
  orgName: string;
  /** Whether the signed-in role may mint tokens, decided server-side. */
  canManage: boolean;
  areas: QrArea[];
  tables: QrTable[];
};

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Reissuing a code invalidates printed stickers, so it sits with the people
 * who own the floor plan. Billers and captains can still read this screen.
 */
const QR_MANAGER_ROLES = new Set(["org_admin", "manager"]);

type TableRow = {
  id: string;
  label: string;
  area_id: string | null;
  qr_token: string | null;
  is_active: boolean;
};

type AreaRow = { id: string; name: string };

/**
 * A token is 40 bits of randomness, not the table's id or number.
 *
 * `/t/<token>` is reached by a guest with no session and no PIN, so the token
 * is the only thing standing between a stranger and the ability to order. A
 * sequential or id-derived value would let anyone who scanned table 4 edit the
 * URL and put food on table 5's bill.
 *
 * Shape matches the seed and `resolveQrToken`'s /^[a-z0-9]{6,32}$/ guard.
 */
function freshToken(): string {
  return randomBytes(8).toString("hex").slice(0, 10);
}

/**
 * The host the restaurant is actually being served on.
 *
 * A sticker is printed once and lives on the table for a year. Baking
 * localhost — or a build-time env var that was right on the day of the deploy
 * — into it is a permanent, un-fixable bug, so the origin is read off the
 * request that is asking for the sheet.
 */
async function publicOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * `qrcode` paints #ffffff plate + #000000 modules. Handing the modules
 * `currentColor` and dropping the plate lets one string serve the light UI,
 * the dark UI and the printer — whatever wraps it decides the ink.
 */
function themable(svg: string): string {
  return svg
    .replace(/fill="#ffffff"/g, 'fill="none"')
    .replace(/stroke="#000000"/g, 'stroke="currentColor"');
}

async function draw(url: string): Promise<string> {
  // Level M survives a smudged or partly-covered sticker; margin 1 keeps the
  // quiet zone the spec requires without wasting sticker area.
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
  return themable(svg);
}

/**
 * Every table on the floor plan with its code already rendered.
 *
 * Inactive tables are included on purpose: a table taken out of service still
 * has a sticker on it, and the manager needs to see that code exists before
 * deciding what to do with it.
 *
 * Null rather than a throw when there is no session: the App Router renders a
 * page in parallel with the layout that guards it, so a signed-out request
 * reaches this before the layout's redirect lands. Throwing there would log a
 * server error on every ordinary bounce to /login.
 */
export async function listQrTables(): Promise<QrFloor | null> {
  const org = await getMyOrg();
  if (!org) return null;

  const [areas, tables] = await Promise.all([
    supabaseAdmin
      .from("dining_areas")
      .select("id, name, sort_order")
      .eq("organization_id", org.id)
      .order("sort_order"),
    supabaseAdmin
      .from("dining_tables")
      .select("id, label, area_id, qr_token, is_active, sort_order")
      .eq("organization_id", org.id)
      .order("sort_order"),
  ]);

  if (areas.error) throw new Error(`listQrTables (areas): ${areas.error.message}`);
  if (tables.error) throw new Error(`listQrTables (tables): ${tables.error.message}`);

  const areaRows = (areas.data ?? []) as AreaRow[];
  const tableRows = (tables.data ?? []) as TableRow[];
  const origin = await publicOrigin();
  const areaName = new Map(areaRows.map((a) => [a.id, a.name]));

  const built = await Promise.all(
    tableRows.map(async (t) => {
      const url = t.qr_token ? `${origin}/t/${t.qr_token}` : null;
      return {
        id: t.id,
        label: t.label,
        areaId: t.area_id,
        areaName: (t.area_id ? areaName.get(t.area_id) : null) ?? "Unassigned",
        token: t.qr_token,
        url,
        svg: url ? await draw(url) : null,
        isActive: t.is_active,
      };
    }),
  );

  return {
    orgName: org.name,
    canManage: QR_MANAGER_ROLES.has(org.myRole),
    areas: areaRows.map((a) => ({ id: a.id, name: a.name })),
    tables: built,
  };
}

/**
 * Mints a new token for one table. Destructive: the sticker currently on that
 * table stops resolving the moment this returns.
 */
export async function regenerateTokenAction(tableId: string): Promise<ActionResult> {
  try {
    const org = await getMyOrg();
    if (!org) return { ok: false, error: "No organization." };
    if (!QR_MANAGER_ROLES.has(org.myRole)) {
      return { ok: false, error: "Only an owner or manager can reissue a table code." };
    }

    // qr_token is globally unique across tenants, so a fresh draw can collide
    // with another org's. Redrawing on 23505 is cheaper and simpler than
    // holding a transaction open to check first.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await supabaseAdmin
        .from("dining_tables")
        .update({ qr_token: freshToken() })
        .eq("id", tableId)
        // The tenancy check *is* this predicate: a table belonging to another
        // org matches nothing and updates nothing.
        .eq("organization_id", org.id)
        .select("id")
        .maybeSingle();

      if (error) {
        if (error.code === "23505") continue;
        return { ok: false, error: `Could not reissue the code: ${error.message}` };
      }
      if (!data) return { ok: false, error: "That table is not on your floor plan." };

      revalidatePath("/org/qr");
      revalidatePath("/org/qr/print");
      return { ok: true };
    }

    return { ok: false, error: "Could not mint a unique code. Try again." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}
