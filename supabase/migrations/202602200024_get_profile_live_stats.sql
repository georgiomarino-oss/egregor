-- Consolidated profile and collective impact counters for ProfileScreen.
-- Replaces multiple heavy client queries with one RPC call.

create or replace function public.get_profile_live_stats(
  p_user_id uuid default auth.uid()
)
returns table (
  streak_days integer,
  active_days_30 integer,
  intention_energy integer,
  rhythm_sun integer,
  rhythm_mon integer,
  rhythm_tue integer,
  rhythm_wed integer,
  rhythm_thu integer,
  rhythm_fri integer,
  rhythm_sat integer,
  live_events_now bigint,
  active_participants_now bigint,
  prayers_week bigint,
  shared_intentions_week bigint
)
language sql
security invoker
set search_path = public
as $$
  with resolved_user as (
    select coalesce(p_user_id, auth.uid()) as user_id
  ),
  user_presence as (
    select
      ep.event_id,
      coalesce(ep.last_seen_at, ep.joined_at) as seen_at
    from public.event_presence ep
    join resolved_user ru on ru.user_id = ep.user_id
    where coalesce(ep.last_seen_at, ep.joined_at) is not null
  ),
  user_days as (
    select distinct (seen_at at time zone 'utc')::date as day
    from user_presence
  ),
  anchor as (
    select
      case
        when exists (
          select 1
          from user_days d
          where d.day = (now() at time zone 'utc')::date
        ) then (now() at time zone 'utc')::date
        else ((now() at time zone 'utc')::date - 1)
      end as anchor_day
  ),
  streak_flags as (
    select
      gs.n,
      exists (
        select 1
        from user_days d
        cross join anchor a
        where d.day = (a.anchor_day - gs.n)
      ) as has_day
    from generate_series(0, 366) as gs(n)
  ),
  streak_calc as (
    select coalesce(min(n), 367)::integer as first_missing
    from streak_flags
    where has_day = false
  ),
  personal as (
    select
      greatest(0, (select first_missing from streak_calc))::integer as streak_days,
      coalesce(
        (
          select count(*)::integer
          from user_days d
          where d.day >= ((now() at time zone 'utc')::date - 29)
        ),
        0
      ) as active_days_30,
      coalesce(
        (
          select count(distinct up.event_id)::integer
          from user_presence up
        ),
        0
      ) as intention_energy
  ),
  rhythm as (
    select
      coalesce(
        count(*) filter (
          where seen_at >= now() - interval '14 days'
            and extract(dow from seen_at) = 0
        ),
        0
      )::integer as rhythm_sun,
      coalesce(
        count(*) filter (
          where seen_at >= now() - interval '14 days'
            and extract(dow from seen_at) = 1
        ),
        0
      )::integer as rhythm_mon,
      coalesce(
        count(*) filter (
          where seen_at >= now() - interval '14 days'
            and extract(dow from seen_at) = 2
        ),
        0
      )::integer as rhythm_tue,
      coalesce(
        count(*) filter (
          where seen_at >= now() - interval '14 days'
            and extract(dow from seen_at) = 3
        ),
        0
      )::integer as rhythm_wed,
      coalesce(
        count(*) filter (
          where seen_at >= now() - interval '14 days'
            and extract(dow from seen_at) = 4
        ),
        0
      )::integer as rhythm_thu,
      coalesce(
        count(*) filter (
          where seen_at >= now() - interval '14 days'
            and extract(dow from seen_at) = 5
        ),
        0
      )::integer as rhythm_fri,
      coalesce(
        count(*) filter (
          where seen_at >= now() - interval '14 days'
            and extract(dow from seen_at) = 6
        ),
        0
      )::integer as rhythm_sat
    from user_presence
  ),
  collective as (
    select
      coalesce(
        (
          select count(*)
          from public.events e
          where e.start_time_utc <= now()
            and (e.end_time_utc is null or e.end_time_utc >= now())
        ),
        0
      ) as live_events_now,
      coalesce(
        (
          select count(*)
          from public.event_presence ep
          where ep.last_seen_at >= now() - interval '90 seconds'
        ),
        0
      ) as active_participants_now,
      coalesce(
        (
          select count(*)
          from public.event_presence ep
          where ep.last_seen_at >= now() - interval '7 days'
        ),
        0
      ) as prayers_week,
      coalesce(
        (
          select count(*)
          from public.event_messages em
          where em.created_at >= now() - interval '7 days'
        ),
        0
      ) as shared_intentions_week
  )
  select
    p.streak_days,
    p.active_days_30,
    p.intention_energy,
    r.rhythm_sun,
    r.rhythm_mon,
    r.rhythm_tue,
    r.rhythm_wed,
    r.rhythm_thu,
    r.rhythm_fri,
    r.rhythm_sat,
    c.live_events_now,
    c.active_participants_now,
    c.prayers_week,
    c.shared_intentions_week
  from personal p
  cross join rhythm r
  cross join collective c;
$$;

comment on function public.get_profile_live_stats(uuid) is
'Returns per-user profile stats and collective activity counters for ProfileScreen.';

revoke all on function public.get_profile_live_stats(uuid) from public;
grant execute on function public.get_profile_live_stats(uuid) to authenticated;
grant execute on function public.get_profile_live_stats(uuid) to service_role;
