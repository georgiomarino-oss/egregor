-- Shared anonymous manifestation feed + home snapshot v2.

create or replace function public.get_shared_manifestation_feed(
  p_limit integer default 20
)
returns table (
  id text,
  body text,
  created_at timestamptz,
  event_id text,
  user_id text,
  event_title text,
  display_name text,
  source text
)
language sql
security definer
set search_path = public
as $$
  select
    'journal:' || m.id::text as id,
    m.body as body,
    m.created_at as created_at,
    null::text as event_id,
    ''::text as user_id,
    'Manifestation Journal'::text as event_title,
    'Anonymous'::text as display_name,
    'journal'::text as source
  from public.manifestation_journal_entries m
  where m.visibility = 'shared_anonymous'
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 60));
$$;

comment on function public.get_shared_manifestation_feed(integer) is
'Returns shared anonymous manifestation journal entries for community feed surfaces.';

revoke all on function public.get_shared_manifestation_feed(integer) from public;
grant execute on function public.get_shared_manifestation_feed(integer) to authenticated;
grant execute on function public.get_shared_manifestation_feed(integer) to service_role;

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
  chat_feed as (
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
      ) as display_name,
      'chat'::text as source
    from public.event_messages m
    join public.events e on e.id = m.event_id
    left join public.profiles p on p.id = m.user_id
    where length(trim(coalesce(m.body, ''))) > 0
    order by m.created_at desc
    limit 40
  ),
  journal_feed as (
    select *
    from public.get_shared_manifestation_feed(40)
  ),
  feed_source as (
    select * from chat_feed
    union all
    select * from journal_feed
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
          'displayName', fs.display_name,
          'source', fs.source
        )
        order by fs.created_at desc
      ),
      '[]'::jsonb
    ) as items
    from (
      select *
      from feed_source
      order by created_at desc
      limit 6
    ) fs
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
