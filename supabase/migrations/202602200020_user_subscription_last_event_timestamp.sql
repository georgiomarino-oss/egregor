-- Prevent stale/out-of-order webhook events from overwriting newer subscription state.

alter table if exists public.user_subscription_state
add column if not exists last_event_timestamp timestamptz null;

create index if not exists user_subscription_state_last_event_ts_idx
on public.user_subscription_state (user_id, entitlement_id, last_event_timestamp desc);
