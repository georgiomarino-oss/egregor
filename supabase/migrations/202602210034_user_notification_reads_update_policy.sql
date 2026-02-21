-- Allow authenticated users to update their own notification read markers.
-- This is required for upsert(user_id, notification_id) conflict updates.

drop policy if exists "user_notification_reads_update_own" on public.user_notification_reads;
create policy "user_notification_reads_update_own"
on public.user_notification_reads
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant update on table public.user_notification_reads to authenticated;
