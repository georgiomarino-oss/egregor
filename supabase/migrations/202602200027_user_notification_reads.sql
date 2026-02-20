-- Cross-device notification read-state per user.

create table if not exists public.user_notification_reads (
  user_id uuid not null,
  notification_id text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, notification_id)
);

create index if not exists user_notification_reads_user_read_at_idx
on public.user_notification_reads (user_id, read_at desc);

alter table if exists public.user_notification_reads enable row level security;

drop policy if exists "user_notification_reads_select_own" on public.user_notification_reads;
create policy "user_notification_reads_select_own"
on public.user_notification_reads
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "user_notification_reads_insert_own" on public.user_notification_reads;
create policy "user_notification_reads_insert_own"
on public.user_notification_reads
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "user_notification_reads_delete_own" on public.user_notification_reads;
create policy "user_notification_reads_delete_own"
on public.user_notification_reads
for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, delete on table public.user_notification_reads to authenticated;
grant all on table public.user_notification_reads to service_role;
