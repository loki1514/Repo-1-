import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyOrg } from "@/lib/org";
import { listAreas, listFloor, listServiceRequests } from "@/lib/ops";
import { FloorView } from "@/components/org/floor/FloorView";

export const metadata: Metadata = { title: "Floor" };

/**
 * A board that people trust at a glance must never be served from a cache.
 * The layout is already dynamic (it reads the auth cookie), but saying so here
 * means a future static-optimization pass cannot quietly freeze the floor.
 */
export const dynamic = "force-dynamic";

/**
 * The request clock, kept out of the component body on purpose: a live board
 * legitimately reads wall-clock time once per request, and React's purity rule
 * rightly treats that read as impure inside a render function.
 */
function requestClock(): number {
  return Date.now();
}

export default async function FloorPage() {
  const org = await getMyOrg();
  if (!org) redirect("/login?next=/org/tables");

  const [areas, tables, requests] = await Promise.all([
    listAreas(org.id),
    listFloor(org.id),
    listServiceRequests(org.id),
  ]);

  return (
    <main className="pb-8">
      {/*
        The clock is handed down rather than read in the browser: server and
        first client render then agree on every "34 min", and the client takes
        over its own ticking after mount.
      */}
      <FloorView
        areas={areas}
        tables={tables}
        requests={requests}
        serverNow={requestClock()}
      />
    </main>
  );
}
