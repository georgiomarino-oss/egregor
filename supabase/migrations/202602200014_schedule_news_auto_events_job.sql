-- Schedule automatic news-triggered compassion event generation.
-- Calls the Edge Function /functions/v1/news-auto-events every 15 minutes.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

create or replace function public.trigger_news_auto_events_job()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  project_url text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://hfemycthnnmsjbuqnqoi.supabase.co'
  );
  anon_key text := coalesce(nullif(current_setting('app.settings.anon_key', true), ''), '');
  cron_token text := coalesce(nullif(current_setting('app.settings.news_autogen_cron_token', true), ''), '');
  req_headers jsonb := jsonb_build_object(
    'Content-Type', 'application/json'
  );
  request_id bigint;
begin
  if anon_key <> '' then
    req_headers := req_headers || jsonb_build_object(
      'apikey', anon_key,
      'Authorization', 'Bearer ' || anon_key
    );
  end if;

  if cron_token <> '' then
    req_headers := req_headers || jsonb_build_object(
      'x-egregor-cron-token', cron_token
    );
  end if;

  select net.http_post(
    url := project_url || '/functions/v1/news-auto-events',
    headers := req_headers,
    body := jsonb_build_object(
      'region', 'GLOBAL',
      'dryRun', false
    )
  )
  into request_id;

  return request_id;
end;
$$;

comment on function public.trigger_news_auto_events_job() is
'Triggers the news-auto-events Edge Function via pg_net and returns the request id.';

do $$
declare
  v_job_name text := 'news_auto_events_every_15m';
begin
  if exists(select 1 from cron.job where jobname = v_job_name) then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = v_job_name;
  end if;

  perform cron.schedule(
    v_job_name,
    '*/15 * * * *',
    'select public.trigger_news_auto_events_job();'
  );
end
$$;
