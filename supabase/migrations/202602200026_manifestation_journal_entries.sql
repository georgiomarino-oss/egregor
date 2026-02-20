-- Personal manifestation journal entries (cloud-synced per user).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.manifestation_journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  body text not null,
  visibility text not null default 'private'
    check (visibility in ('private', 'shared_anonymous')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manifestation_journal_entries_body_len
    check (char_length(trim(body)) between 1 and 600)
);

create index if not exists manifestation_journal_entries_user_created_idx
on public.manifestation_journal_entries (user_id, created_at desc);

alter table if exists public.manifestation_journal_entries enable row level security;

drop policy if exists "manifestation_journal_entries_select_own" on public.manifestation_journal_entries;
create policy "manifestation_journal_entries_select_own"
on public.manifestation_journal_entries
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "manifestation_journal_entries_insert_own" on public.manifestation_journal_entries;
create policy "manifestation_journal_entries_insert_own"
on public.manifestation_journal_entries
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "manifestation_journal_entries_update_own" on public.manifestation_journal_entries;
create policy "manifestation_journal_entries_update_own"
on public.manifestation_journal_entries
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "manifestation_journal_entries_delete_own" on public.manifestation_journal_entries;
create policy "manifestation_journal_entries_delete_own"
on public.manifestation_journal_entries
for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete on table public.manifestation_journal_entries to authenticated;
grant all on table public.manifestation_journal_entries to service_role;
