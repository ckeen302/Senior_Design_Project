-- =============================================================================
-- InsiderPulse — Phase 5: Realtime streaming & chart data
-- =============================================================================

-- 1. Realtime -----------------------------------------------------------------
-- Stream new filings (feed) and score changes (detail screen gauge) to clients
-- through Supabase Realtime. RLS still applies to what each client receives.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime not found; skipping realtime setup.';
    return;
  end if;

  foreach t in array array['insider_transactions', 'sentiment_scores'] loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- 2. Buy vs. sell history for the company detail chart -----------------------
-- Returns one row per calendar month (oldest first, current month last),
-- including months without activity, so the chart has a continuous x-axis.
create or replace function public.get_insider_activity(target_company_id uuid, months integer default 12)
returns table (
  period_start date,
  buy_value    numeric,
  sell_value   numeric,
  buy_shares   numeric,
  sell_shares  numeric,
  buy_count    integer,
  sell_count   integer
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
         coalesce(sum(t.total_value) filter (where t.transaction_code = 'P'), 0) as buy_value,
         coalesce(sum(t.total_value) filter (where t.transaction_code = 'S'), 0) as sell_value,
         coalesce(sum(t.shares)      filter (where t.transaction_code = 'P'), 0) as buy_shares,
         coalesce(sum(t.shares)      filter (where t.transaction_code = 'S'), 0) as sell_shares,
         (count(t.id) filter (where t.transaction_code = 'P'))::integer          as buy_count,
         (count(t.id) filter (where t.transaction_code = 'S'))::integer          as sell_count
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
  'Monthly open-market insider buy vs. sell totals for a company (chart data).';

grant execute on function public.get_insider_activity(uuid, integer) to anon, authenticated, service_role;
