-- 202602190010_profiles_readable_and_autocreate.sql
-- Goal:
-- 1) Allow authenticated users to SELECT profiles (so presence can show names)
-- 2) Ensure profiles are auto-created for new users (with a sensible default display_name)
-- 3) Backfill missing profiles for existing users

begin;

-- Ensure RLS is on (safe if already enabled)
alter table public.profiles enable row level security;

-- Drop policies if they already exist (idempotent)
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

-- 1) Everyone signed in can read basic profile fields
create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

-- 2) Users can insert their own profile row (if needed)
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

-- 3) Users can update their own profile row
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Create a helper function that creates a profile on new auth user
-- This is the standard Supabase pattern.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, created_at, updated_at)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      nullif(split_part(new.email, '@', 1), ''),
      'User'
    ),
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    now(),
    now()
  )
  on conflict (id) do update
    set updated_at = now();
  return new;
end;
$$;

-- Trigger on auth.users to auto-create profile.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill profiles for any existing auth users missing a profile row
insert into public.profiles (id, display_name, avatar_url, created_at, updated_at)
select
  u.id,
  coalesce(
    nullif(u.raw_user_meta_data->>'display_name', ''),
    nullif(u.raw_user_meta_data->>'name', ''),
    nullif(split_part(u.email, '@', 1), ''),
    'User'
  ) as display_name,
  nullif(u.raw_user_meta_data->>'avatar_url', '') as avatar_url,
  now(),
  now()
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

commit;
