-- Retention cleanup for billing telemetry tables.
-- Keeps high-volume logs bounded over time.

create extension if not exists pg_cron with schema extensions;

create or replace function public.cleanup_billing_telemetry_retention(
  p_keep_days_monetization integer default 120,
  p_keep_days_webhook integer default 45
)
returns table (
  monetization_deleted bigint,
  webhook_deleted bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keep_monetization integer := greatest(7, coalesce(p_keep_days_monetization, 120));
  v_keep_webhook integer := greatest(7, coalesce(p_keep_days_webhook, 45));
  v_monetization_deleted bigint := 0;
  v_webhook_deleted bigint := 0;
begin
  with deleted as (
    delete from public.monetization_event_log
    where created_at < now() - (v_keep_monetization || ' days')::interval
    returning 1
  )
  select count(*) into v_monetization_deleted from deleted;

  with deleted as (
    delete from public.revenuecat_webhook_events
    where received_at < now() - (v_keep_webhook || ' days')::interval
    returning 1
  )
  select count(*) into v_webhook_deleted from deleted;

  return query
  select v_monetization_deleted, v_webhook_deleted;
end;
$$;

comment on function public.cleanup_billing_telemetry_retention(integer, integer) is
'Deletes old rows from monetization_event_log and revenuecat_webhook_events based on retention days.';

revoke all on function public.cleanup_billing_telemetry_retention(integer, integer) from public;
grant execute on function public.cleanup_billing_telemetry_retention(integer, integer) to service_role;

do $$
declare
  v_job_name text := 'cleanup_billing_telemetry_daily';
begin
  if exists(select 1 from cron.job where jobname = v_job_name) then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = v_job_name;
  end if;

  perform cron.schedule(
    v_job_name,
    '17 3 * * *',
    'select public.cleanup_billing_telemetry_retention();'
  );
end
$$;
