-- supabase/migrations/202602190001_event_run_state.sql

begin;

-- Shared guided-flow state per event (host-controlled)
create table if not exists public.event_run_state (
  event_id uuid primary key references public.events(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_event_run_state_updated_at on public.event_run_state;
create trigger trg_event_run_state_updated_at
before update on public.event_run_state
for each row execute procedure public.set_updated_at();

-- Realtime
alter table public.event_run_state replica identity full;

do $$
begin
  -- In many Supabase projects, this publication exists and powers Realtime.
  -- If it doesn't exist in your project, you can enable Realtime for the table in the dashboard instead.
  execute 'alter publication supabase_realtime add table public.event_run_state';
exception
  when undefined_object then
    -- publication doesn't exist; ignore
    null;
  when duplicate_object then
    -- already added; ignore
    null;
  when others then
    -- ignore publication errors to avoid blocking migration
    null;
end;
$$;

-- RLS
alter table public.event_run_state enable row level security;

-- Everyone authenticated can read run state (so attendees can follow along)
drop policy if exists "event_run_state_select_authenticated" on public.event_run_state;
create policy "event_run_state_select_authenticated"
on public.event_run_state
for select
to authenticated
using (true);

-- Only the event host (or creator) can insert the row
drop policy if exists "event_run_state_insert_host" on public.event_run_state;
create policy "event_run_state_insert_host"
on public.event_run_state
for insert
to authenticated
with check (
  auth.uid() = (select e.host_user_id from public.events e where e.id = event_id)
  or auth.uid() = (select e.created_by from public.events e where e.id = event_id)
);

-- Only the event host (or creator) can update the run state
drop policy if exists "event_run_state_update_host" on public.event_run_state;
create policy "event_run_state_update_host"
on public.event_run_state
for update
to authenticated
using (
  auth.uid() = (select e.host_user_id from public.events e where e.id = event_id)
  or auth.uid() = (select e.created_by from public.events e where e.id = event_id)
)
with check (
  auth.uid() = (select e.host_user_id from public.events e where e.id = event_id)
  or auth.uid() = (select e.created_by from public.events e where e.id = event_id)
);

commit;
