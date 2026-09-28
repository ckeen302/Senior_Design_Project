-- =============================================================================
-- InsiderPulse — Phase 1: Core schema, indexes & Row Level Security
-- -----------------------------------------------------------------------------
-- Tables
--   companies             Tracked issuers (ticker <-> SEC CIK)
--   insider_transactions  One row per SEC Form 4 filing (accession number)
--   sentiment_scores      Latest WISI score per company (maintained by trigger)
--   watchlists            Per-user saved companies
--
-- Security model
--   * RLS is enabled on every table.
--   * companies / insider_transactions / sentiment_scores are world-readable
--     (anon + authenticated) and only writable by the service role, which is
--     used exclusively by the fetch-sec-filings Edge Function.
--   * watchlists rows are visible to / modifiable by their owner only.
-- =============================================================================

-- 1. Extensions ---------------------------------------------------------------
-- Supabase installs extensions into the "extensions" schema. gen_random_uuid()
-- is also built into PostgreSQL 13+, so UUID defaults work either way.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- 2. Tables -------------------------------------------------------------------

create table if not exists public.companies (
  id            uuid        primary key default gen_random_uuid(),
  -- UNIQUE constraints are backed by B-tree indexes, so ticker and cik are
  -- indexed without a separate CREATE INDEX.
  ticker        varchar(10) not null unique,
  cik           varchar(10) not null unique,
  company_name  text        not null,
  market_cap    numeric              default 1000000000,
  created_at    timestamptz not null default now(),
  constraint companies_ticker_format check (ticker = upper(ticker) and ticker ~ '^[A-Z0-9.-]{1,10}$'),
  constraint companies_cik_format    check (cik ~ '^[0-9]{10}$'),
  constraint companies_market_cap_positive check (market_cap is null or market_cap > 0)
);

comment on table  public.companies            is 'Issuers tracked by InsiderPulse.';
comment on column public.companies.cik        is 'SEC Central Index Key, zero-padded to 10 digits.';
comment on column public.companies.market_cap is 'Market capitalisation in USD (WISI denominator).';

create table if not exists public.insider_transactions (
  id                       uuid        primary key default gen_random_uuid(),
  company_id               uuid        not null references public.companies (id) on delete cascade,
  accession_number         varchar(25) not null unique,
  filing_date              timestamptz not null,
  transaction_date         date        not null,
  reporting_owner_name     text        not null,
  owner_title              text,
  -- 'P' = open-market purchase, 'S' = open-market sale, others = awards,
  -- exercises, gifts, tax withholding, etc.
  transaction_code         varchar(2)  not null,
  shares                   numeric     not null,
  price_per_share          numeric     not null,
  total_value              numeric     generated always as (shares * price_per_share) stored,
  is_direct                boolean              default true,
  post_transaction_shares  numeric,
  created_at               timestamptz not null default now(),
  constraint insider_transactions_shares_nonnegative check (shares >= 0),
  constraint insider_transactions_price_nonnegative  check (price_per_share >= 0)
);

comment on table  public.insider_transactions is 'SEC Form 4 insider transactions (one row per filing accession number).';
comment on column public.insider_transactions.total_value is 'shares * price_per_share (generated).';

create table if not exists public.sentiment_scores (
  id            uuid        primary key default gen_random_uuid(),
  company_id    uuid        not null unique references public.companies (id) on delete cascade,
  wisi_score    numeric     not null default 0,
  last_updated  timestamptz not null default now()
);

comment on table public.sentiment_scores is 'Weighted Insider Sentiment Index (WISI) per company.';

create table if not exists public.watchlists (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  company_id  uuid        not null references public.companies (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint watchlists_user_company_key unique (user_id, company_id)
);

comment on table public.watchlists is 'Companies saved by each user.';

-- 3. Indexes ------------------------------------------------------------------

-- Explicitly requested secondary indexes.
create index if not exists insider_transactions_filing_date_idx
  on public.insider_transactions (filing_date desc);
create index if not exists insider_transactions_transaction_code_idx
  on public.insider_transactions (transaction_code);

-- Composite index for "latest filings for company X" (detail screen, WISI).
create index if not exists insider_transactions_company_filing_date_idx
  on public.insider_transactions (company_id, filing_date desc);

-- Foreign-key helper index (the unique (user_id, company_id) index already
-- covers lookups by user_id).
create index if not exists watchlists_company_id_idx
  on public.watchlists (company_id);

-- 4. Row Level Security -------------------------------------------------------

alter table public.companies            enable row level security;
alter table public.insider_transactions enable row level security;
alter table public.sentiment_scores     enable row level security;
alter table public.watchlists           enable row level security;

-- Public, read-only market data.
drop policy if exists "Companies are publicly readable" on public.companies;
create policy "Companies are publicly readable"
  on public.companies for select
  to anon, authenticated
  using (true);

drop policy if exists "Insider transactions are publicly readable" on public.insider_transactions;
create policy "Insider transactions are publicly readable"
  on public.insider_transactions for select
  to anon, authenticated
  using (true);

drop policy if exists "Sentiment scores are publicly readable" on public.sentiment_scores;
create policy "Sentiment scores are publicly readable"
  on public.sentiment_scores for select
  to anon, authenticated
  using (true);

-- Owner-only watchlists. `(select auth.uid())` is evaluated once per query
-- instead of once per row (Supabase performance recommendation).
drop policy if exists "Users can read their own watchlist" on public.watchlists;
create policy "Users can read their own watchlist"
  on public.watchlists for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add to their own watchlist" on public.watchlists;
create policy "Users can add to their own watchlist"
  on public.watchlists for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove from their own watchlist" on public.watchlists;
create policy "Users can remove from their own watchlist"
  on public.watchlists for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- 5. Privileges ---------------------------------------------------------------
-- Explicit grants so the Data API works even on projects where new tables are
-- not exposed automatically. RLS still decides which rows are visible.
grant usage on schema public to anon, authenticated, service_role;

grant select on public.companies, public.insider_transactions, public.sentiment_scores
  to anon, authenticated;
revoke insert, update, delete, truncate
  on public.companies, public.insider_transactions, public.sentiment_scores
  from anon, authenticated;

grant select, insert, delete on public.watchlists to authenticated;
revoke all on public.watchlists from anon;
revoke update, truncate on public.watchlists from authenticated;

grant all on public.companies, public.insider_transactions, public.sentiment_scores, public.watchlists
  to service_role;
