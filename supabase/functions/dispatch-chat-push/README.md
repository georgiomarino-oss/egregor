# dispatch-chat-push

Supabase Edge Function that sends Expo push notifications for recent chat activity in event rooms.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Optional environment variables

- `CHAT_PUSH_CRON_TOKEN` (recommended; request can include header `x-egregor-cron-token`)

## Auth behavior

- If `CHAT_PUSH_CRON_TOKEN` is set, requests are accepted when either:
  - `x-egregor-cron-token` matches, or
  - both `Authorization: Bearer <SUPABASE_ANON_KEY>` and `apikey: <SUPABASE_ANON_KEY>` match.

## Request

- Method: `POST`
- Body (all optional):

```json
{
  "lookbackMinutes": 20,
  "maxMessages": 100,
  "activeWindowMs": 90000,
  "dryRun": false
}
```

## Behavior

- Reads recent rows from `public.event_messages`.
- Targets users who are recently active in the same event (`event_presence.last_seen_at` within `activeWindowMs`), excluding the sender.
- Uses `public.user_push_tokens` for Expo tokens.
- Dedupes by `notification_log` with key `chat:<message_id>:<recipient_user_id>`.
- Deletes invalid Expo tokens (`DeviceNotRegistered`) from `user_push_tokens`.

## Quick dry-run

```bash
curl -X POST \
  "$SUPABASE_FUNCTIONS_URL/dispatch-chat-push" \
  -H "Content-Type: application/json" \
  -H "x-egregor-cron-token: $CHAT_PUSH_CRON_TOKEN" \
  -d '{"dryRun": true, "lookbackMinutes": 30}'
```
