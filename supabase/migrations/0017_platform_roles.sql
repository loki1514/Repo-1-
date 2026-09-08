-- ============================================================================
-- 0017 — Platform-side roles
--
-- Until now the entire platform had one identity: is_platform_admin(). That
-- made the Growth panel unusable by an actual sales team — Tanvi, Omkar,
-- Rahul, Nidhi and Aditya were all the same login, which is the gap named in
-- the Day-1 pack (§5.2 lists six distinct people with six distinct jobs).
--
-- This adds a role per platform user and the team it maps to, so work already
-- routed to a team queue (0016) can finally be routed to a person.
-- ============================================================================

create type public.platform_role as enum (
  'master_admin',
  'growth_admin',
  'sales_manager',
  'sales_executive',
  'business_development',
  'onboarding_admin',
  'customer_success',
  'operations'
);

alter table public.platform_admins
  add column role public.platform_role not null default 'master_admin',
  add column full_name text;

comment on column public.platform_admins.role is
  'What this person is allowed and expected to do. Maps to an os_team for
   work routing — see public.team_for_role().';

-- Role -> team. Work items are queued to a team (0016); this is how a person
-- discovers the queue that is theirs.
create or replace function public.team_for_role(r public.platform_role)
returns public.os_team
language sql
immutable
as $$
  select case r
    when 'sales_manager'        then 'sales'::public.os_team
    when 'sales_executive'      then 'sales'::public.os_team
    when 'business_development' then 'sales'::public.os_team
    when 'growth_admin'         then 'sales'::public.os_team
    when 'onboarding_admin'     then 'onboarding'::public.os_team
    when 'customer_success'     then 'customer_success'::public.os_team
    when 'operations'           then 'operations'::public.os_team
    else 'platform'::public.os_team
  end;
$$;

-- The existing super admin keeps full control.
update public.platform_admins
   set role = 'master_admin', full_name = 'Arjun Mehta'
 where email = 'vinipos.mas-admin@vinipos.com';

-- Convenience: the caller's own role, for server-side gating.
create or replace function public.my_platform_role()
returns public.platform_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.platform_admins where user_id = auth.uid();
$$;

comment on function public.my_platform_role() is
  'Role of the signed-in platform user, or null if they are not one.';
