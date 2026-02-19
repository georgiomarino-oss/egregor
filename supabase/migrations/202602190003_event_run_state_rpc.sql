-- supabase/migrations/202602190003_event_run_state_rpc.sql
begin;

-- Function: set the run state using server time for timestamps.
-- Security definer so we can read auth.uid() and enforce host/creator check centrally.
create or replace function public.set_event_run_state(
  p_event_id uuid,
  p_mode text,
  p_section_index int,
  p_elapsed_before_pause_sec int default 0,
  p_reset_timer boolean default false
)
returns public.event_run_state
language plpgsql
security definer
as $$
declare
  v_uid uuid;
  v_host uuid;
  v_creator uuid;
  v_now timestamptz;
  v_existing jsonb;
  v_next jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select e.host_user_id, e.created_by
    into v_host, v_creator
  from public.events e
  where e.id = p_event_id;

  if v_host is null and v_creator is null then
    raise exception 'Event not found';
  end if;

  if not (v_uid = v_host or v_uid = v_creator) then
    raise exception 'Not authorized';
  end if;

  v_now := now();

  -- Ensure row exists
  insert into public.event_run_state(event_id, state)
  values (p_event_id, jsonb_build_object('version', 1, 'mode', 'idle', 'sectionIndex', 0))
  on conflict (event_id) do nothing;

  select state into v_existing
  from public.event_run_state
  where event_id = p_event_id;

  -- Build next state
  v_next := jsonb_build_object(
    'version', 1,
    'mode', p_mode,
    'sectionIndex', greatest(0, p_section_index),
    'elapsedBeforePauseSec', greatest(0, coalesce(p_elapsed_before_pause_sec, 0))
  );

  -- Use server timestamps only when relevant
  if p_mode = 'running' then
    v_next := v_next || jsonb_build_object(
      'startedAt', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  elsif p_mode = 'paused' then
    v_next := v_next || jsonb_build_object(
      'pausedAt', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  end if;

  -- Optionally reset timer
  if p_reset_timer then
    v_next := v_next || jsonb_build_object('elapsedBeforePauseSec', 0);
  end if;

  update public.event_run_state
  set state = v_next
  where event_id = p_event_id;

  return (select ers from public.event_run_state ers where ers.event_id = p_event_id);
end;
$$;

-- Lock down execute permissions
revoke all on function public.set_event_run_state(uuid, text, int, int, boolean) from public;
grant execute on function public.set_event_run_state(uuid, text, int, int, boolean) to authenticated;

commit;
