-- ============================================================================
-- 0019 — Completing Day 1
--
--   §5.3  the full lead lifecycle, not four of its eight states
--   §5.4  Interactions as first-class records rather than text inside notes
--   §6.2  "Customer identity and organization identity must be separate
--          concepts: a person can interact with multiple organizations"
--   Day 2 §9  the fifteen organization-scoped roles
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §5.3 — New -> Contacted -> Qualified -> Requirement -> Demo -> Proposal ->
--        Payment Pending -> Converted / Lost
--
-- 'disqualified' is kept: it is the pre-qualification exit, distinct from
-- 'lost', which is losing a deal that had already been quoted.
-- ----------------------------------------------------------------------------
alter type public.lead_status add value if not exists 'requirement' after 'qualified';
alter type public.lead_status add value if not exists 'demo' after 'requirement';
alter type public.lead_status add value if not exists 'proposal' after 'demo';
alter type public.lead_status add value if not exists 'payment_pending' after 'proposal';
alter type public.lead_status add value if not exists 'converted' after 'payment_pending';
alter type public.lead_status add value if not exists 'lost' after 'converted';

-- ----------------------------------------------------------------------------
-- §5.4 — Interactions. Calls, meetings, messages: what was actually said,
--        when, by whom, attached to the relationship rather than buried in a
--        status-change note.
-- ----------------------------------------------------------------------------
create type public.interaction_kind as enum ('call', 'meeting', 'message', 'email', 'demo', 'note');

create table public.interactions (
  id              uuid primary key default gen_random_uuid(),
  kind            public.interaction_kind not null,
  summary         text not null,
  detail          text,
  occurred_at     timestamptz not null default now(),
  -- An interaction hangs off the relationship, which may be a lead before
  -- conversion and an organization after it. Both is fine; neither is not.
  lead_id         uuid references public.leads (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  participants    text,
  actor           uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint interactions_summary_not_blank check (length(btrim(summary)) > 0),
  constraint interactions_needs_context check (lead_id is not null or organization_id is not null)
);

comment on table public.interactions is
  'Day 1 §5.4: calls, meetings and messages as records. A lead detail is not
   360-degree if the conversation only exists inside a status note.';

create index interactions_lead_idx on public.interactions (lead_id, occurred_at desc);
create index interactions_org_idx on public.interactions (organization_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- §6.2 — Customer identity, separate from organization identity.
--
-- Sunita Deshmukh is one person. She owns Annapurna Hospitality and may later
-- own a second business; the same human should not be duplicated per tenant.
-- ----------------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text,
  phone       text,
  notes       text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint customers_name_not_blank check (length(btrim(full_name)) > 0)
);

comment on table public.customers is
  'A person, once. Linked to any number of organizations through
   customer_organizations — Day 1 pack §6.2.';

create unique index customers_phone_idx on public.customers (phone) where phone is not null;

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create type public.customer_relation as enum ('owner', 'admin', 'billing', 'contact', 'franchisee');

create table public.customer_organizations (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  relation        public.customer_relation not null default 'contact',
  created_at      timestamptz not null default now()
);

create unique index customer_orgs_unique_idx
  on public.customer_organizations (customer_id, organization_id, relation);
create index customer_orgs_org_idx on public.customer_organizations (organization_id);

-- Where a lead's person becomes a customer, keep the thread.
alter table public.leads
  add column customer_id uuid references public.customers (id) on delete set null;

-- ----------------------------------------------------------------------------
-- Day 2 §9 — the fifteen organization-scoped roles.
--
-- The five that exist (org_admin, manager, biller, captain, kitchen) are the
-- restaurant operating roles and stay untouched; these are the organization
-- roles the taxonomy names, added only where absent.
-- ----------------------------------------------------------------------------
insert into public.roles (slug, name, is_system)
values
  ('org_owner',          'Organization Owner',   true),
  ('business_manager',   'Business Manager',     true),
  ('location_manager',   'Branch / Location Manager', true),
  ('operations_manager', 'Operations Manager',   true),
  ('finance_manager',    'Finance Manager',      true),
  ('accountant',         'Accountant',           true),
  ('hr_manager',         'HR / Staff Manager',   true),
  ('marketing_manager',  'Marketing Manager',    true),
  ('inventory_manager',  'Inventory Manager',    true),
  ('procurement_manager','Procurement Manager',  true),
  ('support_user',       'Customer Support User',true),
  ('analyst',            'Analyst / Reporting User', true),
  ('staff_user',         'Staff User',           true),
  ('viewer',             'Viewer',               true)
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.interactions enable row level security;
alter table public.customers enable row level security;
alter table public.customer_organizations enable row level security;

create policy interactions_platform_admin_all on public.interactions for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy customers_platform_admin_all on public.customers for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy customer_orgs_platform_admin_all on public.customer_organizations for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

grant select, insert, update on public.interactions to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert, delete on public.customer_organizations to authenticated;
grant all privileges on public.interactions, public.customers,
  public.customer_organizations to service_role;
