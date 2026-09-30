-- =============================================================================
-- InsiderPulse — v2.3: suspect-price refinements
-- -----------------------------------------------------------------------------
-- 1. A trade over $500M at a company without a known market cap is held back
--    (typically an ADS price multiplied by an ordinary-share count) until the
--    market cap arrives and the rules can judge it.
-- 2. Market caps are looked up for the companies with the largest open-market
--    trades first, including trades outside the 90-day scoring window.
-- 3. The buy/sell chart ignores suspect prices in every series (a mistyped
--    sale showed up as trillions of dollars of "routine" selling).
-- =============================================================================

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
            or (v_cap is null and tr.shares * tr.price_per_share > 500000000)
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
  'Flags open-market trades whose filed price is implausible: > $20B, > half the market cap (> $500M when the cap is unknown), or 20x off the company''s other trades.';

create or replace function public.market_cap_refresh_candidates(p_limit integer)
returns table (id uuid, ticker varchar)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.ticker
    from public.companies c
    cross join lateral (
      select max(t.shares * t.price_per_share) as biggest
        from public.insider_transactions t
       where t.company_id = c.id
         and t.transaction_code in ('P', 'S')
         and t.transaction_date > current_date - 400
    ) m
   where m.biggest >= 10000
     and (c.market_cap_checked_at is null or c.market_cap_checked_at < now() - interval '7 days')
     and (c.market_cap_updated_at is null or c.market_cap_updated_at < now() - interval '7 days')
   order by m.biggest desc, c.id
   limit greatest(0, least(coalesce(p_limit, 10), 100));
$$;

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
     and not t.price_suspect
     and t.transaction_date >= p.period_start
     and t.transaction_date <  (p.period_start + interval '1 month')
   group by p.period_start
   order by p.period_start;
$$;

comment on function public.get_insider_activity(uuid, integer) is
  'Monthly discretionary insider buys vs. sells (plus routine plan / tax / option sales) for a company; suspect prices excluded.';

revoke execute on function public.flag_suspect_prices(uuid) from public, anon, authenticated;
grant  execute on function public.flag_suspect_prices(uuid) to service_role;
revoke execute on function public.market_cap_refresh_candidates(integer) from public, anon, authenticated;
grant  execute on function public.market_cap_refresh_candidates(integer) to service_role;
grant  execute on function public.get_insider_activity(uuid, integer) to anon, authenticated, service_role;

select public.recalculate_all_wisi_scores();

notify pgrst, 'reload schema';
