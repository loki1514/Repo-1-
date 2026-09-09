-- ============================================================================
-- 0020 — Completing Day 3: Customer Success
--
--   §7   Discovery session — validating how the customer actually works
--   §9   Demo planning generated from confirmed requirements, not a feature list
--   §10  Feedback captured on the screen it was said about, with a disposition
--   §11  Training: who was trained, on what, and whether they completed it
--   §12  Readiness: is this customer actually ready for the next stage
--   Day 1 §10/§12  Bot runs, attributable and human-approved
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §7 — Discovery sessions
-- ----------------------------------------------------------------------------
create table public.discovery_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  objective       text not null,
  participants    text,
  scheduled_for   timestamptz,
  held_at         timestamptz,
  decisions       text,
  open_questions  text,
  customer_confirmed boolean not null default false,
  owner           uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint discovery_objective_not_blank check (length(btrim(objective)) > 0)
);

create index discovery_org_idx on public.discovery_sessions (organization_id, created_at desc);
create trigger discovery_set_updated_at before update on public.discovery_sessions
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- §9 — The demo plan, built from requirements
--
-- "The demo should be generated from the customer's requirements, not from a
-- generic feature checklist." Each item points at the requirement it proves.
-- ----------------------------------------------------------------------------
create table public.demo_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scheduled_for   timestamptz,
  participants    text,
  held_at         timestamptz,
  owner           uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index demo_plans_org_idx on public.demo_plans (organization_id);
create trigger demo_plans_set_updated_at before update on public.demo_plans
  for each row execute function public.set_updated_at();

create table public.demo_plan_items (
  id             uuid primary key default gen_random_uuid(),
  demo_plan_id   uuid not null references public.demo_plans (id) on delete cascade,
  requirement_id uuid references public.requirements (id) on delete set null,
  title          text not null,
  screen         text,
  success_criteria text,
  position       integer not null default 0,
  covered        boolean not null default false,
  created_at     timestamptz not null default now()
);

create index demo_plan_items_plan_idx on public.demo_plan_items (demo_plan_id, position);

-- ----------------------------------------------------------------------------
-- §10 — Feedback, with the disposition that decides who acts on it
-- ----------------------------------------------------------------------------
create type public.feedback_disposition as enum (
  'configuration', 'training', 'process_change', 'product_gap', 'development_issue', 'accepted', 'deferred'
);

create table public.feedback (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  demo_plan_id    uuid references public.demo_plans (id) on delete set null,
  requirement_id  uuid references public.requirements (id) on delete set null,
  body            text not null,
  said_by         text,
  screen          text,
  disposition     public.feedback_disposition,
  resolved        boolean not null default false,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint feedback_body_not_blank check (length(btrim(body)) > 0)
);

create index feedback_org_idx on public.feedback (organization_id, created_at desc);
create trigger feedback_set_updated_at before update on public.feedback
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- §11 — Training: people, topics, completion
-- ----------------------------------------------------------------------------
create table public.training_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  person_name     text not null,
  role_label      text,
  topics          text,
  completed       boolean not null default false,
  completed_at    timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index training_org_idx on public.training_records (organization_id);

-- ----------------------------------------------------------------------------
-- §12 — Readiness. A fixed checklist so "ready" means the same thing twice.
-- ----------------------------------------------------------------------------
create table public.readiness_checks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  item            text not null,
  passed          boolean not null default false,
  note            text,
  checked_by      uuid references auth.users (id) on delete set null,
  checked_at      timestamptz,
  position        integer not null default 0,
  created_at      timestamptz not null default now()
);

create unique index readiness_org_item_idx on public.readiness_checks (organization_id, item);

-- Seeded for every organization that reaches readiness. The list is the one
-- the storyline names: data isolation, audit trail, GST fields, plus the
-- operating basics a first service needs.
create or replace function public.seed_readiness(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_items text[] := array[
    'Data isolation verified for this tenant',
    'Audit trail switched on',
    'GST fields present and correct',
    'At least one location configured',
    'Owner and organization admin can sign in',
    'Menu or catalogue loaded',
    'Live-operations watch set for the first service'
  ];
  v_i integer;
begin
  for v_i in 1 .. array_length(v_items, 1) loop
    insert into public.readiness_checks (organization_id, item, position)
    values (p_org, v_items[v_i], v_i)
    on conflict (organization_id, item) do nothing;
  end loop;
  return array_length(v_items, 1);
end;
$$;

-- ----------------------------------------------------------------------------
-- Day 1 §10 — bot runs. "Keep every bot action attributable: bot identity,
-- initiating user, source context, model/version, action, timestamp, outcome."
-- ----------------------------------------------------------------------------
create type public.bot_run_status as enum ('draft', 'approved', 'rejected');

create table public.bot_runs (
  id               uuid primary key default gen_random_uuid(),
  bot              text not null,
  model            text not null,
  organization_id  uuid references public.organizations (id) on delete cascade,
  lead_id          uuid references public.leads (id) on delete set null,
  input_context    jsonb not null default '{}'::jsonb,
  output           jsonb,
  status           public.bot_run_status not null default 'draft',
  initiated_by     uuid references auth.users (id) on delete set null,
  approved_by      uuid references auth.users (id) on delete set null,
  approved_at      timestamptz,
  error            text,
  created_at       timestamptz not null default now()
);

comment on table public.bot_runs is
  'Every bot output is a draft until a human approves it. The OS remains
   authoritative — Day 1 pack §8.';

create index bot_runs_org_idx on public.bot_runs (organization_id, created_at desc);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.discovery_sessions enable row level security;
alter table public.demo_plans enable row level security;
alter table public.demo_plan_items enable row level security;
alter table public.feedback enable row level security;
alter table public.training_records enable row level security;
alter table public.readiness_checks enable row level security;
alter table public.bot_runs enable row level security;

create policy discovery_pa on public.discovery_sessions for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy demo_plans_pa on public.demo_plans for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy demo_plan_items_pa on public.demo_plan_items for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy feedback_pa on public.feedback for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy training_pa on public.training_records for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy readiness_pa on public.readiness_checks for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy bot_runs_pa on public.bot_runs for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

grant select, insert, update on public.discovery_sessions, public.demo_plans,
  public.demo_plan_items, public.feedback, public.training_records,
  public.readiness_checks, public.bot_runs to authenticated;
grant all privileges on public.discovery_sessions, public.demo_plans,
  public.demo_plan_items, public.feedback, public.training_records,
  public.readiness_checks, public.bot_runs to service_role;
grant execute on function public.seed_readiness(uuid) to authenticated, service_role;
