-- =============================================================================
-- InsiderPulse — Phase 2: Ingestion bookkeeping for fetch-sec-filings
-- -----------------------------------------------------------------------------
-- The scheduled ingestion run polls companies in round-robin order (oldest
-- sync first) so that a growing list of tracked companies never exceeds the
-- Edge Function time budget in a single invocation.
-- =============================================================================

alter table public.companies
  add column if not exists last_synced_at        timestamptz,
  add column if not exists market_cap_updated_at timestamptz;

comment on column public.companies.last_synced_at        is 'Last time fetch-sec-filings fully processed this company.';
comment on column public.companies.market_cap_updated_at is 'Last time market_cap was refreshed from Finnhub.';

create index if not exists companies_last_synced_at_idx
  on public.companies (last_synced_at asc nulls first);
