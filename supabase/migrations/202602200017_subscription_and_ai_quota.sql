-- Server-authoritative subscription state + AI generation quota tracking.

create table if not exists public.user_subscription_state (
  user_id uuid not null,
  provider text not null default 'revenuecat',
  entitlement_id text not null default 'egregor_circle',
  is_active boolean not null default false,
  product_id text null,
  store text null,
  environment text null,
  expires_at timestamptz null,
  original_transaction_id text null,
  last_event_type text null,
  last_event_id text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_subscription_state_pkey primary key (user_id, provider, entitlement_id)
);

create index if not exists user_subscription_state_active_idx
on public.user_subscription_state (user_id, entitlement_id, is_active, expires_at);

create table if not exists public.ai_generation_usage_daily (
  user_id uuid not null,
  usage_date date not null default ((now() at time zone 'utc')::date),
  mode text not null check (mode in ('event_script', 'solo_guidance')),
  usage_count integer not null default 0 check (usage_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_generation_usage_daily_pkey primary key (user_id, usage_date, mode)
);

create index if not exists ai_generation_usage_daily_lookup_idx
on public.ai_generation_usage_daily (user_id, usage_date, mode);

alter table if exists public.user_subscription_state enable row level security;
alter table if exists public.ai_generation_usage_daily enable row level security;

drop policy if exists "user_subscription_state_select_own" on public.user_subscription_state;
create policy "user_subscription_state_select_own"
on public.user_subscription_state
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "ai_generation_usage_daily_select_own" on public.ai_generation_usage_daily;
create policy "ai_generation_usage_daily_select_own"
on public.ai_generation_usage_daily
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.is_circle_member(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_subscription_state s
    where s.user_id = p_user_id
      and s.entitlement_id = 'egregor_circle'
      and s.is_active = true
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

grant execute on function public.is_circle_member(uuid) to authenticated;

create or replace function public.get_ai_generation_quota(p_mode text)
returns table (
  is_premium boolean,
  used_today integer,
  limit_daily integer,
  remaining integer,
  allowed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  quota_limit integer;
  usage integer := 0;
  premium boolean := false;
  today_utc date := (now() at time zone 'utc')::date;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_mode not in ('event_script', 'solo_guidance') then
    raise exception 'Invalid mode: %', p_mode using errcode = '22023';
  end if;

  premium := public.is_circle_member(uid);
  quota_limit := case
    when p_mode = 'event_script' then 3
    when p_mode = 'solo_guidance' then 2
    else 0
  end;

  select coalesce(u.usage_count, 0)
  into usage
  from public.ai_generation_usage_daily u
  where u.user_id = uid
    and u.usage_date = today_utc
    and u.mode = p_mode;

  if premium then
    return query
    select true, usage, null::integer, null::integer, true;
  else
    return query
    select
      false,
      usage,
      quota_limit,
      greatest(quota_limit - usage, 0),
      usage < quota_limit;
  end if;
end;
$$;

grant execute on function public.get_ai_generation_quota(text) to authenticated;

create or replace function public.consume_ai_generation_quota(p_mode text)
returns table (
  is_premium boolean,
  used_today integer,
  limit_daily integer,
  remaining integer,
  allowed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  quota_limit integer;
  premium boolean;
  touched integer := 0;
  today_utc date := (now() at time zone 'utc')::date;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_mode not in ('event_script', 'solo_guidance') then
    raise exception 'Invalid mode: %', p_mode using errcode = '22023';
  end if;

  premium := public.is_circle_member(uid);
  if premium then
    return query
    select *
    from public.get_ai_generation_quota(p_mode);
    return;
  end if;

  quota_limit := case
    when p_mode = 'event_script' then 3
    when p_mode = 'solo_guidance' then 2
    else 0
  end;

  insert into public.ai_generation_usage_daily (user_id, usage_date, mode, usage_count)
  values (uid, today_utc, p_mode, 0)
  on conflict (user_id, usage_date, mode) do nothing;

  update public.ai_generation_usage_daily
  set usage_count = usage_count + 1,
      updated_at = now()
  where user_id = uid
    and usage_date = today_utc
    and mode = p_mode
    and usage_count < quota_limit;

  get diagnostics touched = row_count;

  if touched = 0 then
    return query
    select *
    from public.get_ai_generation_quota(p_mode);
    return;
  end if;

  return query
  select *
  from public.get_ai_generation_quota(p_mode);
end;
$$;

grant execute on function public.consume_ai_generation_quota(text) to authenticated;
