-- Allow users to SELECT scripts they own OR scripts that are attached
-- to events they can see (PUBLIC events, or events they host).
-- This prevents "Cannot coerce the result to a single JSON object" when
-- EventRoom fetches scripts for an attached event.

alter table public.scripts enable row level security;

drop policy if exists "scripts_select_own_or_attached" on public.scripts;

create policy "scripts_select_own_or_attached"
on public.scripts
for select
using (
  -- owner can always read
  author_user_id = auth.uid()
  OR
  -- or script is attached to an event the user can see
  exists (
    select 1
    from public.events e
    where e.script_id = public.scripts.id
      and (
        e.visibility = 'PUBLIC'
        or e.host_user_id = auth.uid()
      )
  )
);
