import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { OsTeamName, PlatformRole } from "@/lib/platform-admin";

/**
 * The role dashboards from the Day 1 pack §4 — Master Admin, Growth, Sales
 * Manager and Sales Executive — plus the Customer Success dashboard from Day
 * 3 §5.
 *
 * They are one query shaped four ways rather than four screens, because the
 * PRD's own framing is that a dashboard answers a role's questions over
 * shared OS state; the questions differ, the state does not.
 */

export type Tile = { label: string; value: number | string; tone?: "ok" | "warn" | "danger"; hint?: string };
export type ListRow = { id: string; title: string; meta: string; href: string; late?: boolean };

export type Dashboard = {
  headline: string;
  question: string;
  tiles: Tile[];
  lists: { title: string; empty: string; rows: ListRow[] }[];
};

const DAY = 86_400_000;

async function growthNumbers(userId?: string) {
  const [leads, deals, payments, commissions] = await Promise.all([
    supabaseAdmin.from("leads").select("id, business_name, status, source, assigned_to, created_at, updated_at"),
    supabaseAdmin.from("deals").select("id, lead_id, status, quote_amount"),
    supabaseAdmin.from("deal_payments").select("deal_id, amount"),
    supabaseAdmin.from("commissions").select("partner_name, amount, status"),
  ]);

  const all = leads.data ?? [];
  const mine = userId ? all.filter((l) => l.assigned_to === userId) : all;
  const open = mine.filter((l) => ["new", "contacted", "qualified", "requirement", "demo", "proposal", "payment_pending"].includes(l.status as string));
  const stale = open.filter((l) => Date.now() - new Date(l.updated_at as string).getTime() > 3 * DAY);
  const won = (deals.data ?? []).filter((d) => d.status === "won");
  const pipeline = (deals.data ?? [])
    .filter((d) => d.status === "quoted")
    .reduce((s, d) => s + Number(d.quote_amount ?? 0), 0);
  const received = (payments.data ?? []).reduce((s, p) => s + Number(p.amount), 0);

  return { all, mine, open, stale, won, pipeline, received, commissions: commissions.data ?? [] };
}

async function workNumbers(team?: OsTeamName) {
  let q = supabaseAdmin
    .from("work_items")
    .select("id, title, team, status, due_at, organization_id")
    .in("status", ["open", "in_progress", "blocked"]);
  if (team && team !== "platform") q = q.eq("team", team);
  const { data } = await q;
  const rows = data ?? [];
  const overdue = rows.filter((w) => w.due_at && new Date(w.due_at as string).getTime() < Date.now());
  return { rows, overdue };
}

async function orgRows(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data } = await supabaseAdmin.from("organizations").select("id, name").in("id", ids);
  return new Map((data ?? []).map((o) => [o.id as string, o.name as string]));
}

function workList(rows: { id: string; title: string; due_at: string | null; organization_id: string | null }[], names: Map<string, string>) {
  return rows.slice(0, 8).map((w) => {
    const late = Boolean(w.due_at && new Date(w.due_at).getTime() < Date.now());
    const days = w.due_at ? Math.round((new Date(w.due_at).getTime() - Date.now()) / DAY) : null;
    return {
      id: w.id,
      title: w.title,
      meta:
        (w.organization_id ? (names.get(w.organization_id) ?? "—") : "—") +
        (days === null ? "" : late ? ` · ${Math.abs(days)}d overdue` : ` · due in ${days}d`),
      href: w.organization_id ? `/admin/organizations/${w.organization_id}` : "/admin/work",
      late,
    };
  });
}

export async function buildDashboard(
  role: PlatformRole,
  team: OsTeamName,
  userId: string,
  name: string,
): Promise<Dashboard> {
  const first = name.split(/[\s@]/)[0];

  // ---- Sales Executive — Day 1 §4 "Work today's leads, calls and follow-ups"
  if (role === "sales_executive" || role === "business_development") {
    const g = await growthNumbers(userId);
    const work = await workNumbers("sales");
    const names = await orgRows(work.rows.map((w) => w.organization_id).filter(Boolean) as string[]);
    return {
      headline: `${first}'s day`,
      question: "Who do I need to speak to, and who is waiting on me?",
      tiles: [
        { label: "My open leads", value: g.open.length },
        { label: "Untouched 3+ days", value: g.stale.length, tone: g.stale.length ? "warn" : undefined },
        { label: "Questions for me", value: work.rows.length, tone: work.rows.length ? "warn" : undefined },
        { label: "Referrals in play", value: g.open.filter((l) => l.source === "referral").length },
      ],
      lists: [
        {
          title: "Needs a follow-up",
          empty: "Nothing has gone quiet.",
          rows: g.stale.slice(0, 8).map((l) => ({
            id: l.id as string,
            title: l.business_name as string,
            meta: `${l.status} · untouched ${Math.floor((Date.now() - new Date(l.updated_at as string).getTime()) / DAY)}d`,
            href: "/admin/growth",
            late: true,
          })),
        },
        { title: "Owed by Sales", empty: "No questions outstanding.", rows: workList(work.rows, names) },
      ],
    };
  }

  // ---- Sales Manager — §4 "Manage team pipeline and assignments"
  if (role === "sales_manager" || role === "growth_admin") {
    const g = await growthNumbers();
    const unassigned = g.open.filter((l) => !l.assigned_to);
    return {
      headline: role === "growth_admin" ? "Growth" : `${first}'s pipeline`,
      question: "Where is the pipeline moving, and where has it stalled?",
      tiles: [
        { label: "Open leads", value: g.open.length },
        { label: "Unassigned", value: unassigned.length, tone: unassigned.length ? "warn" : undefined },
        { label: "Quoted value", value: `₹${g.pipeline.toLocaleString("en-IN")}` },
        { label: "Received", value: `₹${g.received.toLocaleString("en-IN")}`, tone: "ok" },
      ],
      lists: [
        {
          title: "Unassigned leads",
          empty: "Every lead has an owner.",
          rows: unassigned.slice(0, 8).map((l) => ({
            id: l.id as string,
            title: l.business_name as string,
            meta: `${l.source} · ${l.status}`,
            href: "/admin/growth",
            late: true,
          })),
        },
        {
          title: "Stalled 3+ days",
          empty: "Nothing is sitting still.",
          rows: g.stale.slice(0, 8).map((l) => ({
            id: l.id as string,
            title: l.business_name as string,
            meta: `${l.status} · owner ${l.assigned_to ? "assigned" : "none"}`,
            href: "/admin/growth",
          })),
        },
        {
          title: "Commissions",
          empty: "No partner commissions yet.",
          rows: g.commissions.slice(0, 6).map((c, i) => ({
            id: String(i),
            title: c.partner_name as string,
            meta: `${c.amount ? `₹${Number(c.amount).toLocaleString("en-IN")}` : "—"} · ${c.status}`,
            href: "/admin/growth",
          })),
        },
      ],
    };
  }

  // ---- Customer Success — Day 3 §5's five questions
  if (role === "customer_success") {
    const work = await workNumbers("customer_success");
    const names = await orgRows(work.rows.map((w) => w.organization_id).filter(Boolean) as string[]);
    const [{ data: reqs }, { data: fb }] = await Promise.all([
      supabaseAdmin.from("requirements").select("organization_id, status"),
      supabaseAdmin.from("feedback").select("organization_id, resolved"),
    ]);
    const unvalidated = (reqs ?? []).filter((r) => r.status === "captured" || r.status === "clarification_required").length;
    const openFb = (fb ?? []).filter((f) => !f.resolved).length;
    return {
      headline: `${first}'s customers`,
      question: "Which customers need me today, and which are blocked?",
      tiles: [
        { label: "Open work", value: work.rows.length },
        { label: "Overdue", value: work.overdue.length, tone: work.overdue.length ? "danger" : undefined },
        { label: "Unvalidated requirements", value: unvalidated, tone: unvalidated ? "warn" : undefined },
        { label: "Feedback to action", value: openFb, tone: openFb ? "warn" : undefined },
      ],
      lists: [
        { title: "Today's work", empty: "Nothing owed by Customer Success.", rows: workList(work.rows, names) },
      ],
    };
  }

  // ---- Operations
  if (role === "operations") {
    const work = await workNumbers("operations");
    const all = await workNumbers();
    const names = await orgRows(all.rows.map((w) => w.organization_id).filter(Boolean) as string[]);
    return {
      headline: `${first}'s desk`,
      question: "What is blocked, overdue, or about to go live?",
      tiles: [
        { label: "My open work", value: work.rows.length },
        { label: "Overdue anywhere", value: all.overdue.length, tone: all.overdue.length ? "danger" : undefined },
        { label: "Blocked", value: all.rows.filter((w) => w.status === "blocked").length, tone: "warn" },
        { label: "Open across teams", value: all.rows.length },
      ],
      lists: [
        { title: "Overdue, any team", empty: "Nothing is late.", rows: workList(all.overdue, names) },
        { title: "Mine", empty: "Nothing owed by Operations.", rows: workList(work.rows, names) },
      ],
    };
  }

  // ---- Onboarding
  if (role === "onboarding_admin") {
    const work = await workNumbers("onboarding");
    const names = await orgRows(work.rows.map((w) => w.organization_id).filter(Boolean) as string[]);
    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id, name, onboarding_stage")
      .not("onboarding_stage", "is", null);
    const fresh = (orgs ?? []).filter((o) => o.onboarding_stage === "new_handoff");
    return {
      headline: `${first}'s queue`,
      question: "Which organizations are waiting to be made real?",
      tiles: [
        { label: "My open work", value: work.rows.length },
        { label: "New handoffs", value: fresh.length, tone: fresh.length ? "warn" : undefined },
        { label: "Overdue", value: work.overdue.length, tone: work.overdue.length ? "danger" : undefined },
        { label: "Onboarding total", value: (orgs ?? []).length },
      ],
      lists: [
        { title: "Owed by Onboarding", empty: "Nothing waiting.", rows: workList(work.rows, names) },
        {
          title: "Just converted",
          empty: "No new handoffs.",
          rows: fresh.slice(0, 6).map((o) => ({
            id: o.id as string,
            title: o.name as string,
            meta: "new handoff · not yet verified",
            href: `/admin/organizations/${o.id}`,
          })),
        },
      ],
    };
  }

  // ---- Master Admin — §4 "See ecosystem health and cross-department activity"
  const g = await growthNumbers();
  const all = await workNumbers();
  const names = await orgRows(all.rows.map((w) => w.organization_id).filter(Boolean) as string[]);
  const [{ count: orgCount }, { data: stages }] = await Promise.all([
    supabaseAdmin.from("organizations").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("organizations").select("onboarding_stage").not("onboarding_stage", "is", null),
  ]);
  return {
    headline: "The platform",
    question: "Is the operating spine moving, and where is it stuck?",
    tiles: [
      { label: "Organizations", value: orgCount ?? 0 },
      { label: "Onboarding", value: (stages ?? []).length },
      { label: "Open work", value: all.rows.length },
      { label: "Overdue", value: all.overdue.length, tone: all.overdue.length ? "danger" : undefined },
      { label: "Open leads", value: g.open.length },
      { label: "Received", value: `₹${g.received.toLocaleString("en-IN")}`, tone: "ok" },
    ],
    lists: [
      { title: "Overdue across every team", empty: "Nothing is late anywhere.", rows: workList(all.overdue, names) },
      { title: "Open work, all teams", empty: "Every chain has run to the end.", rows: workList(all.rows, names) },
    ],
  };
}
