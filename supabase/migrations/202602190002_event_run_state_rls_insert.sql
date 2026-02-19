-- supabase/migrations/202602190002_event_run_state_rls_insert.sql
begin;

-- Replace the insert policy so attendees can create the initial row.
-- Updates remain host-only (from the previous migration).

drop policy if exists "event_run_state_insert_host" on public.event_run_state;

create policy "event_run_state_insert_authenticated"
on public.event_run_state
for insert
to authenticated
with check (
  exists (select 1 from public.events e where e.id = event_id)
);

commit;
