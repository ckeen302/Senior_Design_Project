-- =============================================================================
-- InsiderPulse — v2.5: push tokens move by trigger
-- -----------------------------------------------------------------------------
-- register_push_token() was a SECURITY DEFINER function that every signed-in
-- user could call (a Supabase security advisor warning). A trigger does the
-- same job for any write of a token: when a profile stores a device's token,
-- every other profile holding it lets go, so a device belongs to the account
-- that signed in on it last. The app writes its own profile row, as before.
-- =============================================================================

drop function if exists public.register_push_token(text, text);

create or replace function public.release_push_token_elsewhere()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set expo_push_token = null,
         push_platform   = null
   where expo_push_token = new.expo_push_token
     and id <> new.id;
  return new;
end;
$$;

comment on function public.release_push_token_elsewhere() is
  'Takes a device''s push token off every other profile when one profile stores it.';

-- Trigger functions need no EXECUTE grant to fire.
revoke execute on function public.release_push_token_elsewhere() from public, anon, authenticated;

drop trigger if exists profiles_release_push_token on public.profiles;
create trigger profiles_release_push_token
  before insert or update of expo_push_token on public.profiles
  for each row
  when (new.expo_push_token is not null)
  execute function public.release_push_token_elsewhere();
