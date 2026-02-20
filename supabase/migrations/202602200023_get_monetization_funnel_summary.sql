-- Consolidated funnel counters for BillingDebugScreen.
-- Replaces many per-counter queries with one RPC.

create or replace function public.get_monetization_funnel_summary(
  p_user_id uuid default auth.uid()
)
returns table (
  paywall_views bigint,
  paywall_cta_taps bigint,
  purchase_attempts bigint,
  purchase_success bigint,
  purchase_failure bigint,
  purchase_cancelled bigint,
  restore_attempts bigint,
  restore_success bigint,
  restore_failure bigint,
  refresh_attempts bigint,
  refresh_success bigint,
  debug_open_count bigint,
  ai_event_script_attempts bigint,
  ai_event_script_success bigint,
  ai_event_script_premium_success bigint,
  ai_solo_guidance_attempts bigint,
  ai_solo_guidance_success bigint,
  ai_solo_guidance_premium_success bigint,
  membership_sync_success bigint,
  membership_sync_failure bigint
)
language sql
security invoker
set search_path = public
as $$
  with user_events as (
    select event_name, stage, metadata
    from public.monetization_event_log
    where user_id = coalesce(p_user_id, auth.uid())
  )
  select
    count(*) filter (where event_name = 'circle_paywall_view') as paywall_views,
    count(*) filter (where event_name = 'circle_paywall_cta_tap') as paywall_cta_taps,
    count(*) filter (where event_name = 'circle_purchase' and stage = 'attempt') as purchase_attempts,
    count(*) filter (where event_name = 'circle_purchase' and stage = 'success') as purchase_success,
    count(*) filter (where event_name = 'circle_purchase' and stage = 'failure') as purchase_failure,
    count(*) filter (where event_name = 'circle_purchase' and stage = 'cancelled') as purchase_cancelled,
    count(*) filter (where event_name = 'circle_restore' and stage = 'attempt') as restore_attempts,
    count(*) filter (where event_name = 'circle_restore' and stage = 'success') as restore_success,
    count(*) filter (where event_name = 'circle_restore' and stage = 'failure') as restore_failure,
    count(*) filter (where event_name = 'billing_status_refresh' and stage = 'attempt') as refresh_attempts,
    count(*) filter (where event_name = 'billing_status_refresh' and stage = 'success') as refresh_success,
    count(*) filter (where event_name = 'billing_debug_open') as debug_open_count,
    count(*) filter (
      where event_name = 'premium_feature_use'
      and stage = 'attempt'
      and metadata @> '{"feature":"ai_event_script_generate"}'::jsonb
    ) as ai_event_script_attempts,
    count(*) filter (
      where event_name = 'premium_feature_use'
      and stage = 'success'
      and metadata @> '{"feature":"ai_event_script_generate"}'::jsonb
    ) as ai_event_script_success,
    count(*) filter (
      where event_name = 'premium_feature_use'
      and stage = 'success'
      and metadata @> '{"feature":"ai_event_script_generate","isPremium":true}'::jsonb
    ) as ai_event_script_premium_success,
    count(*) filter (
      where event_name = 'premium_feature_use'
      and stage = 'attempt'
      and metadata @> '{"feature":"ai_solo_guidance_generate"}'::jsonb
    ) as ai_solo_guidance_attempts,
    count(*) filter (
      where event_name = 'premium_feature_use'
      and stage = 'success'
      and metadata @> '{"feature":"ai_solo_guidance_generate"}'::jsonb
    ) as ai_solo_guidance_success,
    count(*) filter (
      where event_name = 'premium_feature_use'
      and stage = 'success'
      and metadata @> '{"feature":"ai_solo_guidance_generate","isPremium":true}'::jsonb
    ) as ai_solo_guidance_premium_success,
    count(*) filter (where event_name = 'circle_membership_sync' and stage = 'success') as membership_sync_success,
    count(*) filter (where event_name = 'circle_membership_sync' and stage = 'failure') as membership_sync_failure
  from user_events;
$$;

comment on function public.get_monetization_funnel_summary(uuid) is
'Returns all-time monetization funnel counters for a user from monetization_event_log.';

revoke all on function public.get_monetization_funnel_summary(uuid) from public;
grant execute on function public.get_monetization_funnel_summary(uuid) to authenticated;
grant execute on function public.get_monetization_funnel_summary(uuid) to service_role;
