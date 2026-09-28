-- =============================================================================
-- InsiderPulse — Phase 3: Weighted Insider Sentiment Index (WISI) engine
-- -----------------------------------------------------------------------------
--                K   V_j * W_role,j
--   WISI_i  =    Σ  ---------------- * δ_j          V_j = shares_j * price_j
--               j=1   MarketCap_i
--
--   W_role : CEO / CFO 1.5 · Director / Board 1.0 · 10% Owner / Officer 0.7
--            · anything else 0.5
--   δ      : 'P' open-market purchase +1 · 'S' open-market sale -1 · other 0
--   Window : filings in the last 90 days (rolling)
--
-- The raw WISI is a signed fraction of market cap (e.g. +0.0015 = net weighted
-- insider buying worth 0.15% of the company). For the app's 0–100 gauge it is
-- mapped with   index = 50 + 50 * tanh(500 * WISI)
-- >= 60 is Bullish (net weighted buying of ~4 bps of market cap or more),
-- <= 40 is Bearish, anything in between is Neutral; ±10 bps reads 73 / 27.
-- =============================================================================

-- 1. Weighting helpers --------------------------------------------------------

create or replace function public.wisi_role_multiplier(title text)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when title is null or btrim(title) = '' then 0.5
    -- Executive officers: CEO / CFO (and their SEC "principal officer" names)
    when title ~* '(\mceo\M|\mcfo\M|chief\s+executive|chief\s+financial|principal\s+executive|principal\s+financial)'
      then 1.5
    -- Directors / board members (incl. chair)
    when title ~* '(\mdirector\M|\mboard\M|\mchair)'
      then 1.0
    -- 10% owners and other officers
    when title ~* '(10\s*(%|percent)|ten\s+percent|\mofficer\M|\mpresident\M|\mchief\M|\m[es]?vp\M|vice\s+president|\mcoo\M|\mcto\M|\mcio\M|\mcao\M|\mclo\M|\mtreasurer\M|\msecretary\M|\mcounsel\M|\mcontroller\M)'
      then 0.7
    else 0.5
  end;
$$;

comment on function public.wisi_role_multiplier(text) is
  'WISI role weight derived from a Form 4 owner title: CEO/CFO 1.5, Director 1.0, 10% Owner/Officer 0.7, other 0.5.';

create or replace function public.wisi_direction_factor(code text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case upper(btrim(coalesce(code, '')))
    when 'P' then 1
    when 'S' then -1
    else 0
  end;
$$;

comment on function public.wisi_direction_factor(text) is
  'WISI directional factor: P (open-market purchase) +1, S (open-market sale) -1, all other codes 0.';

-- 2. Gauge mapping (0–100) ----------------------------------------------------

create or replace function public.wisi_sentiment_index(wisi numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select round((50 + 50 * tanh(coalesce(wisi, 0)::double precision * 500))::numeric, 1);
$$;

create or replace function public.wisi_sentiment_label(wisi numeric)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when public.wisi_sentiment_index(wisi) >= 60 then 'Bullish'
    when public.wisi_sentiment_index(wisi) <= 40 then 'Bearish'
    else 'Neutral'
  end;
$$;

alter table public.sentiment_scores
  add column if not exists net_weighted_value numeric not null default 0,
  add column if not exists buy_count          integer not null default 0,
  add column if not exists sell_count         integer not null default 0,
  add column if not exists sentiment_index    numeric
    generated always as (public.wisi_sentiment_index(wisi_score)) stored,
  add column if not exists sentiment_label    text
    generated always as (public.wisi_sentiment_label(wisi_score)) stored;

comment on column public.sentiment_scores.net_weighted_value is 'Σ V_j · W_role,j · δ_j over the 90-day window (USD).';
comment on column public.sentiment_scores.sentiment_index    is '0–100 gauge value derived from wisi_score.';
comment on column public.sentiment_scores.sentiment_label    is 'Bullish / Neutral / Bearish derived from sentiment_index.';

create index if not exists sentiment_scores_sentiment_index_idx
  on public.sentiment_scores (sentiment_index desc);

-- 3. Core calculation ---------------------------------------------------------

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

  insert into public.sentiment_scores
         (company_id, wisi_score, net_weighted_value, buy_count, sell_count, last_updated)
  values (target_company_id, v_wisi, v_weighted_sum, v_buy_count, v_sell_count, now())
  on conflict (company_id) do update
     set wisi_score         = excluded.wisi_score,
         net_weighted_value = excluded.net_weighted_value,
         buy_count          = excluded.buy_count,
         sell_count         = excluded.sell_count,
         last_updated       = excluded.last_updated;

  return v_wisi;
end;
$$;

comment on function public.recalculate_wisi_score(uuid) is
  'Recomputes the 90-day WISI for one company and upserts it into sentiment_scores.';

create or replace function public.recalculate_all_wisi_scores()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.companies order by id loop
    perform public.recalculate_wisi_score(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function public.recalculate_all_wisi_scores() is
  'Recomputes every company''s WISI. Scheduled daily so the 90-day window rolls forward.';

-- 4. Triggers -----------------------------------------------------------------

create or replace function public.handle_insider_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalculate_wisi_score(new.company_id);
  end if;

  if tg_op = 'DELETE'
     or (tg_op = 'UPDATE' and old.company_id is distinct from new.company_id) then
    perform public.recalculate_wisi_score(old.company_id);
  end if;

  return null; -- AFTER trigger: return value is ignored
end;
$$;

drop trigger if exists on_insider_transaction_change on public.insider_transactions;
create trigger on_insider_transaction_change
  after insert or update or delete on public.insider_transactions
  for each row execute function public.handle_insider_transaction_change();

-- Market cap is the WISI denominator, so a new/updated market cap re-scores
-- the company. New companies immediately get a neutral (0) score row.
create or replace function public.handle_company_wisi_inputs_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recalculate_wisi_score(new.id);
  return null;
end;
$$;

drop trigger if exists on_company_created on public.companies;
create trigger on_company_created
  after insert on public.companies
  for each row execute function public.handle_company_wisi_inputs_change();

drop trigger if exists on_company_market_cap_change on public.companies;
create trigger on_company_market_cap_change
  after update of market_cap on public.companies
  for each row
  when (old.market_cap is distinct from new.market_cap)
  execute function public.handle_company_wisi_inputs_change();

-- 5. Privileges ---------------------------------------------------------------
-- The SECURITY DEFINER functions must not be callable through the public API.
revoke execute on function public.recalculate_wisi_score(uuid)                from public, anon, authenticated;
revoke execute on function public.recalculate_all_wisi_scores()               from public, anon, authenticated;
revoke execute on function public.handle_insider_transaction_change()         from public, anon, authenticated;
revoke execute on function public.handle_company_wisi_inputs_change()         from public, anon, authenticated;
grant  execute on function public.recalculate_wisi_score(uuid)                to service_role;
grant  execute on function public.recalculate_all_wisi_scores()               to service_role;

-- 6. Backfill -----------------------------------------------------------------
select public.recalculate_all_wisi_scores();
