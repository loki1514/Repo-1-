-- ============================================================================
-- 0012 — Growth: deals (touchpoint 3 — scoping, commercials, payment)
--
-- Reads a qualified lead and writes forward: Omkar's scoping brief (docs/os
-- claude .txt:449-462), Rahul's quote approval and Sunita's payment
-- (os claude .txt:463-476), the commercial-conversion handoff to onboarding
-- (docs/Gpt.txt:493-510).
--
-- Same idiom as 0011: a mutable head row (deals) plus an append-only history
-- (deal_events) — one new concept (a deal), zero new patterns. One deal per
-- lead (unique lead_id) because the brief is "the single most important
-- document in the deal" [os claude .txt:451], singular, not a running log.
-- ============================================================================

create type public.deal_status as enum ('drafting', 'quoted', 'won', 'lost');

comment on type public.deal_status is
  'drafting: brief being written. quoted: Rahul approved, Sunita has the quote.
   won: paid — the touchpoint-4 trigger. lost: did not convert.';

create table public.deals (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null unique references public.leads (id) on delete cascade,
  brief          text,
  quote_amount   numeric(12,2),
  plan           text,
  status         public.deal_status not null default 'drafting',
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint deals_quote_requires_amount check (
    status = 'drafting' or quote_amount is not null
  )
);

comment on table public.deals is
  'Touchpoint 3: one lead becomes one commercial deal — brief, quote, plan —
   moved drafting -> quoted -> won/lost. won is where touchpoint 4 begins.';

create index deals_status_idx on public.deals (status, created_at desc);

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

alter table public.deals enable row level security;

create policy deals_platform_admin_all
  on public.deals for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, insert, update on public.deals to authenticated;
grant all privileges on public.deals to service_role;

-- ----------------------------------------------------------------------------
-- Status history — same audit guarantee as lead_events:
-- "so that six months later anyone can see where it went" [os claude .txt:426]
-- ----------------------------------------------------------------------------

create table public.deal_events (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals (id) on delete cascade,
  from_status public.deal_status,
  to_status   public.deal_status not null,
  note        text,
  actor       uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.deal_events is
  'One row per deal status change — who approved the quote, who marked it
   won. Append-only, same shape as lead_events.';

create index deal_events_deal_id_idx on public.deal_events (deal_id, created_at);

alter table public.deal_events enable row level security;

create policy deal_events_platform_admin_all on public.deal_events for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

grant select, insert on public.deal_events to authenticated;
grant all privileges on public.deal_events to service_role;
