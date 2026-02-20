-- Allow authenticated users to manage their own Expo push tokens safely.

alter table if exists public.user_push_tokens enable row level security;

drop policy if exists "user_push_tokens_select_own" on public.user_push_tokens;
create policy "user_push_tokens_select_own"
on public.user_push_tokens
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "user_push_tokens_insert_own" on public.user_push_tokens;
create policy "user_push_tokens_insert_own"
on public.user_push_tokens
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "user_push_tokens_update_own" on public.user_push_tokens;
create policy "user_push_tokens_update_own"
on public.user_push_tokens
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "user_push_tokens_delete_own" on public.user_push_tokens;
create policy "user_push_tokens_delete_own"
on public.user_push_tokens
for delete
to authenticated
using (user_id = auth.uid());

delete from public.user_push_tokens a
using public.user_push_tokens b
where a.ctid < b.ctid
  and a.user_id = b.user_id
  and a.expo_push_token = b.expo_push_token;

create unique index if not exists user_push_tokens_user_id_expo_push_token_key
on public.user_push_tokens (user_id, expo_push_token);

create index if not exists user_push_tokens_user_id_idx
on public.user_push_tokens (user_id);
