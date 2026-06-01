begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

-- Supabase Cron is the scheduler of record for Activity Log archives.
-- Required Vault secrets before the job runs:
--   hotel_pms_app_base_url       = https://<current app host>
--   hotel_pms_cron_backup_secret = same value as CRON_BACKUP_SECRET on the app host

create or replace function public.invoke_ui_event_log_archive()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  app_base_url text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into app_base_url
  from vault.decrypted_secrets
  where name = 'hotel_pms_app_base_url'
  limit 1;

  select decrypted_secret
  into cron_secret
  from vault.decrypted_secrets
  where name = 'hotel_pms_cron_backup_secret'
  limit 1;

  if nullif(trim(app_base_url), '') is null then
    raise exception 'Missing Vault secret: hotel_pms_app_base_url';
  end if;

  if nullif(trim(cron_secret), '') is null then
    raise exception 'Missing Vault secret: hotel_pms_cron_backup_secret';
  end if;

  select net.http_post(
    url := rtrim(app_base_url, '/') || '/api/cron/ui-event-log-archive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cron_secret
    ),
    body := jsonb_build_object(
      'source', 'supabase_cron',
      'job', 'ui_event_log_archive',
      'requested_at', timezone('utc', now())
    ),
    timeout_milliseconds := 30000
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_ui_event_log_archive() from public;
grant execute on function public.invoke_ui_event_log_archive() to postgres;
grant execute on function public.invoke_ui_event_log_archive() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ui_event_log_archive_http') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'ui_event_log_archive_http';
  end if;

  perform cron.schedule(
    'ui_event_log_archive_http',
    '0 20 * * *',
    'select public.invoke_ui_event_log_archive();'
  );
exception
  when others then
    raise notice 'Unable to schedule ui_event_log_archive_http (%). Configure Supabase Cron manually after this migration.', sqlerrm;
end $$;

commit;
