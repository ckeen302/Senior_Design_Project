-- =============================================================================
-- InsiderPulse — automated database checks
-- -----------------------------------------------------------------------------
-- Run with psql (ON_ERROR_STOP=1), e.g. via scripts/verify-db.sh — it uses the
-- psql \ir meta-command. Any failed assertion raises an exception. Everything runs inside a transaction that is
-- rolled back, so no data is left behind.
-- =============================================================================

begin;

-- 1. Role multipliers ---------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('Chief Executive Officer',               1.5),
      ('President and CEO',                     1.5),
      ('Co-CEO',                                1.5),
      ('Chief Financial Officer & Treasurer',   1.5),
      ('EVP and CFO',                           1.5),
      ('Principal Financial Officer',           1.5),
      ('Chairman & Chief Executive Officer',    1.5),
      ('Director',                              1.0),
      ('Chairman of the Board',                 1.0),
      ('Executive Chair',                       1.0),
      ('President, Director',                   1.0),
      ('10% Owner',                             0.7),
      ('10 percent owner',                      0.7),
      ('Chief Operating Officer',               0.7),
      ('EVP, General Counsel',                  0.7),
      ('SVP, Worldwide Sales',                  0.7),
      ('Senior Vice President, Retail',         0.7),
      ('Principal Accounting Officer',          0.7),
      ('Head of Retail, Officer',               0.7),
      ('Member of 13(d) group',                 0.5),
      ('',                                      0.5),
      (null,                                    0.5)
    ) as t(title, expected)
  loop
    if public.wisi_role_multiplier(c.title) <> c.expected then
      raise exception 'wisi_role_multiplier(%) = %, expected %',
        c.title, public.wisi_role_multiplier(c.title), c.expected;
    end if;
  end loop;
  raise notice 'OK  role multipliers';
end;
$$;

-- 2. Directional factors ------------------------------------------------------
do $$
begin
  assert public.wisi_direction_factor('P') = 1,  'P should be +1';
  assert public.wisi_direction_factor('p') = 1,  'p should be +1';
  assert public.wisi_direction_factor('S') = -1, 'S should be -1';
  assert public.wisi_direction_factor('A') = 0,  'A should be 0';
  assert public.wisi_direction_factor('M') = 0,  'M should be 0';
  assert public.wisi_direction_factor('G') = 0,  'G should be 0';
  assert public.wisi_direction_factor('F') = 0,  'F should be 0';
  assert public.wisi_direction_factor(null) = 0, 'null should be 0';
  raise notice 'OK  direction factors';
end;
$$;

-- 3. Gauge mapping ------------------------------------------------------------
do $$
begin
  assert public.wisi_sentiment_index(0) = 50,         'WISI 0 -> 50';
  assert public.wisi_sentiment_index(null) = 50,      'WISI null -> 50';
  assert public.wisi_sentiment_index(1) = 100,        'huge positive -> 100';
  assert public.wisi_sentiment_index(-1) = 0,         'huge negative -> 0';
  assert public.wisi_sentiment_index(0.001) = 73.1,   '10 bps -> 73.1';
  assert public.wisi_sentiment_index(-0.001) = 26.9,  '-10 bps -> 26.9';
  assert public.wisi_sentiment_label(0) = 'Neutral',  '0 is Neutral';
  assert public.wisi_sentiment_label(0.0005) = 'Bullish',  '+5 bps is Bullish';
  assert public.wisi_sentiment_label(-0.0005) = 'Bearish', '-5 bps is Bearish';
  assert public.wisi_sentiment_label(0.0003) = 'Neutral',  '+3 bps is Neutral';
  assert public.wisi_sentiment_label(-0.0003) = 'Neutral', '-3 bps is Neutral';
  raise notice 'OK  gauge mapping';
end;
$$;

-- 4. Trigger audit (playbook step 1) -----------------------------------------
\ir 01_wisi_trigger_audit.sql

do $$
declare
  failures integer;
  steps    integer;
begin
  select count(*) filter (where not passed), count(*)
    into failures, steps
    from pg_temp.insiderpulse_trigger_audit();
  if steps <> 7 or failures <> 0 then
    raise exception 'Trigger audit failed: % of % steps failed', failures, steps;
  end if;
  raise notice 'OK  trigger audit (% steps)', steps;
end;
$$;

-- 5. Chart RPC ----------------------------------------------------------------
do $$
declare
  v_company uuid;
  r record;
  n integer := 0;
begin
  insert into public.companies (ticker, cik, company_name, market_cap)
  values ('ZZCHART', '9999999998', 'Chart Test Co.', 5000000000)
  returning id into v_company;

  insert into public.insider_transactions
    (company_id, accession_number, filing_date, transaction_date,
     reporting_owner_name, owner_title, transaction_code, shares, price_per_share,
     is_10b5_1, parser_version)
  values
    (v_company, '9999999998-26-000001', now(), current_date, 'A', 'CEO',      'P', 1000, 10, false, 2),
    (v_company, '9999999998-26-000002', now(), current_date, 'B', 'Director', 'S', 500,  20, false, 2),
    (v_company, '9999999998-26-000003', now(), current_date, 'C', 'Director', 'A', 999,  0,  false, 2),
    (v_company, '9999999998-26-000004', now(), (date_trunc('month', current_date) - interval '2 months')::date,
     'D', 'CFO', 'P', 100, 30, false, 2),
    (v_company, '9999999998-26-000005', now(), current_date, 'E', 'CFO',      'S', 100,  50, true,  2);

  for r in select * from public.get_insider_activity(v_company, 12) loop
    n := n + 1;
    if r.period_start = date_trunc('month', current_date)::date then
      assert r.buy_value = 10000 and r.sell_value = 10000 and r.buy_count = 1 and r.sell_count = 1
             and r.routine_sell_value = 5000 and r.routine_sell_count = 1,
        format('current month totals wrong: %s', row_to_json(r));
    elsif r.period_start = (date_trunc('month', current_date) - interval '2 months')::date then
      assert r.buy_value = 3000 and r.sell_value = 0, format('two-months-ago totals wrong: %s', row_to_json(r));
    else
      assert r.buy_value = 0 and r.sell_value = 0, format('empty month not zero: %s', row_to_json(r));
    end if;
  end loop;
  assert n = 12, format('expected 12 months, got %s', n);
  raise notice 'OK  get_insider_activity';
end;
$$;

-- 6. Row Level Security -------------------------------------------------------
do $$
declare
  alice   uuid := gen_random_uuid();
  bob     uuid := gen_random_uuid();
  company uuid;
  n       integer;
begin
  insert into auth.users (id, email) values (alice, 'alice@example.com'), (bob, 'bob@example.com');
  select id into company from public.companies order by ticker limit 1;
  if company is null then
    insert into public.companies (ticker, cik, company_name) values ('ZZRLS', '9999999997', 'RLS Co.')
    returning id into company;
  end if;

  -- Profiles are created automatically for new auth users.
  select count(*) into n from public.profiles where id in (alice, bob);
  assert n = 2, 'handle_new_user trigger did not create profiles';

  -- Alice (authenticated) manages her own watchlist.
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.watchlists (company_id) values (company);  -- user_id defaults to auth.uid()
  select count(*) into n from public.watchlists;
  assert n = 1, 'alice should see exactly her own watchlist row';

  begin
    insert into public.watchlists (user_id, company_id) values (bob, company);
    raise exception 'alice inserted a row for bob';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.sentiment_scores set wisi_score = 42;
    raise exception 'authenticated user updated sentiment_scores';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.companies (ticker, cik, company_name) values ('HACK', '0000000001', 'Hack');
    raise exception 'authenticated user inserted a company';
  exception when insufficient_privilege then null;
  end;

  update public.profiles set whale_alerts_enabled = false where id = bob;
  get diagnostics n = row_count;
  assert n = 0, 'alice updated bob''s profile';

  update public.profiles
     set expo_push_token = 'ExponentPushToken[abc123]', push_platform = 'ios'
   where id = alice;
  get diagnostics n = row_count;
  assert n = 1, 'alice could not update her own profile';

  select count(*) into n from public.profiles;
  assert n = 1, 'alice should only see her own profile';

  reset role;

  -- Bob cannot see or delete Alice's watchlist.
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.watchlists;
  assert n = 0, 'bob can see alice''s watchlist';
  delete from public.watchlists;
  get diagnostics n = row_count;
  assert n = 0, 'bob deleted alice''s watchlist';
  reset role;

  -- Anonymous visitors can read market data but nothing private.
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into n from public.companies;
  assert n > 0, 'anon cannot read companies';
  perform 1 from public.sentiment_scores limit 1;
  perform 1 from public.insider_transactions limit 1;
  begin
    perform 1 from public.watchlists limit 1;
    raise exception 'anon read watchlists';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.profiles limit 1;
    raise exception 'anon read profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.recalculate_wisi_score(company);
    raise exception 'anon executed recalculate_wisi_score';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.processed_filings limit 1;
    raise exception 'anon read processed_filings';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_ingestion_lease('sec', 'anon', 60);
    raise exception 'anon claimed the ingestion lease';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ensure_companies('[]'::jsonb);
    raise exception 'anon executed ensure_companies';
  exception when insufficient_privilege then null;
  end;
  perform 1 from public.company_signal_breakdown(company);
  perform 1 from public.company_signal(company);
  reset role;

  -- Alice's watchlist row really exists (checked as the table owner).
  select count(*) into n from public.watchlists where user_id = alice;
  assert n = 1, 'alice''s watchlist row missing';

  raise notice 'OK  row level security';
end;
$$;

-- 7. Constraints --------------------------------------------------------------
do $$
begin
  begin
    insert into public.companies (ticker, cik, company_name) values ('lower', '0000000002', 'Bad ticker');
    raise exception 'lower-case ticker accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.companies (ticker, cik, company_name) values ('BADCIK', '12345', 'Bad CIK');
    raise exception 'unpadded CIK accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.profiles (id, expo_push_token)
    select id, 'not-a-token' from auth.users limit 1
    on conflict (id) do update set expo_push_token = excluded.expo_push_token;
    raise exception 'invalid push token accepted';
  exception when check_violation then null;
  end;
  raise notice 'OK  constraints';
end;
$$;

-- 8. Insider Signal -------------------------------------------------------------
do $$
declare
  v_company uuid;
  v_quiet   uuid;
  v_sellers uuid;
  s         record;
  b         record;
  total     numeric;
begin
  insert into public.companies (ticker, cik, company_name) values ('ZZSIG', '9999999990', 'Signal Co.')
  returning id into v_company;

  insert into public.insider_transactions
    (company_id, accession_number, filing_date, transaction_date, reporting_owner_name, insider_cik,
     owner_title, transaction_code, shares, price_per_share, post_transaction_shares,
     is_10b5_1, is_sell_to_cover, parser_version)
  values
    -- CEO buys $1M, growing the holding 50%: 6 x 1.5 x 2.5 x 1.4 = +31.5
    (v_company, '9999999990-26-000001', now(), current_date - 5,   'Alice',  '0000000101', 'Chief Executive Officer', 'P', 10000, 100, 30000, false, false, 2),
    -- Director buys $100k 40 days ago (x0.7 = $70k): 6 x 1.0 x 1.35 x 1.0 = +8.1
    (v_company, '9999999990-26-000002', now(), current_date - 40,  'Bob',    '0000000102', 'Director',                'P', 1000,  100, null,  false, false, 2),
    -- 10b5-1 plan sale and a sell-to-cover sale: ignored
    (v_company, '9999999990-26-000003', now(), current_date - 3,   'Carol',  '0000000103', 'CFO',                     'S', 5000,  100, 1000,  true,  false, 2),
    (v_company, '9999999990-26-000004', now(), current_date - 3,   'Dan',    '0000000104', 'EVP',                     'S', 5000,  100, 1000,  false, true,  2),
    -- SVP sells $200k = 5% of the holding: -3 x 0.7 x 1.80 x 1.0 = -3.8
    (v_company, '9999999990-26-000005', now(), current_date - 10,  'Eve',    '0000000105', 'SVP, Sales',              'S', 2000,  100, 38000, false, false, 2),
    -- too small, too old, not open-market, parsed by v1: ignored
    (v_company, '9999999990-26-000006', now(), current_date - 1,   'Frank',  '0000000106', 'Director',                'P', 50,    100, null,  false, false, 2),
    (v_company, '9999999990-26-000007', now(), current_date - 100, 'George', '0000000107', 'Director',                'P', 5000,  100, null,  false, false, 2),
    (v_company, '9999999990-26-000008', now(), current_date - 2,   'Alice',  '0000000101', 'Chief Executive Officer', 'A', 9999,  0,   null,  false, false, 2),
    (v_company, '9999999990-26-000009', now(), current_date - 2,   'Hank',   '0000000108', 'Director',                'P', 9999,  100, null,  false, false, 1);

  -- Generated columns.
  assert (select signal_direction from public.insider_transactions where accession_number = '9999999990-26-000001') = 1,  'discretionary buy should be +1';
  assert (select signal_direction from public.insider_transactions where accession_number = '9999999990-26-000003') = 0,  '10b5-1 sale should be 0';
  assert (select signal_direction from public.insider_transactions where accession_number = '9999999990-26-000004') = 0,  'sell-to-cover should be 0';
  assert (select signal_direction from public.insider_transactions where accession_number = '9999999990-26-000005') = -1, 'discretionary sale should be -1';
  assert (select signal_direction from public.insider_transactions where accession_number = '9999999990-26-000009') = 0,  'v1 rows never count';
  assert (select stake_change_pct from public.insider_transactions where accession_number = '9999999990-26-000001') = 50, 'buy stake change';
  assert (select stake_change_pct from public.insider_transactions where accession_number = '9999999990-26-000005') = 5,  'sell stake change';

  -- Breakdown: Alice +31.5, Bob +8.1, Eve -3.8.
  total := 0;
  for b in select * from public.company_signal_breakdown(v_company) loop
    total := total + b.points;
    if b.insider_name = 'Alice' then
      assert b.points = 31.5 and b.role_weight = 1.5 and b.size_factor = 2.5 and b.conviction = 1.4 and b.trade_count = 1,
        format('Alice wrong: %s', row_to_json(b));
    elsif b.insider_name = 'Bob' then
      assert b.points = 8.1 and b.size_factor = 1.35 and b.weighted_value = 70000, format('Bob wrong: %s', row_to_json(b));
    elsif b.insider_name = 'Eve' then
      assert b.points = -3.8 and b.direction = -1 and b.conviction = 1.0, format('Eve wrong: %s', row_to_json(b));
    else
      raise exception 'unexpected insider in breakdown: %', row_to_json(b);
    end if;
  end loop;
  assert total = 35.8, format('breakdown total %s', total);

  -- Score = 50 + 35.8 + cluster (+4 for the second buyer) = 89.8, stored by the trigger.
  select * into s from public.company_signal(v_company);
  assert s.score = 89.8 and s.label = 'Strong buying' and s.buyers = 2 and s.sellers = 1
         and s.cluster_points = 4 and s.buy_value = 1100000 and s.sell_value = 200000,
    format('company_signal wrong: %s', row_to_json(s));
  select * into s from public.sentiment_scores where company_id = v_company;
  assert s.signal_score = 89.8 and s.signal_label = 'Strong buying' and s.signal_buyers = 2
         and s.signal_last_trade_date = current_date - 5,
    format('sentiment_scores not updated: %s', row_to_json(s));

  -- Only routine trades: no signal.
  insert into public.companies (ticker, cik, company_name) values ('ZZQUIET', '9999999991', 'Quiet Co.')
  returning id into v_quiet;
  insert into public.insider_transactions
    (company_id, accession_number, filing_date, transaction_date, reporting_owner_name, owner_title,
     transaction_code, shares, price_per_share, is_10b5_1, parser_version)
  values (v_quiet, '9999999991-26-000001', now(), current_date, 'Zed', 'CEO', 'S', 100000, 100, true, 2);
  select * into s from public.sentiment_scores where company_id = v_quiet;
  assert s.signal_score = 50 and s.signal_label = 'No signal', format('quiet company: %s', row_to_json(s));
  assert s.sell_count = 1, 'the spec WISI still counts the plan sale';

  -- Three officers each dumping $1M: 3 x -5.3 - 4 (cluster) = 30.1, Selling.
  insert into public.companies (ticker, cik, company_name) values ('ZZSELL', '9999999992', 'Sell Co.')
  returning id into v_sellers;
  insert into public.insider_transactions
    (company_id, accession_number, filing_date, transaction_date, reporting_owner_name, insider_cik, owner_title,
     transaction_code, shares, price_per_share, parser_version)
  select v_sellers, format('9999999992-26-00000%s', i), now(), current_date, 'Seller ' || i, format('000000020%s', i),
         'EVP', 'S', 10000 + i, 100, 2
    from generate_series(1, 3) as i;
  select * into s from public.company_signal(v_sellers);
  assert s.score = 30.1 and s.label = 'Selling' and s.sellers = 3 and s.cluster_points = -4,
    format('selling company: %s', row_to_json(s));

  -- A fund and its general partner reporting the same $2M purchase count once.
  insert into public.insider_transactions
    (company_id, accession_number, filing_date, transaction_date, reporting_owner_name, insider_cik, owner_title,
     transaction_code, shares, price_per_share, parser_version)
  values
    (v_quiet, '9999999991-26-000002', now(), current_date, 'Fund LP',      '0000000301', '10% Owner',           'P', 20000, 100, 2),
    (v_quiet, '9999999991-26-000003', now(), current_date, 'Fund GP LLC',  '0000000302', '10% Owner',           'P', 20000, 100, 2),
    (v_quiet, '9999999991-26-000004', now(), current_date, 'Jane Partner', '0000000303', 'Director, 10% Owner', 'P', 20000, 100, 2);
  select * into s from public.company_signal(v_quiet);
  assert s.buyers = 1 and s.buy_value = 2000000 and s.cluster_points = 0,
    format('group filing counted more than once: %s', row_to_json(s));
  assert (select insider_name from public.company_signal_breakdown(v_quiet)) = 'Jane Partner',
    'the highest-weighted group member should represent the trade';

  -- Labels and size factor edges.
  assert public.signal_label(50, 0) = 'No signal' and public.signal_label(75, 1) = 'Strong buying'
     and public.signal_label(58, 1) = 'Buying' and public.signal_label(57.9, 1) = 'Neutral'
     and public.signal_label(42, 1) = 'Selling' and public.signal_label(25, 1) = 'Strong selling', 'labels';
  assert public.signal_size_factor(10000) = 0.5 and public.signal_size_factor(1000000) = 2.5
     and public.signal_size_factor(1e12) = 4 and public.signal_size_factor(100) = 0, 'size factor';
  raise notice 'OK  insider signal';
end;
$$;

-- 9. Market-wide ingestion helpers ---------------------------------------------
do $$
declare
  n      integer;
  v_ids  text[];
begin
  insert into public.companies (ticker, cik, company_name) values ('ZZOLD', '9999999980', 'Existing Co.');

  select array_agg(e.ticker order by e.ticker) into v_ids
    from public.ensure_companies(jsonb_build_array(
      jsonb_build_object('cik', '9999999980', 'ticker', 'ZZRENAMED', 'company_name', 'Existing Co.'),  -- known CIK
      jsonb_build_object('cik', '9999999981', 'ticker', 'ZZNEW',     'company_name', 'New Co.'),
      jsonb_build_object('cik', '9999999981', 'ticker', 'ZZNEW',     'company_name', 'New Co. again'),
      jsonb_build_object('cik', '9999999982', 'ticker', 'ZZOLD',     'company_name', 'Ticker clash'),  -- ticker taken
      jsonb_build_object('cik', '9999999983', 'ticker', 'bad ticker','company_name', 'Invalid')
    )) as e;
  assert v_ids = array['ZZNEW', 'ZZOLD'], format('ensure_companies returned %s', v_ids);
  assert (select count(*) from public.sentiment_scores s join public.companies c on c.id = s.company_id
           where c.cik = '9999999981') = 1, 'new company has no score row';

  insert into public.processed_filings (accession_number, status, parser_version)
  values ('9999999981-26-000001', 'stored', 2), ('9999999981-26-000002', 'no_ticker', 1);
  select array_agg(u.accession_number order by u.accession_number) into v_ids
    from public.filter_unprocessed_filings(
      array['9999999981-26-000001', '9999999981-26-000002', '9999999981-26-000003', '9999999981-26-000003'], 2::smallint) u;
  assert v_ids = array['9999999981-26-000002', '9999999981-26-000003'], format('unprocessed: %s', v_ids);

  assert public.claim_ingestion_lease('test', 'run-a', 60), 'first claim';
  assert not public.claim_ingestion_lease('test', 'run-b', 60), 'second holder must wait';
  assert public.claim_ingestion_lease('test', 'run-a', 60), 'holder can extend';
  perform public.release_ingestion_lease('test', 'run-a');
  assert public.claim_ingestion_lease('test', 'run-b', 60), 'claim after release';
  update public.ingestion_lease set expires_at = now() - interval '1 second' where name = 'test';
  assert public.claim_ingestion_lease('test', 'run-c', 60), 'claim after expiry';

  -- Hank's v1 row (ZZSIG) needs re-parsing until a v2 run has processed it.
  select count(*) into n from public.reparse_candidates(1000, 2::smallint) r where r.accession_number = '9999999990-26-000009';
  assert n = 1, 'v1 row should be a reparse candidate';
  insert into public.processed_filings (accession_number, status, parser_version) values ('9999999990-26-000009', 'missing', 2);
  select count(*) into n from public.reparse_candidates(1000, 2::smallint) r where r.accession_number = '9999999990-26-000009';
  assert n = 0, 'processed v1 row should not be retried';

  select count(*) into n from public.market_cap_refresh_candidates(100) c where c.ticker = 'ZZSIG';
  assert n = 1, 'ZZSIG should need a market cap';
  raise notice 'OK  ingestion helpers';
end;
$$;

rollback;
