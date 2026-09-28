-- =============================================================================
-- Verification Playbook — Step 1: Database Trigger Audit
-- -----------------------------------------------------------------------------
-- Paste into the Supabase SQL Editor and run. It creates a throw-away company,
-- inserts / updates / deletes mock Form 4 transactions and shows how
-- sentiment_scores is recalculated automatically by the
-- on_insider_transaction_change trigger after every step. All mock rows are
-- removed at the end. Every row of the result should read passed = true.
--
-- Expected values (market cap $2B, later $4B):
--   CEO purchase   100,000 × $50 × 1.5 × (+1) = +7,500,000
--   Director sale   20,000 × $60 × 1.0 × (−1) = −1,200,000
--   Option award (code A) and a 120-day-old purchase do not count.
-- =============================================================================

create or replace function pg_temp.insiderpulse_trigger_audit()
returns table (
  step            text,
  wisi_score      numeric,
  expected_wisi   numeric,
  sentiment_index numeric,
  sentiment_label text,
  buy_count       integer,
  sell_count      integer,
  passed          boolean
)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_company uuid;
  v_ceo_tx  uuid;
begin
  -- Clean up leftovers from an interrupted earlier run.
  delete from public.companies c where c.cik = '9999999999';

  insert into public.companies (ticker, cik, company_name, market_cap)
  values ('ZZAUDIT', '9999999999', 'InsiderPulse Trigger Audit Co.', 2000000000)
  returning id into v_company;

  return query
    select '1. new company, no trades', s.wisi_score, 0::numeric, s.sentiment_index,
           s.sentiment_label, s.buy_count, s.sell_count, s.wisi_score = 0
      from public.sentiment_scores s where s.company_id = v_company;

  insert into public.insider_transactions
    (company_id, accession_number, filing_date, transaction_date,
     reporting_owner_name, owner_title, transaction_code, shares, price_per_share)
  values
    (v_company, '9999999999-26-000001', now(), current_date,
     'DOE JANE', 'Chief Executive Officer, Director', 'P', 100000, 50)
  returning id into v_ceo_tx;

  return query
    select '2. + CEO purchase $5.0M', s.wisi_score, 0.00375::numeric, s.sentiment_index,
           s.sentiment_label, s.buy_count, s.sell_count, s.wisi_score = 0.00375
      from public.sentiment_scores s where s.company_id = v_company;

  insert into public.insider_transactions
    (company_id, accession_number, filing_date, transaction_date,
     reporting_owner_name, owner_title, transaction_code, shares, price_per_share)
  values
    (v_company, '9999999999-26-000002', now(), current_date,
     'ROE RICHARD', 'Director', 'S', 20000, 60);

  return query
    select '3. + director sale $1.2M', s.wisi_score, 0.00315::numeric, s.sentiment_index,
           s.sentiment_label, s.buy_count, s.sell_count, s.wisi_score = 0.00315
      from public.sentiment_scores s where s.company_id = v_company;

  insert into public.insider_transactions
    (company_id, accession_number, filing_date, transaction_date,
     reporting_owner_name, owner_title, transaction_code, shares, price_per_share)
  values
    (v_company, '9999999999-26-000003', now(), current_date,
     'POE PAT', 'EVP, General Counsel', 'A', 50000, 0),
    (v_company, '9999999999-26-000004', now() - interval '120 days', current_date - 121,
     'LOE LEE', 'Chief Financial Officer', 'P', 10000, 40);

  return query
    select '4. + award & 120-day-old buy (ignored)', s.wisi_score, 0.00315::numeric, s.sentiment_index,
           s.sentiment_label, s.buy_count, s.sell_count, s.wisi_score = 0.00315
      from public.sentiment_scores s where s.company_id = v_company;

  update public.companies c set market_cap = 4000000000 where c.id = v_company;

  return query
    select '5. market cap -> $4B', s.wisi_score, 0.001575::numeric, s.sentiment_index,
           s.sentiment_label, s.buy_count, s.sell_count, s.wisi_score = 0.001575
      from public.sentiment_scores s where s.company_id = v_company;

  update public.insider_transactions t set shares = 200000 where t.id = v_ceo_tx;

  return query
    select '6. CEO purchase updated to $10M', s.wisi_score, 0.0034500::numeric, s.sentiment_index,
           s.sentiment_label, s.buy_count, s.sell_count, s.wisi_score = 0.00345
      from public.sentiment_scores s where s.company_id = v_company;

  delete from public.insider_transactions t where t.id = v_ceo_tx;

  return query
    select '7. CEO purchase deleted', s.wisi_score, (-0.0003)::numeric, s.sentiment_index,
           s.sentiment_label, s.buy_count, s.sell_count, s.wisi_score = -0.0003
      from public.sentiment_scores s where s.company_id = v_company;

  -- Remove all mock data (cascades to transactions and sentiment_scores).
  delete from public.companies c where c.id = v_company;
end;
$$;

select * from pg_temp.insiderpulse_trigger_audit();
