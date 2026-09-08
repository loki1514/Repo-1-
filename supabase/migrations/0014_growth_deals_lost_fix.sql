-- ============================================================================
-- 0014 — Fix deals_quote_requires_amount (0012 shipped it too strict)
--
-- The original constraint read "drafting OR quote_amount is not null", which
-- also blocked marking a deal lost straight from drafting — a customer can
-- walk away during scoping, before a quote ever exists. Only quoted and won
-- (which is reachable only via quoted) should require an amount.
-- ============================================================================

alter table public.deals drop constraint deals_quote_requires_amount;

alter table public.deals add constraint deals_quote_requires_amount check (
  status not in ('quoted', 'won') or quote_amount is not null
);
