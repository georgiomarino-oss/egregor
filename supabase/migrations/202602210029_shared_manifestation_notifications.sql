-- Queue in-app notifications for shared anonymous manifestation journal entries.

create extension if not exists pg_cron with schema extensions;

alter table if exists public.notification_log
  add column if not exists title text;

alter table if exists public.notification_log
  add column if not exists body text;

alter table if exists public.notification_log
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists notification_log_user_created_idx
on public.notification_log (user_id, created_at desc);

create index if not exists notification_log_kind_created_idx
on public.notification_log (kind, created_at desc);

create index if not exists notification_log_kind_dedupe_idx
on public.notification_log (kind, dedupe_key);

alter table if exists public.notification_log enable row level security;

drop policy if exists "notification_log_select_own" on public.notification_log;
create policy "notification_log_select_own"
on public.notification_log
for select
to authenticated
using (user_id = auth.uid());

grant select on table public.notification_log to authenticated;
grant all on table public.notification_log to service_role;

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
    where p.id is not null
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
'Queues per-user in-app notifications for shared anonymous manifestation journal entries.';

revoke all on function public.queue_shared_manifestation_notifications(integer, integer, integer) from public;
grant execute on function public.queue_shared_manifestation_notifications(integer, integer, integer) to service_role;

do $$
declare
  v_job_name text := 'queue_shared_manifestation_notifications_every_10_minutes';
begin
  if exists(select 1 from cron.job where jobname = v_job_name) then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = v_job_name;
  end if;

  perform cron.schedule(
    v_job_name,
    '*/10 * * * *',
    'select public.queue_shared_manifestation_notifications();'
  );
end
$$;
