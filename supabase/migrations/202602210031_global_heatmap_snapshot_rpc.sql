-- Server-side snapshot for the Global Heat Map screen.

create or replace function public.get_global_heatmap_snapshot(
  p_window text default '90s',
  p_max_events integer default 500,
  p_max_manifestations integer default 300
)
returns table (
  generated_at timestamptz,
  active_by_region jsonb,
  live_events jsonb,
  manifestations jsonb
)
language sql
security invoker
set search_path = public
as $$
  with params as (
    select
      now() as ts,
      case lower(coalesce(p_window, '90s'))
        when '24h' then interval '24 hours'
        when '7d' then interval '7 days'
        else interval '90 seconds'
      end as window_interval,
      case lower(coalesce(p_window, '90s'))
        when '24h' then '24h'
        when '7d' then '7d'
        else '90s'
      end as window_key,
      greatest(10, least(coalesce(p_max_events, 500), 1000)) as max_events,
      greatest(10, least(coalesce(p_max_manifestations, 300), 1000)) as max_manifestations
  ),
  events_with_region as (
    select
      e.id,
      e.title,
      e.start_time_utc,
      e.end_time_utc,
      e.timezone,
      e.intention_statement,
      case
        when lower(coalesce(e.timezone, '')) like 'america/%' then 'Americas'
        when lower(coalesce(e.timezone, '')) like 'europe/%' then 'Europe'
        when lower(coalesce(e.timezone, '')) like 'asia/%' then 'Asia'
        when lower(coalesce(e.timezone, '')) like 'africa/%' then 'Africa'
        when lower(coalesce(e.timezone, '')) like 'australia/%'
          or lower(coalesce(e.timezone, '')) like 'pacific/%' then 'Oceania'
        else 'Global'
      end as region
    from public.events e
    where coalesce(e.visibility, 'PUBLIC') = 'PUBLIC'
  ),
  presence_counts as (
    select
      ew.region,
      count(*)::bigint as cnt
    from params p
    join public.event_presence ep
      on ep.last_seen_at >= p.ts - p.window_interval
    join events_with_region ew
      on ew.id = ep.event_id
    group by ew.region
  ),
  active_json as (
    select jsonb_build_object(
      'Americas', coalesce((select cnt from presence_counts where region = 'Americas'), 0),
      'Europe', coalesce((select cnt from presence_counts where region = 'Europe'), 0),
      'Asia', coalesce((select cnt from presence_counts where region = 'Asia'), 0),
      'Africa', coalesce((select cnt from presence_counts where region = 'Africa'), 0),
      'Oceania', coalesce((select cnt from presence_counts where region = 'Oceania'), 0),
      'Global', coalesce((select cnt from presence_counts where region = 'Global'), 0)
    ) as data
  ),
  live_rows as (
    select
      ew.region,
      ew.id,
      ew.title,
      ew.start_time_utc,
      ew.end_time_utc,
      ew.timezone,
      ew.intention_statement
    from params p
    join events_with_region ew
      on (
        (
          p.window_key = '90s'
          and ew.start_time_utc <= p.ts
          and ew.end_time_utc >= p.ts
        )
        or
        (
          p.window_key <> '90s'
          and ew.start_time_utc >= p.ts - p.window_interval
          and ew.start_time_utc <= p.ts
        )
      )
    order by ew.start_time_utc desc
    limit (select max_events from params)
  ),
  live_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'region', lr.region,
          'id', lr.id,
          'title', lr.title,
          'start_time_utc', lr.start_time_utc,
          'end_time_utc', lr.end_time_utc,
          'timezone', lr.timezone,
          'intention_statement', lr.intention_statement
        )
        order by lr.start_time_utc desc
      ),
      '[]'::jsonb
    ) as data
    from live_rows lr
  ),
  manifestation_rows as (
    select
      ew.region,
      m.id,
      m.event_id,
      m.body,
      m.created_at,
      coalesce(nullif(trim(ew.title), ''), 'Live circle') as event_title
    from params p
    join public.event_messages m
      on m.created_at >= p.ts - p.window_interval
    join events_with_region ew
      on ew.id = m.event_id
    where char_length(trim(coalesce(m.body, ''))) > 0
    order by m.created_at desc
    limit (select max_manifestations from params)
  ),
  manifestations_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'region', mr.region,
          'id', mr.id,
          'event_id', mr.event_id,
          'body', mr.body,
          'created_at', mr.created_at,
          'event_title', mr.event_title
        )
        order by mr.created_at desc
      ),
      '[]'::jsonb
    ) as data
    from manifestation_rows mr
  )
  select
    (select ts from params) as generated_at,
    (select data from active_json) as active_by_region,
    (select data from live_json) as live_events,
    (select data from manifestations_json) as manifestations;
$$;

comment on function public.get_global_heatmap_snapshot(text, integer, integer) is
'Returns regional heat metrics + event/message snapshots for the Global Heat Map screen.';

revoke all on function public.get_global_heatmap_snapshot(text, integer, integer) from public;
grant execute on function public.get_global_heatmap_snapshot(text, integer, integer) to authenticated;
grant execute on function public.get_global_heatmap_snapshot(text, integer, integer) to service_role;
