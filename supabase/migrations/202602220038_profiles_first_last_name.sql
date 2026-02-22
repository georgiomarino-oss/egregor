-- 202602220038_profiles_first_last_name.sql
-- Goal:
-- 1) Add first_name/last_name to profiles for personalized UI labels.
-- 2) Backfill from auth metadata / existing display names.
-- 3) Update handle_new_user trigger function to persist names for new signups.

begin;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

update public.profiles p
set
  first_name = coalesce(
    nullif(p.first_name, ''),
    nullif(u.raw_user_meta_data->>'first_name', ''),
    nullif(
      split_part(
        coalesce(
          nullif(u.raw_user_meta_data->>'display_name', ''),
          nullif(u.raw_user_meta_data->>'name', ''),
          nullif(p.display_name, ''),
          split_part(u.email, '@', 1)
        ),
        ' ',
        1
      ),
      ''
    ),
    'User'
  ),
  last_name = coalesce(
    nullif(p.last_name, ''),
    nullif(u.raw_user_meta_data->>'last_name', ''),
    nullif(
      trim(
        regexp_replace(
          coalesce(
            nullif(u.raw_user_meta_data->>'display_name', ''),
            nullif(u.raw_user_meta_data->>'name', ''),
            nullif(p.display_name, ''),
            ''
          ),
          '^\S+\s*',
          ''
        )
      ),
      ''
    )
  )
from auth.users u
where p.id = u.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  v_first_name text;
  v_last_name text;
  v_display_name text;
begin
  v_first_name := coalesce(
    nullif(new.raw_user_meta_data->>'first_name', ''),
    nullif(
      split_part(
        coalesce(
          nullif(new.raw_user_meta_data->>'display_name', ''),
          nullif(new.raw_user_meta_data->>'name', ''),
          split_part(new.email, '@', 1)
        ),
        ' ',
        1
      ),
      ''
    ),
    'User'
  );

  v_last_name := coalesce(
    nullif(new.raw_user_meta_data->>'last_name', ''),
    nullif(
      trim(
        regexp_replace(
          coalesce(
            nullif(new.raw_user_meta_data->>'display_name', ''),
            nullif(new.raw_user_meta_data->>'name', ''),
            ''
          ),
          '^\S+\s*',
          ''
        )
      ),
      ''
    )
  );

  v_display_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(trim(concat_ws(' ', v_first_name, v_last_name)), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'User'
  );

  insert into public.profiles (
    id,
    first_name,
    last_name,
    display_name,
    avatar_url,
    created_at,
    updated_at
  )
  values (
    new.id,
    v_first_name,
    v_last_name,
    v_display_name,
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    now(),
    now()
  )
  on conflict (id) do update
    set
      first_name = coalesce(nullif(public.profiles.first_name, ''), excluded.first_name),
      last_name = coalesce(nullif(public.profiles.last_name, ''), excluded.last_name),
      display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      updated_at = now();

  return new;
end;
$$;

commit;

