-- ============================================================================
-- 0013 — Growth: organizations gain source_lead_id (touchpoint 4)
--
-- "Aarti opens the build queue and starts with the organization itself."
-- [docs/os claude .txt:479] — a won deal is where an organization comes from.
--
-- Nullable, on delete set null: an organization must never become unbuildable
-- because a lead was later removed. No mirrored "converted" flag on leads —
-- this column, queried from the organizations side, is the only fact that
-- needs to exist. The named build-order note this closes: "organizations
-- gains a nullable source_lead_id the day an organization is created from
-- one" (this session's own Day-1 TRD, "Day 2, the seam").
-- ============================================================================

alter table public.organizations
  add column source_lead_id uuid references public.leads (id) on delete set null;

create index organizations_source_lead_id_idx
  on public.organizations (source_lead_id)
  where source_lead_id is not null;

comment on column public.organizations.source_lead_id is
  'Set when this organization was created from a won deal. Touchpoint 3 -> 4
   [os claude .txt:463-489][docs/Gpt.txt:493-528].';
