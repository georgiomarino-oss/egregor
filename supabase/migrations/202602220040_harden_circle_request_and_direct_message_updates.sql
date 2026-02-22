-- 202602220040_harden_circle_request_and_direct_message_updates.sql
-- Tighten row updates for community chat foundation:
-- 1) Circle requests: requester can cancel pending, target can accept/decline pending.
-- 2) Direct messages: only recipient can set read_at (no body/participant mutation).

begin;

create or replace function public.enforce_circle_connection_request_transition()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if old.requester_user_id <> new.requester_user_id
    or old.target_user_id <> new.target_user_id
    or old.created_at <> new.created_at
  then
    raise exception 'Immutable columns cannot be changed';
  end if;

  if old.status <> 'pending' and new.status <> old.status then
    raise exception 'Only pending requests can change status';
  end if;

  if v_uid = old.requester_user_id then
    if old.status <> 'pending' or new.status not in ('pending', 'cancelled') then
      raise exception 'Requester can only cancel a pending request';
    end if;
    return new;
  end if;

  if v_uid = old.target_user_id then
    if old.status <> 'pending' or new.status not in ('accepted', 'declined') then
      raise exception 'Recipient can only accept or decline a pending request';
    end if;
    return new;
  end if;

  raise exception 'Only request participants can update this row';
end;
$$;

drop trigger if exists trg_circle_connection_requests_transition on public.circle_connection_requests;
create trigger trg_circle_connection_requests_transition
before update on public.circle_connection_requests
for each row
execute function public.enforce_circle_connection_request_transition();

create or replace function public.enforce_direct_message_read_update()
returns trigger
language plpgsql
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if v_uid <> old.recipient_user_id then
    raise exception 'Only the recipient can update this message';
  end if;

  if old.sender_user_id <> new.sender_user_id
    or old.recipient_user_id <> new.recipient_user_id
    or old.body <> new.body
    or old.created_at <> new.created_at
    or old.id <> new.id
  then
    raise exception 'Only read receipt updates are allowed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_direct_messages_read_only_update on public.direct_messages;
create trigger trg_direct_messages_read_only_update
before update on public.direct_messages
for each row
execute function public.enforce_direct_message_read_update();

commit;

