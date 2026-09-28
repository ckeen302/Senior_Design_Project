-- =============================================================================
-- InsiderPulse — Seed: initial tracked companies
-- -----------------------------------------------------------------------------
-- The scheduled fetch-sec-filings run ingests Form 4 filings for every row in
-- public.companies. CIKs come from https://www.sec.gov/files/company_tickers.json.
-- Market caps start at the 1B default and are refreshed from Finnhub by the
-- Edge Function (when FINNHUB_API_KEY is configured).
-- More companies are added on demand when users track a new ticker.
-- =============================================================================

insert into public.companies (ticker, cik, company_name)
values
  ('AAPL',  '0000320193', 'Apple Inc.'),
  ('MSFT',  '0000789019', 'Microsoft Corporation'),
  ('NVDA',  '0001045810', 'NVIDIA Corporation'),
  ('AMZN',  '0001018724', 'Amazon.com, Inc.'),
  ('GOOGL', '0001652044', 'Alphabet Inc.'),
  ('META',  '0001326801', 'Meta Platforms, Inc.'),
  ('TSLA',  '0001318605', 'Tesla, Inc.'),
  ('AVGO',  '0001730168', 'Broadcom Inc.'),
  ('JPM',   '0000019617', 'JPMorgan Chase & Co.'),
  ('V',     '0001403161', 'Visa Inc.'),
  ('WMT',   '0000104169', 'Walmart Inc.'),
  ('JNJ',   '0000200406', 'Johnson & Johnson'),
  ('NFLX',  '0001065280', 'Netflix, Inc.'),
  ('AMD',   '0000002488', 'Advanced Micro Devices, Inc.'),
  ('DIS',   '0001744489', 'The Walt Disney Company'),
  ('KO',    '0000021344', 'The Coca-Cola Company'),
  ('PLTR',  '0001321655', 'Palantir Technologies Inc.'),
  ('COIN',  '0001679788', 'Coinbase Global, Inc.'),
  ('INTC',  '0000050863', 'Intel Corporation'),
  ('CRM',   '0001108524', 'Salesforce, Inc.'),
  ('ORCL',  '0001341439', 'Oracle Corporation')
on conflict do nothing;
