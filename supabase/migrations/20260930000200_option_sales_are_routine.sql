-- =============================================================================
-- InsiderPulse — v2.1: option exercise-and-sell sales are routine
-- -----------------------------------------------------------------------------
-- Executives routinely exercise expiring stock options and sell the shares the
-- same day. It is legally discretionary, but it is compensation being cashed
-- out rather than a view on the stock, and it made large caps look like
-- "Strong selling". Parser v3 flags a sale as an option sale when the same
-- filing reports exercising (almost) as many shares as were sold.
-- =============================================================================

alter table public.insider_transactions
  add column if not exists is_option_sale boolean not null default false;

comment on column public.insider_transactions.is_option_sale is
  'Sale of shares just acquired by exercising options (exercise-and-sell).';

-- Recreate the generated signal column with the new exclusion (PostgreSQL 16
-- cannot change a generation expression in place).
drop index if exists public.insider_transactions_signal_filing_date_idx;
alter table public.insider_transactions drop column if exists signal_direction;
alter table public.insider_transactions
  add column signal_direction smallint generated always as (
    case
      when parser_version < 2 then 0
      when transaction_code = 'P' and not is_10b5_1 then 1
      when transaction_code = 'S' and not is_10b5_1 and not is_sell_to_cover and not is_option_sale then -1
      else 0
    end
  ) stored;

comment on column public.insider_transactions.signal_direction is
  '+1 discretionary open-market buy, -1 discretionary open-market sale, 0 routine / other (awards, exercises, gifts, tax, 10b5-1 plan, sell-to-cover, option sales).';

create index if not exists insider_transactions_signal_filing_date_idx
  on public.insider_transactions (filing_date desc)
  where signal_direction <> 0;

-- Rows to upgrade: everything from parser v1, and v2 discretionary sales
-- (the only v2 rows that parser v3 can classify differently).
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
   where (t.parser_version < 2 or (t.parser_version < p_min_version and t.signal_direction = -1))
     and not exists (select 1 from public.processed_filings pf
                      where pf.accession_number = t.accession_number and pf.parser_version >= p_min_version)
   order by t.filing_date desc, t.accession_number
   limit greatest(0, least(coalesce(p_limit, 100), 1000));
$$;

revoke execute on function public.reparse_candidates(integer, smallint) from public, anon, authenticated;
grant  execute on function public.reparse_candidates(integer, smallint) to service_role;

-- Display fix: names imported from EDGAR's all-caps list read "Dick'S"; parser
-- v3 writes "Dick's" for new companies.
update public.companies
   set company_name = regexp_replace(company_name, '([A-Za-z])''S\M', '\1''s', 'g')
 where company_name ~ '[A-Za-z]''S\M';

select public.recalculate_all_wisi_scores();

notify pgrst, 'reload schema';
