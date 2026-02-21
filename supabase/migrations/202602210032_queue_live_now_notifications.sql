-- Queue in-app "live now" notifications for events that just started.

create extension if not exists pg_cron with schema extensions;

create or replace function public.queue_live_now_notifications(
  p_lookback_minutes integer default 10,
  p_recent_participant_days integer default 30,
  p_max_events integer default 120,
  p_max_recipients_per_event integer default 4000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_lookback_minutes integer := greatest(2, least(coalesce(p_lookback_minutes, 10), 180));
  v_recent_participant_days integer := greatest(1, least(coalesce(p_recent_participant_days, 30), 180));
  v_max_events integer := greatest(1, least(coalesce(p_max_events, 120), 500));
  v_max_recipients_per_event integer := greatest(20, least(coalesce(p_max_recipients_per_event, 4000), 20000));
begin
  with candidate_events as (
    select
      e.id,
      coalesce(nullif(trim(e.title), ''), 'Live circle') as title,
      e.start_time_utc
    from public.events e
    where coalesce(e.visibility, 'PUBLIC') = 'PUBLIC'
      and e.start_time_utc <= now()
      and e.start_time_utc >= now() - make_interval(mins => v_lookback_minutes)
      and e.end_time_utc >= now()
      and coalesce(lower(e.status), 'scheduled') <> 'ended'
      and coalesce(lower(e.status), 'scheduled') <> 'cancelled'
    order by e.start_time_utc desc
    limit v_max_events
  ),
  recipient_candidates as (
    select
      ce.id as event_id,
      ce.title,
      ce.start_time_utc,
      rp.user_id
    from candidate_events ce
    join lateral (
      select distinct ep.user_id
      from public.event_presence ep
      where ep.event_id = ce.id
        and ep.last_seen_at >= now() - make_interval(days => v_recent_participant_days)
      order by ep.user_id
      limit v_max_recipients_per_event
    ) rp on true
  ),
  candidate_rows as (
    select
      'live_now'::text as kind,
      rc.user_id as user_id,
      rc.event_id as event_id,
      'live_now:' || rc.event_id::text || ':' || rc.user_id::text as dedupe_key,
      now() as created_at,
      (rc.title || ' is live now')::text as title,
      'Join now to sync with the active circle.'::text as body,
      jsonb_build_object(
        'event_id', rc.event_id::text,
        'start_time_utc', rc.start_time_utc,
        'source', 'events'
      ) as metadata
    from recipient_candidates rc
  ),
  inserted as (
    insert into public.notification_log (kind, user_id, event_id, dedupe_key, created_at, title, body, metadata)
    select
      c.kind,
      c.user_id,
      c.event_id,
      c.dedupe_key,
      c.created_at,
      c.title,
      c.body,
      c.metadata
    from candidate_rows c
    where not exists (
      select 1
      from public.notification_log n
      where n.kind = c.kind
        and n.dedupe_key = c.dedupe_key
    )
    returning 1
  )
  select count(*) into v_inserted
  from inserted;

  return v_inserted;
end;
$$;

comment on function public.queue_live_now_notifications(integer, integer, integer, integer) is
'Queues per-user in-app notifications for PUBLIC events that have just started.';

revoke all on function public.queue_live_now_notifications(integer, integer, integer, integer) from public;
grant execute on function public.queue_live_now_notifications(integer, integer, integer, integer) to service_role;

do $$
declare
  v_job_name text := 'queue_live_now_notifications_every_5_minutes';
begin
  if exists(select 1 from cron.job where jobname = v_job_name) then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = v_job_name;
  end if;

  perform cron.schedule(
    v_job_name,
    '*/5 * * * *',
    'select public.queue_live_now_notifications();'
  );
end
$$;
