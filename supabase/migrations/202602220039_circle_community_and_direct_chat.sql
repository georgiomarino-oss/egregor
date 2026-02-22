-- 202602220039_circle_community_and_direct_chat.sql
-- Foundation for:
-- 1) Egregor Circle memberships
-- 2) Request-to-chat flow
-- 3) Direct member messaging
-- 4) Post-event outcome reporting for community analytics

begin;

create extension if not exists pgcrypto;

create table if not exists public.circle_connection_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint circle_connection_requests_not_self check (requester_user_id <> target_user_id),
  constraint circle_connection_requests_unique_direction unique (requester_user_id, target_user_id)
);

create index if not exists idx_circle_connection_requests_target_status_created
  on public.circle_connection_requests (target_user_id, status, created_at desc);

create index if not exists idx_circle_connection_requests_requester_status_created
  on public.circle_connection_requests (requester_user_id, status, created_at desc);

create table if not exists public.circle_memberships (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'accepted_request' check (source in ('accepted_request', 'manual')),
  created_at timestamptz not null default now(),
  constraint circle_memberships_not_self check (owner_user_id <> member_user_id),
  constraint circle_memberships_unique_owner_member unique (owner_user_id, member_user_id)
);

create index if not exists idx_circle_memberships_owner_created
  on public.circle_memberships (owner_user_id, created_at desc);

create index if not exists idx_circle_memberships_member_created
  on public.circle_memberships (member_user_id, created_at desc);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint direct_messages_not_self check (sender_user_id <> recipient_user_id)
);

create index if not exists idx_direct_messages_sender_recipient_created
  on public.direct_messages (sender_user_id, recipient_user_id, created_at desc);

create index if not exists idx_direct_messages_recipient_unread
  on public.direct_messages (recipient_user_id, read_at, created_at desc);

create table if not exists public.event_outcome_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome_type text not null check (outcome_type in ('positive', 'neutral', 'negative')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_outcome_reports_unique_event_user unique (event_id, user_id)
);

create index if not exists idx_event_outcome_reports_event_created
  on public.event_outcome_reports (event_id, created_at desc);

create index if not exists idx_event_outcome_reports_user_created
  on public.event_outcome_reports (user_id, created_at desc);

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_circle_connection_requests_updated_at on public.circle_connection_requests;
create trigger trg_circle_connection_requests_updated_at
before update on public.circle_connection_requests
for each row
execute function public.set_row_updated_at();

drop trigger if exists trg_event_outcome_reports_updated_at on public.event_outcome_reports;
create trigger trg_event_outcome_reports_updated_at
before update on public.event_outcome_reports
for each row
execute function public.set_row_updated_at();

create or replace function public.respond_circle_connection_request(
  p_request_id uuid,
  p_accept boolean
)
returns table(ok boolean, status text, peer_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.circle_connection_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into v_req
  from public.circle_connection_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Connection request not found';
  end if;

  if v_req.target_user_id <> v_uid then
    raise exception 'Only the request recipient can respond';
  end if;

  if v_req.status <> 'pending' then
    return query
    select false, v_req.status, v_req.requester_user_id;
    return;
  end if;

  if p_accept then
    update public.circle_connection_requests
    set status = 'accepted',
        updated_at = now()
    where id = v_req.id;

    insert into public.circle_memberships (owner_user_id, member_user_id, source)
    values (v_req.requester_user_id, v_req.target_user_id, 'accepted_request')
    on conflict (owner_user_id, member_user_id) do nothing;

    insert into public.circle_memberships (owner_user_id, member_user_id, source)
    values (v_req.target_user_id, v_req.requester_user_id, 'accepted_request')
    on conflict (owner_user_id, member_user_id) do nothing;

    return query
    select true, 'accepted'::text, v_req.requester_user_id;
    return;
  end if;

  update public.circle_connection_requests
  set status = 'declined',
      updated_at = now()
  where id = v_req.id;

  return query
  select true, 'declined'::text, v_req.requester_user_id;
end;
$$;

comment on function public.respond_circle_connection_request(uuid, boolean) is
  'Accept/decline a pending circle chat request. On accept, creates mutual circle memberships.';

revoke all on function public.respond_circle_connection_request(uuid, boolean) from public;
grant execute on function public.respond_circle_connection_request(uuid, boolean) to authenticated;
grant execute on function public.respond_circle_connection_request(uuid, boolean) to service_role;

alter table public.circle_connection_requests enable row level security;
alter table public.circle_memberships enable row level security;
alter table public.direct_messages enable row level security;
alter table public.event_outcome_reports enable row level security;

drop policy if exists circle_connection_requests_select_participants on public.circle_connection_requests;
create policy circle_connection_requests_select_participants
on public.circle_connection_requests
for select
to authenticated
using (
  auth.uid() = requester_user_id
  or auth.uid() = target_user_id
);

drop policy if exists circle_connection_requests_insert_requester on public.circle_connection_requests;
create policy circle_connection_requests_insert_requester
on public.circle_connection_requests
for insert
to authenticated
with check (
  auth.uid() = requester_user_id
  and requester_user_id <> target_user_id
);

drop policy if exists circle_connection_requests_update_participants on public.circle_connection_requests;
create policy circle_connection_requests_update_participants
on public.circle_connection_requests
for update
to authenticated
using (
  auth.uid() = requester_user_id
  or auth.uid() = target_user_id
)
with check (
  auth.uid() = requester_user_id
  or auth.uid() = target_user_id
);

drop policy if exists circle_memberships_select_participants on public.circle_memberships;
create policy circle_memberships_select_participants
on public.circle_memberships
for select
to authenticated
using (
  auth.uid() = owner_user_id
  or auth.uid() = member_user_id
);

drop policy if exists circle_memberships_insert_owner on public.circle_memberships;
create policy circle_memberships_insert_owner
on public.circle_memberships
for insert
to authenticated
with check (
  auth.uid() = owner_user_id
  and owner_user_id <> member_user_id
);

drop policy if exists circle_memberships_delete_owner on public.circle_memberships;
create policy circle_memberships_delete_owner
on public.circle_memberships
for delete
to authenticated
using (auth.uid() = owner_user_id);

drop policy if exists direct_messages_select_participants on public.direct_messages;
create policy direct_messages_select_participants
on public.direct_messages
for select
to authenticated
using (
  auth.uid() = sender_user_id
  or auth.uid() = recipient_user_id
);

drop policy if exists direct_messages_insert_sender_member on public.direct_messages;
create policy direct_messages_insert_sender_member
on public.direct_messages
for insert
to authenticated
with check (
  auth.uid() = sender_user_id
  and exists (
    select 1
    from public.circle_memberships cm
    where cm.owner_user_id = auth.uid()
      and cm.member_user_id = recipient_user_id
  )
);

drop policy if exists direct_messages_update_recipient_read on public.direct_messages;
create policy direct_messages_update_recipient_read
on public.direct_messages
for update
to authenticated
using (auth.uid() = recipient_user_id)
with check (auth.uid() = recipient_user_id);

drop policy if exists event_outcome_reports_select_authenticated on public.event_outcome_reports;
create policy event_outcome_reports_select_authenticated
on public.event_outcome_reports
for select
to authenticated
using (true);

drop policy if exists event_outcome_reports_insert_owner on public.event_outcome_reports;
create policy event_outcome_reports_insert_owner
on public.event_outcome_reports
for insert
to authenticated
with check (
  auth.uid() = user_id
  and (
    exists (
      select 1
      from public.events e
      where e.id = event_id
        and e.host_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.event_participants ep
      where ep.event_id = event_id
        and ep.user_id = auth.uid()
    )
  )
);

drop policy if exists event_outcome_reports_update_owner on public.event_outcome_reports;
create policy event_outcome_reports_update_owner
on public.event_outcome_reports
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;

