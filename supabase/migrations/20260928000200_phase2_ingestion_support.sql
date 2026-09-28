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

-- Filings that were downloaded for a company but intentionally not stored,
-- so the scheduler never re-downloads them for that company:
--   not_issuer       the company is the *reporting owner*, not the issuer
--                    (e.g. Berkshire Hathaway's own Form 4 for buying Lennar
--                    shares appears in Berkshire's EDGAR submissions; it is
--                    skipped for BRK-B but still ingested for LEN)
--   no_transactions  the Form 4 reports holdings only
create table if not exists public.ingestion_skipped_filings (
  company_id       uuid        not null references public.companies (id) on delete cascade,
  accession_number varchar(25) not null,
  reason           text        not null check (reason in ('not_issuer', 'no_transactions')),
  created_at       timestamptz not null default now(),
  primary key (company_id, accession_number)
);

comment on table public.ingestion_skipped_filings is
  'Form 4 filings fetch-sec-filings inspected for a company and deliberately skipped (internal bookkeeping).';

-- Internal table: RLS on with no policies, so only the service role can use it.
alter table public.ingestion_skipped_filings enable row level security;
revoke all on public.ingestion_skipped_filings from anon, authenticated;
grant all on public.ingestion_skipped_filings to service_role;
