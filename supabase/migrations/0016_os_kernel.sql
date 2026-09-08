-- ============================================================================
-- 0016 — The OS kernel
--
-- Day 1 pack, §3: the OS is "people + context + work + state + events +
-- handoffs". Days 1-3 of this build shipped Lead and Opportunity and nothing
-- else from that list, which is why nothing moved on its own. This migration
-- adds the primitives every module is supposed to consume instead of
-- reinventing (Day 1 §6.1: "modules request work instead of implementing
-- separate task engines").
--
--   work_items    — the task engine. One per actionable next step.
--   activities    — append-only cross-module timeline.
--   handoffs      — transfer of responsibility WITH context.
--   requirements  — what the customer said, with source and lifecycle.
--   notifications — signals; never the source of truth.
--
-- Plus onboarding state on organizations, so a converted customer has a
-- lifecycle position rather than just existing.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Teams. Roles do not exist yet (Growth tier is "(Only Screens)" in the
-- taxonomy), so work routes to a QUEUE, not a person. Any platform admin can
-- pick up any queue today; when real roles land, this column is what they
-- attach to.
-- ----------------------------------------------------------------------------
create type public.os_team as enum ('sales', 'onboarding', 'customer_success', 'operations', 'platform');

-- ----------------------------------------------------------------------------
-- Work items
-- ----------------------------------------------------------------------------
create type public.work_status as enum ('open', 'in_progress', 'blocked', 'done', 'cancelled');

create type public.work_kind as enum (
  'verify_organization',
  'create_location',
  'confirm_requirements',
  'schedule_demo',
  'run_demo',
  'training',
  'go_live_check',
  'sales_clarification'
);

create table public.work_items (
  id              uuid primary key default gen_random_uuid(),
  kind            public.work_kind not null,
  title           text not null,
  detail          text,
  status          public.work_status not null default 'open',
  team            public.os_team not null,
  assigned_to     uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  due_at          timestamptz,
  blocked_reason  text,
  -- What produced this item. 'system' means the orchestrator created it in
  -- response to another item completing — the thing that makes this an OS.
  created_by      uuid references auth.users (id) on delete set null,
  origin          text not null default 'system',
  completed_at    timestamptz,
  completed_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint work_items_needs_context check (organization_id is not null or lead_id is not null)
);

comment on table public.work_items is
  'The OS task engine. Every module requests work here instead of building its own queue.';

create index work_items_queue_idx on public.work_items (team, status, due_at);
create index work_items_org_idx on public.work_items (organization_id, status);
create index work_items_assignee_idx on public.work_items (assigned_to, status);

create trigger work_items_set_updated_at
  before update on public.work_items
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Activities — append-only. Day 1 §6.2: "Activity is append-oriented".
-- ----------------------------------------------------------------------------
create type public.activity_kind as enum (
  'created', 'state_changed', 'handoff', 'note',
  'work_created', 'work_completed', 'requirement_changed'
);

create table public.activities (
  id              uuid primary key default gen_random_uuid(),
  kind            public.activity_kind not null,
  summary         text not null,
  detail          jsonb,
  organization_id uuid references public.organizations (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete cascade,
  work_item_id    uuid references public.work_items (id) on delete set null,
  actor           uuid references auth.users (id) on delete set null,
  -- 'system' when the orchestrator acted with no human pressing anything.
  actor_label     text not null default 'system',
  created_at      timestamptz not null default now()
);

comment on table public.activities is
  'Cross-module chronological record. Written once, read by every timeline view.';

create index activities_org_idx on public.activities (organization_id, created_at desc);
create index activities_lead_idx on public.activities (lead_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Handoffs — responsibility moving, carrying context so the customer does not
-- "repeat the same story five times" (docs/Gpt.txt:476).
-- ----------------------------------------------------------------------------
create table public.handoffs (
  id              uuid primary key default gen_random_uuid(),
  from_team       public.os_team not null,
  to_team         public.os_team not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  -- The carried payload: identity, commercial status, requirements, promises,
  -- open questions, sales owner. Day 2 §11's handoff contract, as data.
  context         jsonb not null default '{}'::jsonb,
  accepted_by     uuid references auth.users (id) on delete set null,
  accepted_at     timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.handoffs is
  'Sales -> Onboarding -> Customer Success. The context column is the contract.';

create index handoffs_org_idx on public.handoffs (organization_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Requirements — Day 2 §8. Source and history are retained; a later
-- interpretation never silently replaces the original.
-- ----------------------------------------------------------------------------
create type public.requirement_status as enum (
  'captured', 'clarification_required', 'confirmed', 'rejected', 'delivered'
);

create type public.requirement_disposition as enum (
  'configuration', 'training', 'process_change', 'product_gap', 'development_issue', 'deferred'
);

create table public.requirements (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  detail          text,
  organization_id uuid references public.organizations (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  source          public.os_team not null default 'sales',
  status          public.requirement_status not null default 'captured',
  disposition     public.requirement_disposition,
  owner           uuid references auth.users (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint requirements_title_not_blank check (length(btrim(title)) > 0)
);

comment on table public.requirements is
  'What the customer said they need, carried from the scoping brief and
   validated by Customer Success. Source is never overwritten.';

create index requirements_org_idx on public.requirements (organization_id, status);

create trigger requirements_set_updated_at
  before update on public.requirements
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Notifications — projections of events, not business state.
-- ----------------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users (id) on delete cascade,
  team         public.os_team,
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),

  constraint notifications_has_target check (user_id is not null or team is not null)
);

create index notifications_inbox_idx on public.notifications (user_id, read_at, created_at desc);
create index notifications_team_idx on public.notifications (team, read_at, created_at desc);

-- ----------------------------------------------------------------------------
-- Onboarding lifecycle on the organization (Day 2 §7).
-- ----------------------------------------------------------------------------
create type public.onboarding_stage as enum (
  'new_handoff', 'assigned', 'contacted', 'information_pending',
  'requirements_in_progress', 'requirements_confirmed', 'preparation',
  'ready_for_demo', 'demo_done', 'training', 'ready_for_go_live', 'active'
);

alter table public.organizations
  add column onboarding_stage public.onboarding_stage,
  add column onboarding_owner uuid references auth.users (id) on delete set null;

comment on column public.organizations.onboarding_stage is
  'Null for organizations created before the OS kernel existed. Set to
   new_handoff the moment a won deal converts.';

-- ----------------------------------------------------------------------------
-- RLS — same platform-only shape as the rest of the Growth surface.
-- ----------------------------------------------------------------------------
alter table public.work_items enable row level security;
alter table public.activities enable row level security;
alter table public.handoffs enable row level security;
alter table public.requirements enable row level security;
alter table public.notifications enable row level security;

create policy work_items_platform_admin_all on public.work_items for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy activities_platform_admin_all on public.activities for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy handoffs_platform_admin_all on public.handoffs for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy requirements_platform_admin_all on public.requirements for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy notifications_platform_admin_all on public.notifications for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

grant select, insert, update on public.work_items to authenticated;
grant select, insert on public.activities to authenticated;
grant select, insert, update on public.handoffs to authenticated;
grant select, insert, update on public.requirements to authenticated;
grant select, insert, update on public.notifications to authenticated;
grant all privileges on public.work_items, public.activities, public.handoffs,
  public.requirements, public.notifications to service_role;
