-- Client-side monetization funnel telemetry (purchase/restore attempts and outcomes).

create table if not exists public.monetization_event_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  event_name text not null,
  stage text not null
    check (stage in ('attempt', 'success', 'failure', 'cancelled', 'info')),
  provider text null default 'revenuecat',
  platform text null,
  package_identifier text null,
  entitlement_id text null,
  is_circle_member boolean null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists monetization_event_log_user_created_idx
on public.monetization_event_log (user_id, created_at desc);

create index if not exists monetization_event_log_event_stage_idx
on public.monetization_event_log (event_name, stage, created_at desc);

alter table if exists public.monetization_event_log enable row level security;

drop policy if exists "monetization_event_log_select_own" on public.monetization_event_log;
create policy "monetization_event_log_select_own"
on public.monetization_event_log
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "monetization_event_log_insert_own" on public.monetization_event_log;
create policy "monetization_event_log_insert_own"
on public.monetization_event_log
for insert
to authenticated
with check (user_id = auth.uid());

grant select, insert on table public.monetization_event_log to authenticated;
grant all on table public.monetization_event_log to service_role;
