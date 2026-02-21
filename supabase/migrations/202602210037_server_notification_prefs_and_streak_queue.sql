-- Server-side notification prefs + streak reminder queueing.

create extension if not exists pg_cron with schema extensions;

create table if not exists public.user_notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notify_live_start boolean not null default true,
  notify_news_events boolean not null default true,
  notify_friend_invites boolean not null default true,
  notify_streak_reminders boolean not null default true,
  show_community_feed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_notification_prefs_updated_idx
  on public.user_notification_prefs (updated_at desc);

alter table if exists public.user_notification_prefs enable row level security;

drop policy if exists "user_notification_prefs_select_own" on public.user_notification_prefs;
create policy "user_notification_prefs_select_own"
on public.user_notification_prefs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_notification_prefs_insert_own" on public.user_notification_prefs;
create policy "user_notification_prefs_insert_own"
on public.user_notification_prefs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_notification_prefs_update_own" on public.user_notification_prefs;
create policy "user_notification_prefs_update_own"
on public.user_notification_prefs
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

revoke all on table public.user_notification_prefs from public;
grant select, insert, update on table public.user_notification_prefs to authenticated;
grant all on table public.user_notification_prefs to service_role;

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
      left join public.user_notification_prefs up
        on up.user_id = ep.user_id
      where ep.event_id = ce.id
        and ep.last_seen_at >= now() - make_interval(days => v_recent_participant_days)
        and coalesce(up.notify_live_start, true) = true
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
'Queues per-user in-app notifications for upcoming PUBLIC events based on recent participation and server-side notification prefs.';

revoke all on function public.queue_live_event_notifications(integer, integer, integer, integer) from public;
grant execute on function public.queue_live_event_notifications(integer, integer, integer, integer) to service_role;

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
      left join public.user_notification_prefs up
        on up.user_id = ep.user_id
      where ep.event_id = ce.id
        and ep.last_seen_at >= now() - make_interval(days => v_recent_participant_days)
        and coalesce(up.notify_live_start, true) = true
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
'Queues per-user in-app notifications for PUBLIC events that have just started, honoring server-side notification prefs.';

revoke all on function public.queue_live_now_notifications(integer, integer, integer, integer) from public;
grant execute on function public.queue_live_now_notifications(integer, integer, integer, integer) to service_role;

create or replace function public.queue_news_event_notifications(
  p_lookback_hours integer default 48,
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
  v_lookback_hours integer := greatest(1, least(coalesce(p_lookback_hours, 48), 168));
  v_recent_participant_days integer := greatest(1, least(coalesce(p_recent_participant_days, 30), 180));
  v_max_events integer := greatest(1, least(coalesce(p_max_events, 120), 500));
  v_max_recipients_per_event integer := greatest(20, least(coalesce(p_max_recipients_per_event, 4000), 20000));
begin
  with candidate_events as (
    select
      e.id,
      coalesce(nullif(trim(e.title), ''), 'Compassion alert') as title,
      e.start_time_utc
    from public.events e
    where e.source = 'news'
      and e.created_at >= now() - make_interval(hours => v_lookback_hours)
      and coalesce(e.visibility, 'PUBLIC') = 'PUBLIC'
    order by e.created_at desc
    limit v_max_events
  ),
  recipients as (
    select distinct ep.user_id
    from public.event_presence ep
    left join public.user_notification_prefs up
      on up.user_id = ep.user_id
    where ep.last_seen_at >= now() - make_interval(days => v_recent_participant_days)
      and coalesce(up.notify_news_events, true) = true
  ),
  recipient_candidates as (
    select
      ce.id as event_id,
      ce.title,
      ce.start_time_utc,
      rc.user_id
    from candidate_events ce
    join lateral (
      select r.user_id
      from recipients r
      order by r.user_id
      limit v_max_recipients_per_event
    ) rc on true
  ),
  candidate_rows as (
    select
      'news_alert'::text as kind,
      rc.user_id as user_id,
      rc.event_id as event_id,
      'news_alert:' || rc.event_id::text || ':' || rc.user_id::text as dedupe_key,
      now() as created_at,
      ('Compassion alert: ' || rc.title)::text as title,
      'A new crisis-support prayer circle is available. Tap to join.'::text as body,
      jsonb_build_object(
        'event_id', rc.event_id::text,
        'start_time_utc', rc.start_time_utc,
        'source', 'news'
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

comment on function public.queue_news_event_notifications(integer, integer, integer, integer) is
'Queues per-user in-app notifications for recent auto-generated news events, honoring server-side notification prefs.';

revoke all on function public.queue_news_event_notifications(integer, integer, integer, integer) from public;
grant execute on function public.queue_news_event_notifications(integer, integer, integer, integer) to service_role;

create or replace function public.queue_shared_manifestation_notifications(
  p_lookback_minutes integer default 240,
  p_max_entries integer default 40,
  p_max_recipients integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_lookback_minutes integer := greatest(10, least(coalesce(p_lookback_minutes, 240), 43200));
  v_max_entries integer := greatest(1, least(coalesce(p_max_entries, 40), 200));
  v_max_recipients integer := greatest(10, least(coalesce(p_max_recipients, 5000), 20000));
begin
  with recent_entries as (
    select
      m.id,
      m.user_id,
      m.body,
      m.created_at
    from public.manifestation_journal_entries m
    where m.visibility = 'shared_anonymous'
      and m.created_at >= now() - make_interval(mins => v_lookback_minutes)
    order by m.created_at desc
    limit v_max_entries
  ),
  recipients as (
    select p.id as user_id
    from public.profiles p
    left join public.user_notification_prefs up
      on up.user_id = p.id
    where p.id is not null
      and coalesce(up.show_community_feed, true) = true
    order by p.updated_at desc
    limit v_max_recipients
  ),
  candidate_rows as (
    select
      'journal_shared'::text as kind,
      r.user_id as user_id,
      null::uuid as event_id,
      'journal_shared:' || e.id::text || ':' || r.user_id::text as dedupe_key,
      e.created_at as created_at,
      'New anonymous manifestation shared'::text as title,
      (
        case
          when char_length(trim(regexp_replace(coalesce(e.body, ''), '\s+', ' ', 'g'))) > 280 then
            left(trim(regexp_replace(coalesce(e.body, ''), '\s+', ' ', 'g')), 277) || '...'
          else trim(regexp_replace(coalesce(e.body, ''), '\s+', ' ', 'g'))
        end
      )::text as body,
      jsonb_build_object(
        'entry_id', e.id::text,
        'source', 'journal',
        'shared_at', e.created_at
      ) as metadata
    from recent_entries e
    join recipients r on r.user_id <> e.user_id
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

comment on function public.queue_shared_manifestation_notifications(integer, integer, integer) is
'Queues per-user in-app notifications for shared anonymous manifestation journal entries, honoring server-side notification prefs.';

revoke all on function public.queue_shared_manifestation_notifications(integer, integer, integer) from public;
grant execute on function public.queue_shared_manifestation_notifications(integer, integer, integer) to service_role;

create or replace function public.queue_streak_reminder_notifications(
  p_recent_participant_days integer default 30,
  p_max_recipients integer default 8000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_recent_participant_days integer := greatest(1, least(coalesce(p_recent_participant_days, 30), 365));
  v_max_recipients integer := greatest(100, least(coalesce(p_max_recipients, 8000), 50000));
  v_day_utc text := to_char(timezone('UTC', now()), 'YYYY-MM-DD');
begin
  with latest_presence as (
    select
      ep.user_id,
      max(ep.last_seen_at) as last_seen_at
    from public.event_presence ep
    where ep.last_seen_at >= now() - make_interval(days => v_recent_participant_days)
    group by ep.user_id
  ),
  due_users as (
    select lp.user_id
    from latest_presence lp
    left join public.user_notification_prefs up
      on up.user_id = lp.user_id
    where lp.last_seen_at < date_trunc('day', now() at time zone 'UTC')
      and coalesce(up.notify_streak_reminders, true) = true
    order by lp.last_seen_at desc
    limit v_max_recipients
  ),
  candidate_rows as (
    select
      'streak_reminder'::text as kind,
      du.user_id as user_id,
      null::uuid as event_id,
      'streak_reminder:' || v_day_utc || ':' || du.user_id::text as dedupe_key,
      now() as created_at,
      'Keep your streak alive'::text as title,
      'Join one live circle today to keep your momentum.'::text as body,
      jsonb_build_object(
        'source', 'streak',
        'day_utc', v_day_utc
      ) as metadata
    from due_users du
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

comment on function public.queue_streak_reminder_notifications(integer, integer) is
'Queues per-user streak reminder notifications (once per UTC day) for recently active users with no activity today.';

revoke all on function public.queue_streak_reminder_notifications(integer, integer) from public;
grant execute on function public.queue_streak_reminder_notifications(integer, integer) to service_role;

do $$
declare
  v_job_name text := 'queue_streak_reminder_notifications_every_3_hours';
begin
  if exists(select 1 from cron.job where jobname = v_job_name) then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = v_job_name;
  end if;

  perform cron.schedule(
    v_job_name,
    '15 */3 * * *',
    'select public.queue_streak_reminder_notifications();'
  );
end
$$;
