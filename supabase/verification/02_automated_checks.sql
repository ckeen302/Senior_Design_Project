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
     reporting_owner_name, owner_title, transaction_code, shares, price_per_share)
  values
    (v_company, '9999999998-26-000001', now(), current_date, 'A', 'CEO',      'P', 1000, 10),
    (v_company, '9999999998-26-000002', now(), current_date, 'B', 'Director', 'S', 500,  20),
    (v_company, '9999999998-26-000003', now(), current_date, 'C', 'Director', 'A', 999,  0),
    (v_company, '9999999998-26-000004', now(), (date_trunc('month', current_date) - interval '2 months')::date,
     'D', 'CFO', 'P', 100, 30);

  for r in select * from public.get_insider_activity(v_company, 12) loop
    n := n + 1;
    if r.period_start = date_trunc('month', current_date)::date then
      assert r.buy_value = 10000 and r.sell_value = 10000 and r.buy_count = 1 and r.sell_count = 1,
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

rollback;
