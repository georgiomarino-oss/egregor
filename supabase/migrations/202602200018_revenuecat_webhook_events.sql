-- RevenueCat webhook idempotency + replay/audit log.

create table if not exists public.revenuecat_webhook_events (
  event_id text primary key,
  user_id uuid null,
  event_type text not null,
  app_user_id text null,
  entitlement_ids text[] not null default '{}'::text[],
  product_id text null,
  store text null,
  environment text null,
  event_timestamp timestamptz null,
  process_status text not null default 'received'
    check (process_status in ('received', 'processed', 'ignored', 'failed')),
  error_message text null,
  raw_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists revenuecat_webhook_events_user_received_idx
on public.revenuecat_webhook_events (user_id, received_at desc);

create index if not exists revenuecat_webhook_events_status_received_idx
on public.revenuecat_webhook_events (process_status, received_at desc);

alter table if exists public.revenuecat_webhook_events enable row level security;

drop policy if exists "revenuecat_webhook_events_select_own" on public.revenuecat_webhook_events;
create policy "revenuecat_webhook_events_select_own"
on public.revenuecat_webhook_events
for select
to authenticated
using (user_id = auth.uid());

grant select on table public.revenuecat_webhook_events to authenticated;
grant all on table public.revenuecat_webhook_events to service_role;
