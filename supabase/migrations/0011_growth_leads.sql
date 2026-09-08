-- ============================================================================
-- 0011 — Growth: leads (touchpoints 1-2 only)
--
-- The first two links in the chain every source document describes: a lead
-- exists, attributed to where it came from (docs/os claude .txt:429-436,
-- docs/os vaishnavi gpt.txt:101-127, docs/Gpt.txt:410-427), and a named person
-- engages it (os claude .txt:438-448, os vaishnavi gpt.txt:130-169,
-- Gpt.txt:430-455).
--
-- Deliberately NOT in the org-scoped module registry (0007's modules /
-- org_modules / role_module_access): every row there is switched on BY an
-- organization, and a lead has no organization yet — it produces one, later,
-- at touchpoint 4 (os claude .txt:477-489, Gpt.txt:480-497). This is a new
-- Console section instead, gated the way every other platform-only screen
-- already is (requirePlatformAdmin() / is_platform_admin()).
-- ============================================================================

create type public.lead_source as enum ('cold', 'referral', 'affiliate', 'reseller', 'inbound');

comment on type public.lead_source is
  'How a lead entered the funnel. Growth/Sales taxonomy — docs/user roles .txt:19-24.';

create type public.lead_status as enum ('new', 'contacted', 'qualified', 'disqualified');

comment on type public.lead_status is
  'Touchpoint 1-2 only. qualified is where this migration''s scope ends — scoping, commercials,
   payment and organization creation (touchpoints 3-4) are a later phase.';

create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  business_name   text not null,
  contact_name    text,
  contact_phone   text,
  source          public.lead_source not null default 'cold',
  referrer_name   text,
  assigned_to     uuid references auth.users (id) on delete set null,
  status          public.lead_status not null default 'new',
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint leads_business_name_not_blank check (length(btrim(business_name)) > 0),
  constraint leads_referrer_requires_source check (
    referrer_name is null or source in ('referral', 'affiliate', 'reseller')
  )
);

comment on table public.leads is
  'Touchpoint 1-2: a prospective merchant, attributed the instant it exists, assigned to a named
   person, moved through new -> contacted -> qualified -> disqualified.';

-- Sorted queue is the whole UI: newest-first within a status.
create index leads_status_idx on public.leads (status, created_at desc);
create index leads_assigned_to_idx on public.leads (assigned_to);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

-- Platform-only surface — no organization scope exists yet to check against.
create policy leads_platform_admin_all
  on public.leads for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, insert, update on public.leads to authenticated;
grant all privileges on public.leads to service_role;

-- ----------------------------------------------------------------------------
-- Status history — the auditable handoff every document insists on.
-- ----------------------------------------------------------------------------

create table public.lead_events (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  from_status public.lead_status,
  to_status   public.lead_status not null,
  note        text,
  actor       uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.lead_events is
  'One row per status change. Append-only — a lead''s history is never edited, only added to.';

create index lead_events_lead_id_idx on public.lead_events (lead_id, created_at);

alter table public.lead_events enable row level security;

create policy lead_events_platform_admin_all
  on public.lead_events for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, insert on public.lead_events to authenticated;
grant all privileges on public.lead_events to service_role;
