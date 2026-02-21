-- Queue in-app "starts soon" notifications for upcoming live events.

create extension if not exists pg_cron with schema extensions;

create or replace function public.queue_live_event_notifications(
  p_lookahead_minutes integer default 60,
  p_recent_participant_days integer default 14,
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
  v_lookahead_minutes integer := greatest(5, least(coalesce(p_lookahead_minutes, 60), 1440));
  v_recent_participant_days integer := greatest(1, least(coalesce(p_recent_participant_days, 14), 90));
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
      and e.start_time_utc >= now()
      and e.start_time_utc <= now() + make_interval(mins => v_lookahead_minutes)
      and coalesce(lower(e.status), 'scheduled') <> 'ended'
      and coalesce(lower(e.status), 'scheduled') <> 'cancelled'
    order by e.start_time_utc asc
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
      'live_soon'::text as kind,
      rc.user_id as user_id,
      rc.event_id as event_id,
      'live_soon:' || rc.event_id::text || ':' || rc.user_id::text as dedupe_key,
      now() as created_at,
      (rc.title || ' starts soon')::text as title,
      (
        'Starts in ' ||
        greatest(
          1,
          ceil(extract(epoch from (rc.start_time_utc - now())) / 60.0)::integer
        )::text ||
        'm. Tap to enter the room.'
      )::text as body,
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

comment on function public.queue_live_event_notifications(integer, integer, integer, integer) is
'Queues per-user in-app notifications for upcoming PUBLIC events based on recent participation.';

revoke all on function public.queue_live_event_notifications(integer, integer, integer, integer) from public;
grant execute on function public.queue_live_event_notifications(integer, integer, integer, integer) to service_role;

do $$
declare
  v_job_name text := 'queue_live_event_notifications_every_5_minutes';
begin
  if exists(select 1 from cron.job where jobname = v_job_name) then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = v_job_name;
  end if;

  perform cron.schedule(
    v_job_name,
    '*/5 * * * *',
    'select public.queue_live_event_notifications();'
  );
end
$$;
