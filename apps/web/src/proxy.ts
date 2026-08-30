import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Edge-safe Supabase client for proxy.ts. @supabase/ssr's middleware pattern:
 * reads cookies off the incoming request, writes any refreshed session onto
 * the outgoing response so the browser stays in sync.
 */
function supabaseEdge(request: NextRequest, response: NextResponse) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  return createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tenant host resolution (control plane, migration 0007)
//
// Resolves the request Host to an organization and stamps x-org-id /
// x-org-slug request headers so downstream layouts and server components know
// which tenant they are rendering for — one codebase, many orgs.
//
// Implementation note: this deliberately does NOT import lib/tenant.ts.
// proxy.ts may run in the edge runtime where the server-only supabaseAdmin
// client is the wrong dependency to pull in, so resolution goes straight to
// PostgREST over fetch with the service key — the same lookups
// resolveHostToOrg() performs, kept in sync by hand:
//   1. <slug>.<PLATFORM_BASE_DOMAIN> → organizations.slug
//   2. anything else                 → org_domains.domain (any kind)
//
// The cache below is a tiny best-effort in-memory Map: edge/proxy instances
// do NOT share memory, so each instance warms its own; misses cost one REST
// round-trip. Entries expire after 60s and the map is capped to keep it tiny.
// ---------------------------------------------------------------------------

type TenantRef = { orgId: string; slug: string };

const TENANT_CACHE_TTL_MS = 60_000;
const TENANT_CACHE_MAX = 200;
const tenantCache = new Map<string, { value: TenantRef | null; expires: number }>();

function cacheGet(host: string): TenantRef | null | undefined {
  const hit = tenantCache.get(host);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    tenantCache.delete(host);
    return undefined;
  }
  return hit.value;
}

function cacheSet(host: string, value: TenantRef | null) {
  if (tenantCache.size >= TENANT_CACHE_MAX) tenantCache.clear();
  tenantCache.set(host, { value, expires: Date.now() + TENANT_CACHE_TTL_MS });
}

async function restLookup(path: string): Promise<unknown[] | null> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as unknown[];
}

/** Paths that are the platform's own and can never be an organization slug. */
const RESERVED = new Set([
  "admin", "org", "login", "logout", "api", "invite", "t", "_next", "favicon.ico", "brand",
]);

/**
 * Resolves a leading path segment to an organization.
 *
 * The host-based form (saffron.vinipos.com) only works once the domain points
 * at us, which it does not yet — so the same tenant selection is offered in
 * the path: /saffron-house/org/tables. Both funnel into the same x-org-id
 * header, so everything downstream, including the tenant mismatch guard, is
 * unchanged.
 */
async function resolveTenantSlug(slug: string): Promise<TenantRef | null> {
  if (!slug || RESERVED.has(slug) || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return null;

  const key = `slug:${slug}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const rows = await restLookup(`organizations?slug=eq.${encodeURIComponent(slug)}&select=id,slug`);
  const row = rows?.[0] as { id: string; slug: string } | undefined;
  const resolved = row ? { orgId: row.id, slug: row.slug } : null;
  cacheSet(key, resolved);
  return resolved;
}

async function resolveTenantHost(host: string): Promise<TenantRef | null> {
  const name = host.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (!name) return null;

  const cached = cacheGet(name);
  if (cached !== undefined) return cached;

  const base = (process.env.PLATFORM_BASE_DOMAIN ?? "vinipos.com").toLowerCase();
  let resolved: TenantRef | null = null;

  // Hosts that never belong to a tenant: the bare platform domain, localhost,
  // Vercel preview deployments.
  const isPlatformHost =
    name === base || name === `www.${base}` || name === "localhost" || name.endsWith(".vercel.app");

  if (!isPlatformHost) {
    if (name.endsWith(`.${base}`)) {
      // Platform subdomain: leftmost label is the organization slug.
      const slug = name.slice(0, name.length - base.length - 1);
      if (slug && !slug.includes(".")) {
        const rows = await restLookup(
          `organizations?slug=eq.${encodeURIComponent(slug)}&select=id,slug`,
        );
        const row = rows?.[0] as { id: string; slug: string } | undefined;
        if (row) resolved = { orgId: row.id, slug: row.slug };
      }
    } else {
      // Custom domain: exact match in org_domains.
      const rows = await restLookup(
        `org_domains?domain=eq.${encodeURIComponent(name)}&select=organizations!inner(id,slug)`,
      );
      const row = rows?.[0] as { organizations?: { id: string; slug: string } } | undefined;
      if (row?.organizations) resolved = { orgId: row.organizations.id, slug: row.organizations.slug };
    }
  }

  cacheSet(name, resolved);
  return resolved;
}

/**
 * Role is resolved here — not split between proxy and each layout — so
 * there's exactly one place that decides "signed in as what", and no risk of
 * proxy and a layout disagreeing and bouncing a user back and forth forever
 * (this app has hit that bug once already: an org admin sent to /admin,
 * blocked, sent to /login, which sent them back to /admin — infinite loop).
 */
async function resolveRole(
  request: NextRequest,
  response: NextResponse,
): Promise<"super_admin" | "org_admin" | null> {
  const supabase = supabaseEdge(request, response);
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");
  return isPlatformAdmin ? "super_admin" : "org_admin";
}

const HOME: Record<"super_admin" | "org_admin", string> = {
  super_admin: "/admin",
  org_admin: "/org",
};

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Tenant resolution is additive: it only stamps request headers. When the
  // host does not resolve to an organization (bare platform domain, unknown
  // host, localhost, preview deploys) nothing changes at all.
  const requestHeaders = new Headers(request.headers);

  // Path-based tenant selection: /<slug>/org/... is rewritten to /org/... with
  // the organization stamped on the request. This is what makes a link in a
  // handover document unambiguous about which restaurant it opens, and it is
  // also the only way a platform admin — who belongs to no organization — can
  // reach an org screen at all.
  const segments = pathname.split("/").filter(Boolean);
  const slugTenant = segments.length > 0 ? await resolveTenantSlug(segments[0]) : null;

  const tenant = slugTenant ?? (await resolveTenantHost(request.headers.get("host") ?? ""));
  if (tenant) {
    requestHeaders.set("x-org-id", tenant.orgId);
    requestHeaders.set("x-org-slug", tenant.slug);
  }

  if (slugTenant) {
    // /saffron-house → /org, /saffron-house/org/kds → /org/kds
    const rest = "/" + segments.slice(1).join("/");
    const target = new URL(rest === "/" ? "/org" : rest, request.url);
    target.search = search;
    return NextResponse.rewrite(target, { request: { headers: requestHeaders } });
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Role resolution stays scoped to the routes that were always gated — the
  // wider matcher above exists only to stamp tenant headers elsewhere, and
  // must not add an auth round-trip to every page.
  const isGated = pathname.startsWith("/admin") || pathname === "/login";
  const role = isGated ? await resolveRole(request, response) : null;

  if (pathname.startsWith("/admin") && role !== "super_admin") {
    // Signed in as something else (org admin) → their own home, not /login,
    // which would just bounce them straight back here.
    if (role) return NextResponse.redirect(new URL(HOME[role], request.url));

    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && role) {
    return NextResponse.redirect(new URL(HOME[role], request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Existing gated routes (unchanged behavior)…
    "/admin/:path*",
    "/login",
    // …plus every page route so tenant headers reach all server components.
    // Static assets, images and files are excluded — they carry no tenancy.
    "/((?!_next/static|_next/image|favicon.ico|brand|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
