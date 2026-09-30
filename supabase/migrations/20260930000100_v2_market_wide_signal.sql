-- =============================================================================
-- InsiderPulse — v2: whole-market coverage and the explainable Insider Signal
-- -----------------------------------------------------------------------------
-- 1. Parser v2 columns on insider_transactions (Rule 10b5-1 plan trades,
--    sell-to-cover tax sales, the insider's CIK) plus two generated columns:
--      signal_direction  +1 discretionary open-market purchase
--                        -1 discretionary open-market sale
--                         0 everything else: awards, option exercises, gifts,
--                           tax withholding, 10b5-1 plan trades, sell-to-cover
--      stake_change_pct  buys: % increase of the holding; sales: % of the
--                        holding sold
-- 2. Bookkeeping for the market-wide pipeline: processed_filings, edgar_days,
--    ingestion_lease and service-only helper functions.
-- 3. The Insider Signal (0–100), stored in sentiment_scores next to the spec
--    WISI (which is unchanged). Only discretionary open-market trades of $10k+
--    in the last 90 days count:
--
--      points(insider) = base × role × size × conviction
--        base        +6 per buying insider, -3 per selling insider
--                    (insiders sell for many reasons, they buy for one)
--        role        CEO/CFO 1.5 · director 1.0 · officer / 10% owner 0.7 · other 0.5
--        size        log10(recency-weighted $ / 10,000) + 0.5, clamped to 0–4
--                    ($100k → 1.5 · $1M → 2.5 · $10M → 3.5)
--        recency     last 30 days ×1.0 · 31–60 days ×0.7 · 61–90 days ×0.4
--        conviction  buys growing the holding ≥50% ×1.4, ≥10% ×1.2;
--                    sales of ≥50% of the holding ×1.4, ≥20% ×1.2, <5% ×0.7
--      A trade reported by several members of a group (identical date, shares
--      and price) counts once.
--      cluster       +4 per additional buyer (max +12), -2 per additional seller (max -6)
--      score         clamp(50 + Σ points + cluster, 0, 100)
--      label         ≥75 Strong buying · ≥58 Buying · ≤25 Strong selling ·
--                    ≤42 Selling · otherwise Neutral · "No signal" without trades
--
-- 4. get_insider_activity charts discretionary trades and routine sales apart.
-- 5. The ingestion job runs every 2 minutes in "auto" mode.
-- =============================================================================

-- 1. Parser v2 columns --------------------------------------------------------

alter table public.insider_transactions
  add column if not exists insider_cik      varchar(10),
  add column if not exists is_10b5_1        boolean  not null default false,
  add column if not exists is_sell_to_cover boolean  not null default false,
  add column if not exists parser_version   smallint not null default 1;

-- Rows written by parser v1 lack the plan / tax flags, so they never count as
-- signals until they are re-parsed.
alter table public.insider_transactions
  add column if not exists signal_direction smallint generated always as (
    case
      when parser_version < 2 then 0
      when transaction_code = 'P' and not is_10b5_1 then 1
      when transaction_code = 'S' and not is_10b5_1 and not is_sell_to_cover then -1
      else 0
    end
  ) stored,
  add column if not exists stake_change_pct numeric generated always as (
    case
      when post_transaction_shares is null or shares <= 0 then null
      when transaction_code = 'P' and post_transaction_shares - shares > 0
        then round(least(shares / (post_transaction_shares - shares) * 100, 9999), 1)
      when transaction_code = 'S' and post_transaction_shares + shares > 0
        then round(shares / (post_transaction_shares + shares) * 100, 1)
      else null
    end
  ) stored;

comment on column public.insider_transactions.insider_cik      is 'CIK of the (first) reporting owner.';
comment on column public.insider_transactions.is_10b5_1        is 'Executed under a pre-scheduled Rule 10b5-1 trading plan.';
comment on column public.insider_transactions.is_sell_to_cover is 'Sale made to cover tax withholding on vesting / exercise.';
comment on column public.insider_transactions.parser_version   is 'Version of the fetch-sec-filings parser that wrote the row.';
comment on column public.insider_transactions.signal_direction is '+1 discretionary open-market buy, -1 discretionary open-market sale, 0 routine / other.';
comment on column public.insider_transactions.stake_change_pct is 'Buys: % increase of the holding. Sales: % of the holding sold.';

-- "Key trades" feed, biggest-buys carousel and signal calculations.
create index if not exists insider_transactions_signal_filing_date_idx
  on public.insider_transactions (filing_date desc)
  where signal_direction <> 0;
create index if not exists insider_transactions_parser_version_idx
  on public.insider_transactions (parser_version)
  where parser_version < 2;

alter table public.companies
  add column if not exists market_cap_checked_at timestamptz;

comment on column public.companies.market_cap_checked_at is 'Last time fetch-sec-filings asked Finnhub for the market cap (found or not).';

-- 2. Market-wide ingestion bookkeeping -----------------------------------------

-- Every Form 4 the market-wide pipeline has looked at, so no filing is
-- downloaded twice. Rows with an older parser_version are processed again.
create table if not exists public.processed_filings (
  accession_number varchar(25) primary key,
  status           text        not null check (status in
                     ('stored', 'no_transactions', 'no_ticker', 'amendment', 'unparseable', 'missing')),
  issuer_cik       varchar(10),
  parser_version   smallint    not null,
  processed_at     timestamptz not null default now()
);

comment on table public.processed_filings is 'Form 4 filings inspected by the market-wide pipeline (internal bookkeeping).';

-- Backfill progress per EDGAR daily index.
create table if not exists public.edgar_days (
  day         date        primary key,
  status      text        not null check (status in ('partial', 'done', 'empty')),
  form4_count integer     not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.edgar_days is 'Backfill progress per EDGAR daily form index (internal bookkeeping).';

-- A single-row lease so overlapping scheduler runs never double the SEC load.
create table if not exists public.ingestion_lease (
  name       text        primary key,
  holder     text,
  expires_at timestamptz not null default '-infinity'
);

comment on table public.ingestion_lease is 'Mutual exclusion for fetch-sec-filings runs (internal bookkeeping).';

alter table public.processed_filings enable row level security;
alter table public.edgar_days        enable row level security;
alter table public.ingestion_lease   enable row level security;
revoke all on public.processed_filings, public.edgar_days, public.ingestion_lease from anon, authenticated;
grant all on public.processed_filings, public.edgar_days, public.ingestion_lease to service_role;

create or replace function public.claim_ingestion_lease(p_name text, p_holder text, p_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.ingestion_lease (name) values (p_name) on conflict (name) do nothing;
  update public.ingestion_lease
     set holder = p_holder,
         expires_at = now() + make_interval(secs => greatest(1, p_seconds))
   where name = p_name
     and (expires_at < now() or holder = p_holder);
  return found;
end;
$$;

create or replace function public.release_ingestion_lease(p_name text, p_holder text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.ingestion_lease
     set holder = null, expires_at = '-infinity'
   where name = p_name and holder = p_holder;
$$;

-- The subset of accession numbers not yet processed by parser >= p_min_version.
create or replace function public.filter_unprocessed_filings(p_accessions text[], p_min_version smallint)
returns table (accession_number text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct a.acc
    from unnest(p_accessions) as a(acc)
   where not exists (select 1 from public.processed_filings pf
                      where pf.accession_number = a.acc and pf.parser_version >= p_min_version)
     and not exists (select 1 from public.insider_transactions t
                      where t.accession_number = a.acc and t.parser_version >= p_min_version);
$$;

-- Rows written by an older parser that the current parser has not revisited.
create or replace function public.reparse_candidates(p_limit integer, p_min_version smallint)
returns table (accession_number varchar, cik varchar)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.accession_number, c.cik
    from public.insider_transactions t
    join public.companies c on c.id = t.company_id
   where t.parser_version < p_min_version
     and not exists (select 1 from public.processed_filings pf
                      where pf.accession_number = t.accession_number and pf.parser_version >= p_min_version)
   order by t.filing_date desc, t.accession_number
   limit greatest(0, least(coalesce(p_limit, 100), 1000));
$$;

-- Creates missing issuers (skipping CIK or ticker collisions) and returns the
-- company row for every CIK in the input that exists afterwards.
create or replace function public.ensure_companies(p_companies jsonb)
returns table (id uuid, cik varchar, ticker varchar, company_name text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  insert into public.companies (ticker, cik, company_name)
  select distinct on (x.cik) x.ticker, x.cik, x.company_name
    from jsonb_to_recordset(coalesce(p_companies, '[]'::jsonb)) as x(cik text, ticker text, company_name text)
   where x.cik ~ '^[0-9]{10}$'
     and x.ticker ~ '^[A-Z0-9.-]{1,10}$'
     and coalesce(btrim(x.company_name), '') <> ''
   order by x.cik
  on conflict do nothing;

  return query
    select c.id, c.cik, c.ticker, c.company_name
      from public.companies c
     where c.cik in (select x.cik from jsonb_to_recordset(coalesce(p_companies, '[]'::jsonb)) as x(cik text));
end;
$$;

-- 3. Insider Signal ----------------------------------------------------------

create or replace function public.signal_recency_weight(days_ago integer)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when days_ago <= 30 then 1.0 when days_ago <= 60 then 0.7 else 0.4 end;
$$;

create or replace function public.signal_size_factor(weighted_value numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when weighted_value is null or weighted_value <= 0 then 0
    else round(least(4, greatest(0, log(10, weighted_value / 10000) + 0.5)), 2)
  end;
$$;

create or replace function public.signal_conviction(direction integer, stake_change_pct numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when stake_change_pct is null then 1.0
    when direction > 0 then
      case when stake_change_pct >= 50 then 1.4 when stake_change_pct >= 10 then 1.2 else 1.0 end
    else
      case when stake_change_pct >= 50 then 1.4 when stake_change_pct >= 20 then 1.2
           when stake_change_pct < 5 then 0.7 else 1.0 end
  end;
$$;

create or replace function public.signal_label(score numeric, insiders integer)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(insiders, 0) = 0 then 'No signal'
    when score >= 75 then 'Strong buying'
    when score >= 58 then 'Buying'
    when score <= 25 then 'Strong selling'
    when score <= 42 then 'Selling'
    else 'Neutral'
  end;
$$;

-- One row per insider and direction: what they did in the window and the
-- points it contributes. The app renders this as "Why this score".
create or replace function public.company_signal_breakdown(target_company_id uuid, as_of date default null)
returns table (
  insider_key      text,
  insider_name     text,
  insider_title    text,
  direction        integer,
  trade_count      integer,
  shares           numeric,
  total_value      numeric,
  weighted_value   numeric,
  avg_price        numeric,
  stake_change_pct numeric,
  first_trade_date date,
  last_trade_date  date,
  role_weight      numeric,
  size_factor      numeric,
  conviction       numeric,
  points           numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select coalesce(as_of, current_date) as d
  ),
  raw as (
    select coalesce(nullif(t.insider_cik, ''), 'name:' || lower(btrim(t.reporting_owner_name))) as k,
           t.reporting_owner_name as name,
           t.owner_title          as title,
           t.signal_direction::integer as dir,
           t.shares               as sh,
           t.price_per_share      as price,
           t.shares * t.price_per_share as val,
           t.stake_change_pct     as pct,
           t.transaction_date     as tdate,
           t.filing_date          as fdate,
           public.signal_recency_weight(p.d - t.transaction_date) as recency
      from public.insider_transactions t
     cross join params p
     where t.company_id = target_company_id
       and t.signal_direction <> 0
       and t.shares * t.price_per_share >= 10000
       and t.transaction_date >  p.d - 90
       and t.transaction_date <= p.d
  ),
  -- Members of a group (a fund, its general partner, a director who controls
  -- it) each file their own Form 4 for the same trade: count it once, for the
  -- highest-weighted filer.
  trades as (
    select distinct on (r.tdate, r.dir, r.sh, r.price) r.*
      from raw r
     order by r.tdate, r.dir, r.sh, r.price, public.wisi_role_multiplier(r.title) desc, r.fdate, r.k
  ),
  grouped as (
    select g.k, g.dir,
           (array_agg(g.name  order by g.fdate desc))[1] as name,
           (array_agg(g.title order by g.fdate desc))[1] as title,
           count(*)::integer     as n,
           sum(g.sh)             as sh,
           sum(g.val)            as val,
           sum(g.val * g.recency) as wval,
           max(g.pct)            as pct,
           min(g.tdate)          as first_date,
           max(g.tdate)          as last_date
      from trades g
     group by g.k, g.dir
  ),
  scored as (
    select g.*,
           public.wisi_role_multiplier(g.title)      as role,
           public.signal_size_factor(g.wval)         as size,
           public.signal_conviction(g.dir, g.pct)    as conv
      from grouped g
  )
  select s.k, s.name, s.title, s.dir, s.n, s.sh,
         round(s.val, 2), round(s.wval, 2), round(s.val / nullif(s.sh, 0), 4),
         s.pct, s.first_date, s.last_date, s.role, s.size, s.conv,
         round((case when s.dir > 0 then 6 else -3 end) * s.role * s.size * s.conv, 1)
    from scored s
   order by abs((case when s.dir > 0 then 6 else -3 end) * s.role * s.size * s.conv) desc, s.val desc;
$$;

comment on function public.company_signal_breakdown(uuid, date) is
  'Per-insider contributions to the Insider Signal (discretionary open-market trades of $10k+, last 90 days).';

create or replace function public.company_signal(target_company_id uuid, as_of date default null)
returns table (
  score           numeric,
  label           text,
  buyers          integer,
  sellers         integer,
  buy_value       numeric,
  sell_value      numeric,
  buy_points      numeric,
  sell_points     numeric,
  cluster_points  numeric,
  last_trade_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select * from public.company_signal_breakdown(target_company_id, as_of)
  ),
  agg as (
    select (count(*) filter (where b.direction > 0))::integer               as buyers,
           (count(*) filter (where b.direction < 0))::integer               as sellers,
           coalesce(sum(b.total_value) filter (where b.direction > 0), 0)  as buy_value,
           coalesce(sum(b.total_value) filter (where b.direction < 0), 0)  as sell_value,
           coalesce(sum(b.points)      filter (where b.direction > 0), 0)  as buy_points,
           coalesce(sum(b.points)      filter (where b.direction < 0), 0)  as sell_points,
           max(b.last_trade_date)                                          as last_trade_date
      from b
  ),
  c as (
    select a.*,
           (least(12, 4 * greatest(0, a.buyers - 1)) - least(6, 2 * greatest(0, a.sellers - 1)))::numeric
             as cluster_points
      from agg a
  )
  select round(greatest(0, least(100, 50 + c.buy_points + c.sell_points + c.cluster_points)), 1),
         public.signal_label(greatest(0, least(100, 50 + c.buy_points + c.sell_points + c.cluster_points)),
                             c.buyers + c.sellers),
         c.buyers, c.sellers, c.buy_value, c.sell_value, c.buy_points, c.sell_points,
         c.cluster_points, c.last_trade_date
    from c;
$$;

comment on function public.company_signal(uuid, date) is
  'Insider Signal (0-100) for one company: 50 + per-insider points + cluster bonus.';

alter table public.sentiment_scores
  add column if not exists signal_score           numeric not null default 50,
  add column if not exists signal_label           text    not null default 'No signal',
  add column if not exists signal_buyers          integer not null default 0,
  add column if not exists signal_sellers         integer not null default 0,
  add column if not exists signal_buy_value       numeric not null default 0,
  add column if not exists signal_sell_value      numeric not null default 0,
  add column if not exists signal_cluster_points  numeric not null default 0,
  add column if not exists signal_last_trade_date date;

comment on column public.sentiment_scores.signal_score is 'Insider Signal 0-100 (see company_signal).';
comment on column public.sentiment_scores.signal_label is 'Strong buying / Buying / Neutral / Selling / Strong selling / No signal.';

create index if not exists sentiment_scores_signal_score_idx
  on public.sentiment_scores (signal_score desc);

-- The WISI maths is unchanged; the same recalculation now also stores the signal.
create or replace function public.recalculate_wisi_score(target_company_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_market_cap   numeric;
  v_weighted_sum numeric;
  v_buy_count    integer;
  v_sell_count   integer;
  v_wisi         numeric;
  v_signal       record;
begin
  if target_company_id is null then
    return null;
  end if;

  -- Serialise recalculations per company so concurrent writers cannot
  -- overwrite each other with a stale aggregate.
  perform pg_advisory_xact_lock(hashtextextended('wisi:' || target_company_id::text, 0));

  select c.market_cap
    into v_market_cap
    from public.companies c
   where c.id = target_company_id;

  if not found then
    -- The company is gone (e.g. a cascading delete is in progress).
    return null;
  end if;

  select coalesce(sum(  t.shares
                      * t.price_per_share
                      * public.wisi_role_multiplier(t.owner_title)
                      * public.wisi_direction_factor(t.transaction_code)), 0),
         count(*) filter (where public.wisi_direction_factor(t.transaction_code) = 1),
         count(*) filter (where public.wisi_direction_factor(t.transaction_code) = -1)
    into v_weighted_sum, v_buy_count, v_sell_count
    from public.insider_transactions t
   where t.company_id = target_company_id
     and t.filing_date >= now() - interval '90 days';

  v_wisi := v_weighted_sum / coalesce(nullif(v_market_cap, 0), 1000000000);

  select * into v_signal from public.company_signal(target_company_id);

  insert into public.sentiment_scores
         (company_id, wisi_score, net_weighted_value, buy_count, sell_count, last_updated,
          signal_score, signal_label, signal_buyers, signal_sellers, signal_buy_value,
          signal_sell_value, signal_cluster_points, signal_last_trade_date)
  values (target_company_id, v_wisi, v_weighted_sum, v_buy_count, v_sell_count, now(),
          v_signal.score, v_signal.label, v_signal.buyers, v_signal.sellers, v_signal.buy_value,
          v_signal.sell_value, v_signal.cluster_points, v_signal.last_trade_date)
  on conflict (company_id) do update
     set wisi_score             = excluded.wisi_score,
         net_weighted_value     = excluded.net_weighted_value,
         buy_count              = excluded.buy_count,
         sell_count             = excluded.sell_count,
         last_updated           = excluded.last_updated,
         signal_score           = excluded.signal_score,
         signal_label           = excluded.signal_label,
         signal_buyers          = excluded.signal_buyers,
         signal_sellers         = excluded.signal_sellers,
         signal_buy_value       = excluded.signal_buy_value,
         signal_sell_value      = excluded.signal_sell_value,
         signal_cluster_points  = excluded.signal_cluster_points,
         signal_last_trade_date = excluded.signal_last_trade_date;

  return v_wisi;
end;
$$;

-- Companies worth a Finnhub market-cap lookup: recent signal activity first.
create or replace function public.market_cap_refresh_candidates(p_limit integer)
returns table (id uuid, ticker varchar)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.ticker
    from public.companies c
    join public.sentiment_scores s on s.company_id = c.id
   where s.signal_buyers + s.signal_sellers > 0
     and (c.market_cap_checked_at is null or c.market_cap_checked_at < now() - interval '7 days')
     and (c.market_cap_updated_at is null or c.market_cap_updated_at < now() - interval '7 days')
   order by s.signal_last_trade_date desc nulls last, c.id
   limit greatest(0, least(coalesce(p_limit, 10), 100));
$$;

-- 4. Chart data ----------------------------------------------------------------
drop function if exists public.get_insider_activity(uuid, integer);
create function public.get_insider_activity(target_company_id uuid, months integer default 12)
returns table (
  period_start       date,
  buy_value          numeric,
  sell_value         numeric,
  buy_shares         numeric,
  sell_shares        numeric,
  buy_count          integer,
  sell_count         integer,
  routine_sell_value numeric,
  routine_sell_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select date_trunc('month', now())::date            as current_month,
           greatest(1, least(coalesce(months, 12), 60)) as n
  ),
  periods as (
    select (p.current_month - make_interval(months => g))::date as period_start
      from params p,
           generate_series(0, p.n - 1) as g
  )
  select p.period_start,
         coalesce(sum(t.total_value) filter (where t.signal_direction = 1), 0),
         coalesce(sum(t.total_value) filter (where t.signal_direction = -1), 0),
         coalesce(sum(t.shares)      filter (where t.signal_direction = 1), 0),
         coalesce(sum(t.shares)      filter (where t.signal_direction = -1), 0),
         (count(t.id) filter (where t.signal_direction = 1))::integer,
         (count(t.id) filter (where t.signal_direction = -1))::integer,
         coalesce(sum(t.total_value) filter (where t.transaction_code = 'S' and t.signal_direction = 0), 0),
         (count(t.id) filter (where t.transaction_code = 'S' and t.signal_direction = 0))::integer
    from periods p
    left join public.insider_transactions t
      on t.company_id = target_company_id
     and t.transaction_code in ('P', 'S')
     and t.transaction_date >= p.period_start
     and t.transaction_date <  (p.period_start + interval '1 month')
   group by p.period_start
   order by p.period_start;
$$;

comment on function public.get_insider_activity(uuid, integer) is
  'Monthly discretionary insider buys vs. sells (plus routine plan / tax sales) for a company.';

-- 5. Privileges ------------------------------------------------------------------
revoke execute on function public.claim_ingestion_lease(text, text, integer)         from public, anon, authenticated;
revoke execute on function public.release_ingestion_lease(text, text)                from public, anon, authenticated;
revoke execute on function public.filter_unprocessed_filings(text[], smallint)       from public, anon, authenticated;
revoke execute on function public.reparse_candidates(integer, smallint)              from public, anon, authenticated;
revoke execute on function public.ensure_companies(jsonb)                            from public, anon, authenticated;
revoke execute on function public.market_cap_refresh_candidates(integer)             from public, anon, authenticated;
grant  execute on function public.claim_ingestion_lease(text, text, integer)         to service_role;
grant  execute on function public.release_ingestion_lease(text, text)                to service_role;
grant  execute on function public.filter_unprocessed_filings(text[], smallint)       to service_role;
grant  execute on function public.reparse_candidates(integer, smallint)              to service_role;
grant  execute on function public.ensure_companies(jsonb)                            to service_role;
grant  execute on function public.market_cap_refresh_candidates(integer)             to service_role;

grant execute on function public.company_signal_breakdown(uuid, date) to anon, authenticated, service_role;
grant execute on function public.company_signal(uuid, date)           to anon, authenticated, service_role;
grant execute on function public.get_insider_activity(uuid, integer)  to anon, authenticated, service_role;
revoke execute on function public.recalculate_wisi_score(uuid)        from public, anon, authenticated;
grant  execute on function public.recalculate_wisi_score(uuid)        to service_role;

-- 6. Schedule ----------------------------------------------------------------------
-- "auto": new filings from the EDGAR latest-filings feed, then re-parsing of
-- v1 rows, then the 90-day daily-index backfill, then market caps.
do $outer$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_cron / pg_net not installed; skipping job scheduling.';
    return;
  end if;

  perform cron.schedule(
    'insiderpulse-fetch-sec-filings',
    '*/2 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
                 where name = 'insiderpulse_project_url' limit 1)
               || '/functions/v1/fetch-sec-filings',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets
                               where name = 'insiderpulse_ingest_secret' limit 1)
        ),
        body := jsonb_build_object('mode', 'auto'),
        timeout_milliseconds := 150000
      )
      where exists (select 1 from vault.decrypted_secrets where name = 'insiderpulse_project_url')
        and exists (select 1 from vault.decrypted_secrets where name = 'insiderpulse_ingest_secret');
    $job$
  );
exception
  when others then
    raise warning 'InsiderPulse job scheduling skipped: %', sqlerrm;
end;
$outer$;

-- 7. Backfill the new score columns -------------------------------------------------
select public.recalculate_all_wisi_scores();

notify pgrst, 'reload schema';
