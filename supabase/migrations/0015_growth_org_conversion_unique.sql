-- ============================================================================
-- 0015 — organizations.source_lead_id becomes actually one-to-one
--
-- 0013 added the column with only a non-unique partial index — nothing at
-- the database level stopped two organizations being created from the same
-- lead (e.g. two admins both following the "Create organization" link
-- before the Growth queue re-rendered). Caught in this session's own
-- adversarial review, not left as a UI-only guarantee.
-- ============================================================================

drop index if exists public.organizations_source_lead_id_idx;

create unique index organizations_source_lead_id_idx
  on public.organizations (source_lead_id)
  where source_lead_id is not null;
