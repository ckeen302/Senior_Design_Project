-- =============================================================================
-- InsiderPulse — Scheduled jobs (pg_cron + pg_net)
-- -----------------------------------------------------------------------------
--  * insiderpulse-fetch-sec-filings : every 15 min, POST {"mode":"tracked"} to
--    the fetch-sec-filings Edge Function (round-robins through companies).
--  * insiderpulse-recalculate-wisi  : daily, rolls the 90-day WISI window
--    forward for every company (scores decay even without new filings).
--
-- The ingestion job reads two Vault secrets at run time, so no credentials are
-- stored in this migration. Until they exist the job is a harmless no-op:
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'insiderpulse_project_url');
--   select vault.create_secret('<same value as the INGEST_SECRET function secret>', 'insiderpulse_ingest_secret');
--
-- On databases without pg_cron / pg_net (plain PostgreSQL) this migration only
-- emits a notice.
-- =============================================================================

do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net not available; skipping job scheduling.';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net  with schema extensions;

  perform cron.schedule(
    'insiderpulse-recalculate-wisi',
    '17 5 * * *',
    'select public.recalculate_all_wisi_scores();'
  );

  perform cron.schedule(
    'insiderpulse-fetch-sec-filings',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
                 where name = 'insiderpulse_project_url' limit 1)
               || '/functions/v1/fetch-sec-filings',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-ingest-secret', (select decrypted_secret from vault.decrypted_secrets
                               where name = 'insiderpulse_ingest_secret' limit 1)
        ),
        body := jsonb_build_object('mode', 'tracked'),
        timeout_milliseconds := 150000
      )
      where exists (select 1 from vault.decrypted_secrets where name = 'insiderpulse_project_url')
        and exists (select 1 from vault.decrypted_secrets where name = 'insiderpulse_ingest_secret');
    $job$
  );
exception
  when others then
    raise warning 'InsiderPulse job scheduling skipped: %', sqlerrm;
end;
$outer$;
