-- =============================================================================
-- InsiderPulse — v2.4: fixes from the code review
-- -----------------------------------------------------------------------------
-- 1. A buy that opens a position (nothing held before) is the largest possible
--    stake increase: stake_change_pct 9999 and conviction x1.4 (it was NULL,
--    which scored like a +1% top-up).
-- 2. The absolute price checks (> $20B, > half the market cap, > $500M without
--    a known cap) apply to trades of any age, so a late filing for an old
--    trade can no longer put a typo on the chart or into a whale alert.
-- 3. The nightly re-score commits after every company. Holding every company's
--    lock until the end stalled ingestion and could deadlock with it.
-- 4. A device's push token belongs to the account that signed in on it last:
--    register_push_token() moves it, and a token is stored on one profile only.
-- =============================================================================

-- 1. New positions --------------------------------------------------------------

alter table public.insider_transactions drop column if exists stake_change_pct;
alter table public.insider_transactions
  add column stake_change_pct numeric generated always as (
    case
      when post_transaction_shares is null or shares <= 0 then null
      when transaction_code = 'P' and post_transaction_shares - shares > 0
        then round(least(shares / (post_transaction_shares - shares) * 100, 9999), 1)
      -- Nothing held before the purchase: a new position.
      when transaction_code = 'P' and post_transaction_shares = shares then 9999
      when transaction_code = 'S' and post_transaction_shares + shares > 0
        then round(shares / (post_transaction_shares + shares) * 100, 1)
      else null
    end
  ) stored;

comment on column public.insider_transactions.stake_change_pct is
  'Buys: % increase of the holding (9999: a new position, or capped). Sales: % of the holding sold.';

-- 2. Price checks for trades of any age ----------------------------------------------

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
    select t.id, t.shares, t.price_per_share, t.transaction_date, t.price_suspect,
           t.transaction_date > current_date - 400 as recent
      from public.insider_transactions t
     where t.company_id = target_company_id
       and t.transaction_code in ('P', 'S')
       and t.shares > 0
       and t.price_per_share > 0
  ),
  judged as (
    select tr.id,
           tr.price_suspect as was_suspect,
           (   tr.shares * tr.price_per_share > 20000000000
            or (v_cap is not null and tr.shares * tr.price_per_share > v_cap * 0.5)
            or (v_cap is null and tr.shares * tr.price_per_share > 500000000)
            or case
                 -- Comparing with the company's other trades is quadratic, so it
                 -- covers the last 400 days; older rows keep their earlier verdict.
                 when not tr.recent then tr.price_suspect
                 else coalesce((
                   select case when count(*) >= 2 then
                            greatest(tr.price_per_share::float8 / percentile_cont(0.5) within group (order by o.price_per_share::float8),
                                     percentile_cont(0.5) within group (order by o.price_per_share::float8) / tr.price_per_share::float8) > 20
                          end
                     from trades o
                    where o.recent
                      and o.id <> tr.id
                      and o.transaction_date between tr.transaction_date - 45 and tr.transaction_date + 45
                 ), false)
               end
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
  'Flags open-market trades whose filed price is implausible: > $20B, > half the market cap (> $500M when the cap is unknown), or 20x off the company''s other trades of the last 400 days.';

-- 3. Nightly re-score: one short transaction per company -------------------------------

comment on function public.recalculate_all_wisi_scores() is
  'Recomputes every company''s scores in one transaction (migrations). The nightly job commits after each company instead.';

do $migration$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping the nightly job update.';
    return;
  end if;

  -- COMMIT is only allowed in a top-level DO block (not in a function, nor in a
  -- procedure with SECURITY DEFINER or SET search_path). pg_cron runs the
  -- command as a statement of its own. scripts/verify-db.sh runs this block too.
  perform cron.schedule(
    'insiderpulse-recalculate-wisi',
    '17 5 * * *',
    $job$
do $rescore$
declare
  r record;
begin
  for r in select id from public.companies order by id loop
    perform public.recalculate_wisi_score(r.id);
    commit;
  end loop;
end
$rescore$;
$job$
  );
end;
$migration$;

-- 4. Push tokens -------------------------------------------------------------------------

-- A token stored on several profiles stays on the most recently updated one.
update public.profiles p
   set expo_push_token = null,
       push_platform   = null
 where p.expo_push_token is not null
   and exists (
     select 1
       from public.profiles q
      where q.expo_push_token = p.expo_push_token
        and (q.updated_at, q.id) > (p.updated_at, p.id)
   );

create unique index if not exists profiles_expo_push_token_key
  on public.profiles (expo_push_token)
  where expo_push_token is not null;

comment on column public.profiles.expo_push_token is
  'Expo push token of the device this user signed in on last (unique: a device belongs to one account).';

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to register this device for alerts' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) > 200 or p_token !~ '^(Expo|Exponent)PushToken\[[^]]+\]$' then
    raise exception 'Invalid Expo push token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'Invalid push platform' using errcode = '22023';
  end if;

  -- Whoever signed in on the device before stops receiving its alerts.
  update public.profiles
     set expo_push_token = null,
         push_platform   = null
   where expo_push_token = p_token
     and id <> v_user;

  insert into public.profiles (id, expo_push_token, push_platform)
  values (v_user, p_token, p_platform)
  on conflict (id) do update
     set expo_push_token = excluded.expo_push_token,
         push_platform   = excluded.push_platform;
end;
$$;

comment on function public.register_push_token(text, text) is
  'Stores this device''s Expo push token on the caller''s profile and removes it from any other profile.';

revoke execute on function public.register_push_token(text, text) from public, anon;
grant  execute on function public.register_push_token(text, text) to authenticated;

-- Apply the new stake and price rules to every company.
select public.recalculate_all_wisi_scores();
