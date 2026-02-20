-- Align event_run_state insert policy with host-only model.

begin;

drop policy if exists "event_run_state_insert_authenticated" on public.event_run_state;
drop policy if exists "event_run_state_insert_host_only" on public.event_run_state;
drop policy if exists "event_run_state_insert_host" on public.event_run_state;

create policy "event_run_state_insert_host_only"
on public.event_run_state
for insert
to authenticated
with check (
  exists (
    select 1
    from public.events e
    where e.id = event_id
      and (e.host_user_id = auth.uid() or e.created_by = auth.uid())
  )
);

commit;
