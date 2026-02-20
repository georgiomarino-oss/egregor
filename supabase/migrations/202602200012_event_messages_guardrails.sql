-- Chat guardrails on event_messages:
-- 1) reject blank/oversized message bodies at the DB layer
-- 2) apply a lightweight per-user burst rate limit

begin;

alter table public.event_messages
  drop constraint if exists event_messages_body_not_blank_chk;

alter table public.event_messages
  add constraint event_messages_body_not_blank_chk
  check (char_length(btrim(coalesce(body, ''))) > 0) not valid;

alter table public.event_messages
  drop constraint if exists event_messages_body_max_len_chk;

alter table public.event_messages
  add constraint event_messages_body_max_len_chk
  check (char_length(body) <= 1000) not valid;

create or replace function public.enforce_event_message_guardrails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_count integer := 0;
  v_body text := btrim(coalesce(new.body, ''));
begin
  if char_length(v_body) = 0 then
    raise exception 'Message cannot be empty.';
  end if;

  if char_length(v_body) > 1000 then
    raise exception 'Message exceeds 1000 characters.';
  end if;

  -- Keep burst spam low while preserving a smooth chat flow.
  select count(*)
  into v_recent_count
  from public.event_messages m
  where m.event_id = new.event_id
    and m.user_id = new.user_id
    and m.created_at >= now() - interval '10 seconds';

  if v_recent_count >= 8 then
    raise exception 'Too many messages. Please wait a few seconds.';
  end if;

  -- Normalize obvious accidental whitespace-only edges.
  new.body := v_body;
  return new;
end;
$$;

drop trigger if exists trg_event_messages_guardrails on public.event_messages;

create trigger trg_event_messages_guardrails
before insert on public.event_messages
for each row
execute function public.enforce_event_message_guardrails();

commit;
