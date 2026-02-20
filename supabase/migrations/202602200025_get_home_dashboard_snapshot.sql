-- Consolidated HomeScreen dashboard snapshot.
-- Returns weekly impact counters + active presence counters + feed items.

create or replace function public.get_home_dashboard_snapshot()
returns table (
  weekly_impact bigint,
  previous_weekly_impact bigint,
  active_global_participants bigint,
  active_global_events bigint,
  feed_items jsonb
)
language sql
security invoker
set search_path = public
as $$
  with now_ref as (
    select now() as ts
  ),
  feed_source as (
    select
      m.id::text as id,
      m.body as body,
      m.created_at as created_at,
      m.event_id::text as event_id,
      m.user_id::text as user_id,
      coalesce(nullif(trim(e.title), ''), 'Live circle') as event_title,
      coalesce(
        nullif(trim(p.display_name), ''),
        substr(m.user_id::text, 1, 6) || '...' || right(m.user_id::text, 4)
      ) as display_name
    from public.event_messages m
    join public.events e on e.id = m.event_id
    left join public.profiles p on p.id = m.user_id
    where length(trim(coalesce(m.body, ''))) > 0
    order by m.created_at desc
    limit 6
  ),
  feed_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', fs.id,
          'body', fs.body,
          'createdAt', fs.created_at,
          'eventId', fs.event_id,
          'userId', fs.user_id,
          'eventTitle', fs.event_title,
          'displayName', fs.display_name
        )
        order by fs.created_at desc
      ),
      '[]'::jsonb
    ) as items
    from feed_source fs
  )
  select
    coalesce(
      (
        select count(*)
        from public.event_presence ep
        cross join now_ref nr
        where ep.last_seen_at >= nr.ts - interval '7 days'
      ),
      0
    ) as weekly_impact,
    coalesce(
      (
        select count(*)
        from public.event_presence ep
        cross join now_ref nr
        where ep.last_seen_at >= nr.ts - interval '14 days'
          and ep.last_seen_at < nr.ts - interval '7 days'
      ),
      0
    ) as previous_weekly_impact,
    coalesce(
      (
        select count(*)
        from public.event_presence ep
        cross join now_ref nr
        where ep.last_seen_at >= nr.ts - interval '90 seconds'
      ),
      0
    ) as active_global_participants,
    coalesce(
      (
        select count(distinct ep.event_id)
        from public.event_presence ep
        cross join now_ref nr
        where ep.last_seen_at >= nr.ts - interval '90 seconds'
      ),
      0
    ) as active_global_events,
    (select items from feed_json) as feed_items;
$$;

comment on function public.get_home_dashboard_snapshot() is
'Returns home dashboard counters and recent community feed items in one call.';

revoke all on function public.get_home_dashboard_snapshot() from public;
grant execute on function public.get_home_dashboard_snapshot() to authenticated;
grant execute on function public.get_home_dashboard_snapshot() to service_role;
