# Monetization Rollout Checklist

Scope: RevenueCat + Supabase subscription sync + AI quota unlocks  
Date: 2026-02-20  
Branch: `dev`  
Baseline commit: `1201fe0`

## Setup
- Confirm Apple App Store Connect and Google Play Console accounts are active.
- Ensure app entries exist on both stores and in-app subscription products are created.
- Confirm RevenueCat project is connected to both stores.

## Product Setup (Store + RevenueCat)
1. Create subscription products in App Store Connect.
2. Create matching subscription products in Google Play Console.
3. In RevenueCat, import products from both stores (this is the common blocker).
4. Attach imported products to an Offering (for example: `default`) and set packages (`MONTHLY`, `ANNUAL`).
5. Confirm entitlement id matches app/server expectation: `egregor_circle`.

## Keys and Environment
- Mobile env:
  - `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
  - `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
  - `EXPO_PUBLIC_RC_ENTITLEMENT_CIRCLE=egregor_circle`
- Supabase function secrets:
  - `REVENUECAT_WEBHOOK_AUTH_TOKEN`
  - `RC_DEFAULT_ENTITLEMENT_ID=egregor_circle`
  - Optional replay guard tuning:
    - `RC_REPLAY_MAX_AGE_HOURS`
    - `RC_REPLAY_MAX_FUTURE_MINUTES`

## Webhook Configuration
1. In RevenueCat dashboard, set webhook URL:
   - `https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook`
2. Add auth header:
   - `Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH_TOKEN>`
3. Send test event from RevenueCat.
4. Verify event appears in `Billing Debug -> Webhook Event Log`.

## In-App QA Flow
1. Open `Profile -> Egregor Circle`.
2. Tap `Refresh status`.
3. Tap `Open billing debug`.
4. Confirm:
   - `Packages loaded > 0`
   - Server/local membership values are consistent
   - `user_subscription_state` rows appear
   - `Client Monetization Events` section shows `circle_purchase` and `circle_restore` events
5. Execute purchase on device (sandbox/test account).
6. Confirm:
   - Purchase succeeds
   - Membership becomes active
   - Webhook event status is `processed`
   - A client event row appears with `event_name=circle_purchase` and `stage=success`
7. Test `Restore purchases`.
8. Confirm restore event appears:
   - `event_name=circle_restore` with stage `success` or `failure` (with error details).

## AI Quota + Premium Unlock QA
1. As free user, consume daily limit in:
   - Event script generation
   - Solo guidance generation
2. Purchase Circle.
3. Confirm quota gates are removed for premium member.
4. Confirm `is_circle_member` RPC returns `true`.

## Failure Cases
- Duplicate webhook delivery:
  - Expected: acknowledged with `duplicate: true`, no double-processing.
- Replay/old timestamp webhook:
  - Expected: marked `ignored` with reason in webhook log.
- Missing product import:
  - Expected: Profile shows "No subscription packages are available yet."

## Sign-off
- Apple purchase flow: PASS / FAIL
- Google purchase flow: PASS / FAIL
- Webhook sync reliability: PASS / FAIL
- Restore flow: PASS / FAIL
- Premium gating (AI quota): PASS / FAIL
- Production readiness: YES / NO
