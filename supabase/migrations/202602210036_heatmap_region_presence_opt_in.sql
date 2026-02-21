-- Anonymous region contribution for Global Heat Map opt-in users.

create table if not exists public.heatmap_region_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  region text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint heatmap_region_presence_region_check
    check (region in ('Americas', 'Europe', 'Asia', 'Africa', 'Oceania', 'Global'))
);

create index if not exists heatmap_region_presence_region_seen_idx
  on public.heatmap_region_presence (region, last_seen_at desc);

alter table if exists public.heatmap_region_presence enable row level security;

drop policy if exists "heatmap_region_presence_select_own" on public.heatmap_region_presence;
create policy "heatmap_region_presence_select_own"
on public.heatmap_region_presence
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "heatmap_region_presence_insert_own" on public.heatmap_region_presence;
create policy "heatmap_region_presence_insert_own"
on public.heatmap_region_presence
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "heatmap_region_presence_update_own" on public.heatmap_region_presence;
create policy "heatmap_region_presence_update_own"
on public.heatmap_region_presence
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "heatmap_region_presence_delete_own" on public.heatmap_region_presence;
create policy "heatmap_region_presence_delete_own"
on public.heatmap_region_presence
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.heatmap_region_presence from public;
grant select, insert, update, delete on table public.heatmap_region_presence to authenticated;
grant all on table public.heatmap_region_presence to service_role;

create or replace function public.contribute_heatmap_region(
  p_region text default 'Global'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_region text := case lower(coalesce(trim(p_region), ''))
    when 'americas' then 'Americas'
    when 'europe' then 'Europe'
    when 'asia' then 'Asia'
    when 'africa' then 'Africa'
    when 'oceania' then 'Oceania'
    else 'Global'
  end;
begin
  if v_uid is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  insert into public.heatmap_region_presence as h (user_id, region, last_seen_at, updated_at)
  values (v_uid, v_region, now(), now())
  on conflict (user_id)
  do update
    set region = excluded.region,
        last_seen_at = excluded.last_seen_at,
        updated_at = now();
end;
$$;

comment on function public.contribute_heatmap_region(text) is
'Stores an authenticated user''s current anonymous region heartbeat for global heat map intensity.';

revoke all on function public.contribute_heatmap_region(text) from public;
grant execute on function public.contribute_heatmap_region(text) to authenticated;
grant execute on function public.contribute_heatmap_region(text) to service_role;

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
  event_presence_counts as (
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
  opt_in_presence_counts as (
    select
      hp.region,
      count(*)::bigint as cnt
    from params p
    join public.heatmap_region_presence hp
      on hp.last_seen_at >= p.ts - p.window_interval
    group by hp.region
  ),
  presence_counts as (
    select region, sum(cnt)::bigint as cnt
    from (
      select region, cnt from event_presence_counts
      union all
      select region, cnt from opt_in_presence_counts
    ) all_counts
    group by region
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
'Returns regional heat metrics + event/message snapshots for the Global Heat Map screen, including opt-in region presence.';

revoke all on function public.get_global_heatmap_snapshot(text, integer, integer) from public;
grant execute on function public.get_global_heatmap_snapshot(text, integer, integer) to authenticated;
grant execute on function public.get_global_heatmap_snapshot(text, integer, integer) to service_role;
