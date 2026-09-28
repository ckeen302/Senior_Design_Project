-- =============================================================================
-- InsiderPulse — Phase 6: User profiles & Expo push tokens
-- =============================================================================

create table if not exists public.profiles (
  id                    uuid        primary key references auth.users (id) on delete cascade,
  email                 text,
  expo_push_token       text,
  push_platform         text,
  whale_alerts_enabled  boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint profiles_push_platform_check check (push_platform is null or push_platform in ('ios', 'android', 'web')),
  constraint profiles_expo_push_token_format check (
    expo_push_token is null or expo_push_token ~ '^(Expo|Exponent)PushToken\[[^]]+\]$'
  )
);

comment on table  public.profiles                      is 'Per-user app profile (1:1 with auth.users).';
comment on column public.profiles.expo_push_token      is 'Latest Expo push token for the user''s device.';
comment on column public.profiles.whale_alerts_enabled is 'Receive "whale" alerts for large CEO/CFO open-market purchases.';

create index if not exists profiles_push_recipients_idx
  on public.profiles (whale_alerts_enabled)
  where expo_push_token is not null;

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select, insert, update on public.profiles to authenticated;
revoke all on public.profiles from anon;
revoke delete, truncate on public.profiles from authenticated;
grant all on public.profiles to service_role;

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill users that signed up before this migration.
insert into public.profiles (id, email)
select u.id, u.email
  from auth.users u
on conflict (id) do nothing;
