-- ============================================================================
-- 0018 — Closing the seven gaps named in the Days 1-3 report
--
--   1. Completion is a rubber stamp   -> work_evidence + gates in the orchestrator
--   2. Requirement validation missing -> requirement_events, and a clarification
--                                        loop back to Sales
--   3. Locations (FR-03) unmodelled   -> locations, one organization to many
--   4. Cascade is not atomic          -> apply_work_completion(), one transaction
--   5. No payment, no commission      -> deal_payments, commissions
--   6. No branching or escalation     -> escalation columns + escalate_overdue_work()
--
-- Gap 7 (not deployed) is not a schema problem.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3 · Locations. Day 2 FR-03 / §10: an organization has one or many locations,
--     each belonging to exactly one organization. Annapurna is three outlets,
--     one of them franchised (docs/os claude .txt:452-454).
-- ----------------------------------------------------------------------------
create type public.location_kind as enum ('outlet', 'branch', 'franchise', 'warehouse', 'office');

create table public.locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  kind            public.location_kind not null default 'outlet',
  code            text,
  address         text,
  city            text,
  -- Set when this location is operated by someone other than the group owner:
  -- "Annapurna Ganj Golai — franchised to Deepak Bansode" [os claude .txt:454]
  franchisee_name text,
  is_primary      boolean not null default false,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint locations_name_not_blank check (length(btrim(name)) > 0)
);

comment on table public.locations is
  'Organization branches/outlets. Vertical modules attach operational records
   to a location; Day 2 creates them without requiring POS setup first.';

create unique index locations_org_name_idx on public.locations (organization_id, lower(name));
create index locations_org_idx on public.locations (organization_id);

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 1 · Evidence. A work item may not be completed on assertion alone; the
--     orchestrator requires a row here for the kinds that need proof.
-- ----------------------------------------------------------------------------
create table public.work_evidence (
  id           uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items (id) on delete cascade,
  kind         text not null,
  content      jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.work_evidence is
  'What actually happened, attached to the work item that claims it did.
   Attendees for a demo, the people trained, the readiness checklist.';

create index work_evidence_item_idx on public.work_evidence (work_item_id, created_at);

-- ----------------------------------------------------------------------------
-- 2 · Requirement history. Day 2 §8: "requirements retain source and history.
--     If Sales said something and Customer Success later changes the
--     interpretation, the progression should remain visible."
-- ----------------------------------------------------------------------------
create table public.requirement_events (
  id             uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements (id) on delete cascade,
  from_status    public.requirement_status,
  to_status      public.requirement_status not null,
  disposition    public.requirement_disposition,
  note           text,
  actor          uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index requirement_events_req_idx on public.requirement_events (requirement_id, created_at);

-- ----------------------------------------------------------------------------
-- 5 · Money. "Sunita pays the annual plan on the fourteenth" [os claude .txt:465]
--     and "Nikhil sees Farhan's commission move from provisional to approved"
--     [os claude .txt:467].
-- ----------------------------------------------------------------------------
create type public.deal_payment_method as enum ('upi', 'bank_transfer', 'card', 'cheque', 'cash');

create table public.deal_payments (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals (id) on delete cascade,
  amount      numeric(12,2) not null check (amount > 0),
  method      public.deal_payment_method not null,
  reference   text,
  received_at timestamptz not null default now(),
  recorded_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.deal_payments is
  'A deal cannot be marked won without one of these. "Won" stops being a button.';

create index deal_payments_deal_idx on public.deal_payments (deal_id);

create type public.commission_status as enum ('provisional', 'approved', 'paid', 'void');

create table public.commissions (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references public.leads (id) on delete set null,
  deal_id       uuid not null references public.deals (id) on delete cascade,
  partner_name  text not null,
  basis         text not null default 'referral',
  rate_percent  numeric(5,2) not null default 10.00,
  amount        numeric(12,2),
  status        public.commission_status not null default 'provisional',
  approved_at   timestamptz,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.commissions is
  'Provisional the instant a referred lead is quoted; approved when payment
   lands. Greyed, not payable, until then — os claude .txt:431.';

create unique index commissions_deal_idx on public.commissions (deal_id);

create trigger commissions_set_updated_at
  before update on public.commissions
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6 · Escalation. Overdue work has to reach somebody.
-- ----------------------------------------------------------------------------
alter table public.work_items
  add column escalated_at timestamptz,
  add column escalation_note text;

create or replace function public.escalate_overdue_work()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select w.id, w.title, w.team, w.organization_id, w.due_at
      from public.work_items w
     where w.status in ('open', 'in_progress')
       and w.due_at is not null
       and w.due_at < now()
       and w.escalated_at is null
  loop
    update public.work_items
       set escalated_at = now(),
           escalation_note = 'Overdue since ' || to_char(r.due_at, 'DD Mon HH24:MI')
     where id = r.id;

    -- Operations is the team that intervenes on blocked/aging onboarding
    -- (Day 2 PRD §12, 17:00 — Rohit).
    insert into public.notifications (team, title, body, link)
    values (
      'operations',
      'Overdue: ' || r.title,
      'Owed by ' || r.team || ', past its due date. Nobody has picked it up.',
      case when r.organization_id is not null
           then '/admin/organizations/' || r.organization_id::text else null end
    );

    insert into public.activities (kind, summary, organization_id, work_item_id, actor_label)
    values ('state_changed', 'Escalated to Operations — overdue', r.organization_id, r.id, 'system');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.escalate_overdue_work() is
  'Run on a schedule. Flags overdue work once, notifies Operations, records it.';

-- ----------------------------------------------------------------------------
-- 4 · Atomicity. The orchestrator decides WHAT happens next; this applies it
--     in one transaction so a mid-cascade failure cannot leave a completed
--     item with no successor.
-- ----------------------------------------------------------------------------
create or replace function public.apply_work_completion(
  p_work_id     uuid,
  p_actor       uuid,
  p_stage       public.onboarding_stage default null,
  p_next        jsonb default null,   -- {kind,title,detail,team,due_days}
  p_handoff     jsonb default null,   -- {from,to,context}
  p_make_active boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item     public.work_items;
  v_next_id  uuid;
  v_org      uuid;
begin
  select * into v_item from public.work_items where id = p_work_id for update;
  if not found then
    raise exception 'apply_work_completion: no such work item';
  end if;
  if v_item.status = 'done' then
    raise exception 'apply_work_completion: already completed';
  end if;

  v_org := v_item.organization_id;

  update public.work_items
     set status = 'done', completed_at = now(), completed_by = p_actor
   where id = p_work_id;

  insert into public.activities (kind, summary, organization_id, lead_id, work_item_id, actor, actor_label)
  values ('work_completed', 'Completed: ' || v_item.title, v_org, v_item.lead_id, p_work_id, p_actor, 'user');

  if p_stage is not null and v_org is not null then
    update public.organizations set onboarding_stage = p_stage where id = v_org;
    insert into public.activities (kind, summary, organization_id, actor_label)
    values ('state_changed', 'Onboarding stage -> ' || p_stage::text, v_org, 'system');
  end if;

  if p_handoff is not null and v_org is not null then
    insert into public.handoffs (from_team, to_team, organization_id, lead_id, context, created_by)
    values (
      (p_handoff->>'from')::public.os_team,
      (p_handoff->>'to')::public.os_team,
      v_org, v_item.lead_id,
      coalesce(p_handoff->'context', '{}'::jsonb),
      p_actor
    );
    insert into public.activities (kind, summary, organization_id, actor_label)
    values ('handoff', 'Handoff ' || (p_handoff->>'from') || ' -> ' || (p_handoff->>'to'), v_org, 'system');
  end if;

  if p_next is not null then
    insert into public.work_items (kind, title, detail, team, organization_id, lead_id, due_at, origin)
    values (
      (p_next->>'kind')::public.work_kind,
      p_next->>'title',
      p_next->>'detail',
      (p_next->>'team')::public.os_team,
      v_org, v_item.lead_id,
      now() + ((p_next->>'due_days')::int || ' days')::interval,
      'system'
    )
    returning id into v_next_id;

    insert into public.activities (kind, summary, organization_id, work_item_id, actor_label)
    values ('work_created', 'Work item created: ' || (p_next->>'title'), v_org, v_next_id, 'system');

    insert into public.notifications (team, title, body, link)
    values (
      (p_next->>'team')::public.os_team,
      p_next->>'title',
      p_next->>'detail',
      case when v_org is not null then '/admin/organizations/' || v_org::text else null end
    );
  end if;

  if p_make_active and v_org is not null then
    update public.organizations set status = 'active' where id = v_org;
  end if;

  return jsonb_build_object(
    'work_id', p_work_id,
    'next_work_id', v_next_id,
    'organization_id', v_org
  );
end;
$$;

comment on function public.apply_work_completion is
  'One transaction: complete, advance the stage, hand off, create the next item,
   notify, record. Either all of it happens or none of it does.';

-- ----------------------------------------------------------------------------
-- RLS + grants — same platform-only shape as the rest of the OS kernel.
-- ----------------------------------------------------------------------------
alter table public.locations enable row level security;
alter table public.work_evidence enable row level security;
alter table public.requirement_events enable row level security;
alter table public.deal_payments enable row level security;
alter table public.commissions enable row level security;

create policy locations_platform_admin_all on public.locations for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy work_evidence_platform_admin_all on public.work_evidence for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy requirement_events_platform_admin_all on public.requirement_events for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy deal_payments_platform_admin_all on public.deal_payments for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy commissions_platform_admin_all on public.commissions for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

grant select, insert, update on public.locations to authenticated;
grant select, insert on public.work_evidence to authenticated;
grant select, insert on public.requirement_events to authenticated;
grant select, insert on public.deal_payments to authenticated;
grant select, insert, update on public.commissions to authenticated;
grant all privileges on public.locations, public.work_evidence, public.requirement_events,
  public.deal_payments, public.commissions to service_role;
grant execute on function public.apply_work_completion(uuid, uuid, public.onboarding_stage, jsonb, jsonb, boolean) to authenticated, service_role;
grant execute on function public.escalate_overdue_work() to service_role;
