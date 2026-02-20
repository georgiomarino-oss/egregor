# revenuecat-webhook

Supabase Edge Function to sync RevenueCat webhook events into
`public.user_subscription_state`.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Optional environment variables

- `REVENUECAT_WEBHOOK_AUTH_TOKEN`
  - If set, request must include either:
    - `Authorization: Bearer <token>`
    - or `x-egregor-webhook-token: <token>`
- `RC_DEFAULT_ENTITLEMENT_ID` (default: `egregor_circle`)

## Request

- Method: `POST`
- Payload:
  - RevenueCat webhook body (supports both `{ "event": { ... } }` and raw event object)

## Behavior

- Finds user id from `event.app_user_id` or first UUID in `event.aliases`.
- Upserts entitlement rows into `public.user_subscription_state`.
- Sets active state by event type and expiration time.
- Stores raw event payload in `metadata`.

## Suggested RevenueCat configuration

- Webhook URL:
  - `https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook`
- Authorization header:
  - `Bearer <REVENUECAT_WEBHOOK_AUTH_TOKEN>`
