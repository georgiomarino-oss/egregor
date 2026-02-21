# dispatch-notification-log-push

Supabase Edge Function that sends Expo push notifications for queued rows in
`public.notification_log`.

Current push kinds:
- `live_soon`
- `live_now`
- `journal_shared`
- `news_alert`
- `streak_reminder`

It marks delivered rows with `notification_log.push_sent_at` so retries are
idempotent and avoids replaying the same notification every cron run.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (for scheduler auth fallback)
- `NOTIFICATION_PUSH_CRON_TOKEN` (optional, recommended)

## Request body

```json
{
  "lookbackMinutes": 180,
  "maxRows": 300,
  "dryRun": false
}
```

## Cron scheduling

Scheduled from SQL migration:
- `public.trigger_dispatch_notification_log_push_job()`
- job name: `dispatch_notification_log_push_every_minute`
