-- =============================================================================
-- InsiderPulse — v2.2: data-quality guards and upkeep
-- -----------------------------------------------------------------------------
-- 1. price_suspect: some filers type the total dollar amount into the price
--    field (e.g. 40,000,000 shares "at $40,000,000" = $1.6 quadrillion). A P/S
--    trade is flagged when it is worth more than $20B, more than half of the
--    company's market cap, or its price is 20x off the median price of the
--    company's other trades within 45 days. Flagged trades never count
--    (Insider Signal, spec WISI, key-trade feeds, alerts).
-- 2. Transaction dates after the filing date (typos such as 2036) are clamped
--    to the filing date; parser v3 does the same for new filings.
-- 3. Scoring serialises on a row lock of the company instead of an advisory
--    lock, so re-scoring every company in one transaction (the nightly job)
--    does not grow the shared lock table with the number of companies.
-- 4. Upkeep: pg_cron history purge, "pending" backfill days, trigram indexes
--    for company search, an unused index dropped, explicit deny-all policies
--    on internal tables.
-- =============================================================================

-- 1. Suspect prices ------------------------------------------------------------

alter table public.insider_transactions
  add column if not exists price_suspect boolean not null default false;

comment on column public.insider_transactions.price_suspect is
  'The filing''s price looks wrong (trade worth > $20B, > half the company, or 20x off the company''s other trades); never counts.';

drop index if exists public.insider_transactions_signal_filing_date_idx;
alter table public.insider_transactions drop column if exists signal_direction;
alter table public.insider_transactions
  add column signal_direction smallint generated always as (
    case
      when parser_version < 2 or price_suspect then 0
      when transaction_code = 'P' and not is_10b5_1 then 1
      when transaction_code = 'S' and not is_10b5_1 and not is_sell_to_cover and not is_option_sale then -1
      else 0
    end
  ) stored;

comment on column public.insider_transactions.signal_direction is
  '+1 discretionary open-market buy, -1 discretionary open-market sale, 0 routine / other / suspect price.';

create index if not exists insider_transactions_signal_filing_date_idx
  on public.insider_transactions (filing_date desc)
  where signal_direction <> 0;

-- Re-evaluates price_suspect for one company's recent open-market trades.
-- Returns the number of rows whose flag changed.
create or replace function public.flag_suspect_prices(target_company_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cap     numeric;
  v_changed integer;
begin
  select case when c.market_cap_updated_at is not null then c.market_cap end
    into v_cap
    from public.companies c
   where c.id = target_company_id;

  with trades as (
    select t.id, t.shares, t.price_per_share, t.transaction_date, t.price_suspect
      from public.insider_transactions t
     where t.company_id = target_company_id
       and t.transaction_code in ('P', 'S')
       and t.shares > 0
       and t.price_per_share > 0
       and t.transaction_date > current_date - 400
  ),
  judged as (
    select tr.id,
           tr.price_suspect as was_suspect,
           (   tr.shares * tr.price_per_share > 20000000000
            or (v_cap is not null and tr.shares * tr.price_per_share > v_cap * 0.5)
            or coalesce((
                 select case when count(*) >= 2 then
                          greatest(tr.price_per_share::float8 / percentile_cont(0.5) within group (order by o.price_per_share::float8),
                                   percentile_cont(0.5) within group (order by o.price_per_share::float8) / tr.price_per_share::float8) > 20
                        end
                   from trades o
                  where o.id <> tr.id
                    and o.transaction_date between tr.transaction_date - 45 and tr.transaction_date + 45
               ), false)
           ) as now_suspect
      from trades tr
  )
  update public.insider_transactions t
     set price_suspect = j.now_suspect
    from judged j
   where t.id = j.id
     and j.was_suspect is distinct from j.now_suspect;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

comment on function public.flag_suspect_prices(uuid) is
  'Flags open-market trades whose filed price is implausible (see price_suspect).';

-- 2. Typo dates --------------------------------------------------------------------

update public.insider_transactions
   set transaction_date = (filing_date at time zone 'America/New_York')::date
 where transaction_date > (filing_date at time zone 'America/New_York')::date + 2;

-- 3. Scoring: row lock, suspect prices excluded --------------------------------------

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
  -- overwrite each other with a stale aggregate. A row lock (unlike an
  -- advisory lock) takes no shared lock-table slot, however many companies
  -- one transaction re-scores. FOR NO KEY UPDATE does not block inserts of
  -- new transactions (their foreign-key checks take KEY SHARE).
  select c.market_cap
    into v_market_cap
    from public.companies c
   where c.id = target_company_id
     for no key update;

  if not found then
    -- The company is gone (e.g. a cascading delete is in progress).
    return null;
  end if;

  perform public.flag_suspect_prices(target_company_id);

  select coalesce(sum(  t.shares
                      * t.price_per_share
                      * public.wisi_role_multiplier(t.owner_title)
                      * public.wisi_direction_factor(t.transaction_code)), 0),
         count(*) filter (where public.wisi_direction_factor(t.transaction_code) = 1),
         count(*) filter (where public.wisi_direction_factor(t.transaction_code) = -1)
    into v_weighted_sum, v_buy_count, v_sell_count
    from public.insider_transactions t
   where t.company_id = target_company_id
     and t.filing_date >= now() - interval '90 days'
     and not t.price_suspect;

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

-- Re-score only when a column that feeds the scores changes: updates that set
-- nothing but price_suspect (made by the scoring itself) must not re-fire it.
drop trigger if exists on_insider_transaction_change on public.insider_transactions;
create trigger on_insider_transaction_change
  after insert or delete
     or update of company_id, filing_date, transaction_date, reporting_owner_name, insider_cik, owner_title,
                  transaction_code, shares, price_per_share, post_transaction_shares, is_10b5_1,
                  is_sell_to_cover, is_option_sale, parser_version
  on public.insider_transactions
  for each row execute function public.handle_insider_transaction_change();

revoke execute on function public.flag_suspect_prices(uuid) from public, anon, authenticated;
grant  execute on function public.flag_suspect_prices(uuid) to service_role;
revoke execute on function public.recalculate_wisi_score(uuid) from public, anon, authenticated;
grant  execute on function public.recalculate_wisi_score(uuid) to service_role;

-- 4. Upkeep ------------------------------------------------------------------------

-- Backfill days whose index is not published yet are retried later, not every run.
alter table public.edgar_days drop constraint if exists edgar_days_status_check;
alter table public.edgar_days
  add constraint edgar_days_status_check check (status in ('pending', 'partial', 'done', 'empty'));

-- The v1 -> v2 re-parse is finished; nothing reads this index any more.
drop index if exists public.insider_transactions_parser_version_idx;

-- Company search matches "%term%" on names and tickers.
create extension if not exists pg_trgm with schema extensions;
create index if not exists companies_company_name_trgm_idx
  on public.companies using gin (company_name extensions.gin_trgm_ops);
create index if not exists companies_ticker_trgm_idx
  on public.companies using gin (ticker extensions.gin_trgm_ops);

-- Internal bookkeeping tables: grants are already revoked; make the intent explicit.
do $$
declare
  t text;
begin
  foreach t in array array['ingestion_skipped_filings', 'processed_filings', 'edgar_days', 'ingestion_lease'] loop
    execute format('drop policy if exists "Internal table: no Data API access" on public.%I', t);
    execute format(
      'create policy "Internal table: no Data API access" on public.%I for all to anon, authenticated using (false) with check (false)',
      t
    );
  end loop;
end;
$$;

-- pg_cron keeps a row per run (720 a day for the ingestion job): keep a week.
do $outer$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping history purge job.';
    return;
  end if;
  perform cron.schedule(
    'insiderpulse-purge-cron-history',
    '41 4 * * *',
    $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$
  );
exception
  when others then
    raise warning 'InsiderPulse purge job scheduling skipped: %', sqlerrm;
end;
$outer$;

-- Flag existing suspect prices and re-score everything.
select public.recalculate_all_wisi_scores();

notify pgrst, 'reload schema';
