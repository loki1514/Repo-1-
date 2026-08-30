-- ============================================================================
-- 0010 — Restaurant operations
--
-- 0006 gave us a menu, tables, orders and KOTs: enough for one cashier at one
-- screen. This migration is what turns that into a restaurant — the parts that
-- only matter once a guest, a captain, a kitchen and an aggregator are all
-- touching the same order at the same time:
--
--   • floor plan       dining_areas, tables carry a QR token
--   • the guest party  table_sessions (a PIN a table shares), service_requests
--   • the real menu    variants, veg/non-veg, course, station, prep time
--   • line-level life  order_items get a status, a variant and a KOT link
--   • the bill         charges settings, payments, discount / service / round-off
--   • the timeline     order_events — the ball-by-ball record of an order
--   • the aggregators  channel_integrations + per-item, per-channel on/off
--
-- Tenancy is unchanged: organization_id = current_org_id() for members, plus
-- the platform-admin escape hatch, exactly as 0006 established.
--
-- The guest QR app is deliberately absent from this policy set. Guests have no
-- Supabase session, so every guest read and write goes through server actions
-- on service_role, authorized by the QR token and table PIN. Opening these
-- tables to `anon` would be a far larger blast radius than the feature needs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared policy shape
--
-- Nine tables want the identical four policies. Writing them out nine times is
-- how one of them quietly ends up different, so it is generated instead.
-- ----------------------------------------------------------------------------

create or replace function public.apply_org_rls(tbl regclass)
returns void
language plpgsql
as $$
declare
  t text := tbl::text;
begin
  execute format('alter table %s enable row level security', t);
  execute format($f$create policy %s_platform_admin_all on %s for all
    using (public.is_platform_admin()) with check (public.is_platform_admin())$f$,
    replace(split_part(t, '.', 2), '"', ''), t);
  execute format($f$create policy %s_member_select on %s for select
    using (organization_id = public.current_org_id())$f$,
    replace(split_part(t, '.', 2), '"', ''), t);
  execute format($f$create policy %s_member_write on %s for insert
    with check (organization_id = public.current_org_id())$f$,
    replace(split_part(t, '.', 2), '"', ''), t);
  execute format($f$create policy %s_member_update on %s for update
    using (organization_id = public.current_org_id())
    with check (organization_id = public.current_org_id())$f$,
    replace(split_part(t, '.', 2), '"', ''), t);
  execute format('grant select, insert, update, delete on %s to authenticated', t);
  execute format('grant all privileges on %s to service_role', t);
end;
$$;

comment on function public.apply_org_rls(regclass) is
  'Applies the standard org-scoped RLS policy set + grants to a table carrying organization_id.';

-- ----------------------------------------------------------------------------
-- Floor plan
-- ----------------------------------------------------------------------------

create table public.dining_areas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),

  constraint dining_areas_name_not_blank check (length(btrim(name)) > 0),
  constraint dining_areas_org_name_unique unique (organization_id, name)
);

comment on table public.dining_areas is
  'Floor sections — Indoor, Outdoor, Private Dining. Tables group under these on the table view.';

create index dining_areas_organization_id_idx on public.dining_areas (organization_id);
select public.apply_org_rls('public.dining_areas');

-- Tables gain a section and their own QR token.
--
-- qr_token is globally unique, not org-unique: /t/<token> is reached by a guest
-- with no session and no host context, so the token alone has to identify the
-- table. It is random rather than sequential so a guest cannot walk the floor
-- by editing the URL.
alter table public.dining_tables
  add column area_id  uuid references public.dining_areas (id) on delete set null,
  add column qr_token text unique,
  add column min_capacity int not null default 1;

create index dining_tables_area_id_idx on public.dining_tables (area_id);

-- ----------------------------------------------------------------------------
-- The guest party
--
-- A session is one seating at one table. Its PIN is what the reference app
-- prints beside the table number: the first guest scans, everyone else joins
-- the same bill by typing the PIN instead of scanning again.
-- ----------------------------------------------------------------------------

create table public.table_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  table_id        uuid not null references public.dining_tables (id) on delete cascade,
  pin             text not null,
  guest_name      text,
  guest_phone     text,
  guest_count     int  not null default 1,
  status          text not null default 'open'
    check (status in ('open', 'billed', 'closed')),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,

  constraint table_sessions_pin_shape check (pin ~ '^[0-9]{4}$'),
  constraint table_sessions_guest_count_positive check (guest_count > 0)
);

comment on table public.table_sessions is
  'One seating at one table. The 4-digit PIN lets other guests at the same table join the same bill.';

-- At most one live session per table: the partial unique index is what makes
-- "scan the QR" idempotent — a second guest scanning finds the same session
-- rather than opening a competing bill.
create unique index table_sessions_one_open_per_table
  on public.table_sessions (table_id)
  where status <> 'closed';

create index table_sessions_organization_id_idx on public.table_sessions (organization_id);
create index table_sessions_status_idx on public.table_sessions (organization_id, status);
select public.apply_org_rls('public.table_sessions');

-- ----------------------------------------------------------------------------
-- Call waiter
-- ----------------------------------------------------------------------------

create table public.service_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  table_id        uuid references public.dining_tables (id) on delete cascade,
  session_id      uuid references public.table_sessions (id) on delete cascade,
  kind            text not null default 'other'
    check (kind in ('water', 'cutlery', 'clean_up', 'bill', 'assistance', 'other')),
  note            text,
  status          text not null default 'open'
    check (status in ('open', 'acknowledged', 'done')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

comment on table public.service_requests is
  'Guest taps Call Waiter — water, cutlery, clean up. Lands on the floor staff screen.';

create index service_requests_open_idx
  on public.service_requests (organization_id, status, created_at desc);
select public.apply_org_rls('public.service_requests');

-- ----------------------------------------------------------------------------
-- Menu, fleshed out
--
-- food_type drives the red/green square every Indian menu is legally expected
-- to carry; course splits the guest menu into Eat and Drink; station is what
-- routes a line to the right KOT screen.
-- ----------------------------------------------------------------------------

alter table public.menu_items
  add column description    text,
  add column food_type      text not null default 'veg'
    check (food_type in ('veg', 'non_veg', 'egg')),
  add column course         text not null default 'eat'
    check (course in ('eat', 'drink')),
  add column is_recommended boolean not null default false,
  add column prep_minutes   int not null default 10,
  add column station        text not null default 'main';

create table public.menu_item_variants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  menu_item_id    uuid not null references public.menu_items (id) on delete cascade,
  name            text not null,
  price           numeric(10, 2) not null check (price >= 0),
  is_default      boolean not null default false,
  sort_order      int not null default 0,

  constraint menu_item_variants_name_not_blank check (length(btrim(name)) > 0),
  constraint menu_item_variants_item_name_unique unique (menu_item_id, name)
);

comment on table public.menu_item_variants is
  'Half/Full, 1 Pc/2 Pc. An item with variants prices from its variants; menu_items.price is then the "starts at".';

create index menu_item_variants_menu_item_id_idx on public.menu_item_variants (menu_item_id);
select public.apply_org_rls('public.menu_item_variants');

-- ----------------------------------------------------------------------------
-- Kitchen stations
-- ----------------------------------------------------------------------------

create table public.kitchen_stations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key             text not null,
  name            text not null,
  colour          text not null default '#79bc0d',
  sort_order      int not null default 0,

  constraint kitchen_stations_org_key_unique unique (organization_id, key)
);

comment on table public.kitchen_stations is
  'Named KOT destinations (tandoor, curry, beverages). menu_items.station and kot_tickets.station carry the key.';

select public.apply_org_rls('public.kitchen_stations');

-- ----------------------------------------------------------------------------
-- Order lines grow a life of their own
--
-- The guest screen shows a tick per dish, not per order, so status has to live
-- on the line. kot_ticket_id is what lets a second round of items fire its own
-- KOT while the first round is already being eaten.
-- ----------------------------------------------------------------------------

alter table public.order_items
  add column variant_name  text,
  add column status        text not null default 'pending'
    check (status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  add column kot_ticket_id uuid references public.kot_tickets (id) on delete set null,
  add column course        text not null default 'eat',
  add column station       text not null default 'main';

create index order_items_kot_ticket_id_idx on public.order_items (kot_ticket_id);

-- ----------------------------------------------------------------------------
-- Orders: the session, the bill breakdown, the audit
-- ----------------------------------------------------------------------------

alter table public.orders
  add column session_id      uuid references public.table_sessions (id) on delete set null,
  add column placed_by       text not null default 'pos'
    check (placed_by in ('pos', 'captain', 'guest', 'integration')),
  add column guest_count     int not null default 1,
  add column discount        numeric(10, 2) not null default 0,
  add column service_charge  numeric(10, 2) not null default 0,
  add column round_off       numeric(10, 2) not null default 0,
  add column paid_at         timestamptz,
  add column notes           text,
  -- Aggregator orders keep their own reference so the POS can be reconciled
  -- against the Swiggy/Zomato dashboard without guessing.
  add column external_ref    text;

create index orders_session_id_idx on public.orders (session_id);

-- 'ready' sits between sent_to_kitchen and awaiting_payment: food is up but the
-- table has not asked for the bill. Without it the KDS has nothing to bump to.
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('new', 'in_billing', 'sent_to_kitchen', 'ready',
                    'awaiting_payment', 'paid', 'delivered', 'cancelled'));

create table public.order_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id        uuid not null references public.orders (id) on delete cascade,
  kind            text not null,
  message         text not null,
  actor           text,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.order_events is
  'Append-only order timeline — placed, KOT fired, item ready, delivered, settled. Powers the live operations board.';

create index order_events_order_id_idx on public.order_events (order_id, created_at);
create index order_events_org_recent_idx on public.order_events (organization_id, created_at desc);
select public.apply_org_rls('public.order_events');

-- ----------------------------------------------------------------------------
-- The bill
-- ----------------------------------------------------------------------------

create table public.org_bill_settings (
  organization_id     uuid primary key references public.organizations (id) on delete cascade,
  legal_name          text,
  address             text,
  gstin               text,
  fssai               text,
  phone               text,
  sgst_pct            numeric(5, 2) not null default 2.5,
  cgst_pct            numeric(5, 2) not null default 2.5,
  service_charge_pct  numeric(5, 2) not null default 0,
  round_off_enabled   boolean not null default true,
  footer_note         text,
  updated_at          timestamptz not null default now(),

  constraint org_bill_settings_pct_sane check (
    sgst_pct between 0 and 50 and cgst_pct between 0 and 50
    and service_charge_pct between 0 and 50
  )
);

comment on table public.org_bill_settings is
  'Per-org tax and charge configuration plus the header/footer a printed bill needs.';

create trigger org_bill_settings_set_updated_at
  before update on public.org_bill_settings
  for each row execute function public.set_updated_at();

select public.apply_org_rls('public.org_bill_settings');

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id        uuid not null references public.orders (id) on delete cascade,
  method          text not null
    check (method in ('cash', 'upi', 'card', 'wallet', 'due', 'other')),
  amount          numeric(10, 2) not null check (amount > 0),
  reference       text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.payments is
  'Tenders against an order. A split bill is several rows; the order is settled when they sum to the total.';

create index payments_order_id_idx on public.payments (order_id);
create index payments_org_created_idx on public.payments (organization_id, created_at desc);
select public.apply_org_rls('public.payments');

-- ----------------------------------------------------------------------------
-- Aggregators and channels
-- ----------------------------------------------------------------------------

create table public.channel_integrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel         text not null
    check (channel in ('swiggy', 'zomato', 'ondc', 'website', 'whatsapp', 'qr')),
  display_name    text not null,
  is_connected    boolean not null default false,
  -- Store on/off. next_open_at is what the reference dashboard prints under a
  -- switched-off store ("Next opens at 1:32 AM, Aug 21").
  is_accepting    boolean not null default true,
  next_open_at    timestamptz,
  auto_accept     boolean not null default true,
  commission_pct  numeric(5, 2) not null default 0,
  config          jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),

  constraint channel_integrations_org_channel_unique unique (organization_id, channel)
);

comment on table public.channel_integrations is
  'One row per sales channel. is_accepting is the store on/off switch the aggregator dashboards expose.';

create trigger channel_integrations_set_updated_at
  before update on public.channel_integrations
  for each row execute function public.set_updated_at();

select public.apply_org_rls('public.channel_integrations');

create table public.item_channel_status (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  menu_item_id    uuid not null references public.menu_items (id) on delete cascade,
  channel         text not null,
  is_available    boolean not null default true,
  -- Null while available, or when switched off indefinitely. A timestamp is a
  -- promise to come back on: the reader treats a past off_until as available
  -- again, so nothing has to sweep this table.
  off_until       timestamptz,
  updated_at      timestamptz not null default now(),

  primary key (menu_item_id, channel)
);

comment on table public.item_channel_status is
  'Per-item, per-channel availability. off_until in the past reads as available — no cron needed to switch items back on.';

create index item_channel_status_org_idx on public.item_channel_status (organization_id, channel);

create trigger item_channel_status_set_updated_at
  before update on public.item_channel_status
  for each row execute function public.set_updated_at();

select public.apply_org_rls('public.item_channel_status');

-- ----------------------------------------------------------------------------
-- Realtime
--
-- The guest phone, the captain, the KDS and the manager's board are all looking
-- at the same order from four angles; each of these is a table one of them
-- needs pushed rather than polled.
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.order_events;
alter publication supabase_realtime add table public.service_requests;
alter publication supabase_realtime add table public.table_sessions;
