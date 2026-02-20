# news-auto-events

Supabase Edge Function scaffold to auto-create compassion events from world news.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Optional environment variables

- `NEWS_API_KEY` (if omitted, function falls back to Google News RSS)
- `NEWS_AUTOGEN_HOST_USER_ID` (if omitted, function picks recent event host or first profile id)
- `NEWS_AUTOGEN_CRON_TOKEN` (recommended; request must include header `x-egregor-cron-token`)
- `NEWS_DEFAULT_TIMEZONE` (default: `UTC`)
- `NEWS_API_BASE_URL` (default: `https://newsapi.org`)

## Scheduler notes

- Migration `202602200014_schedule_news_auto_events_job.sql` schedules this function every 15 minutes.
- It sends `Authorization` + `apikey` headers from `app.settings.anon_key`.
- If you set `NEWS_AUTOGEN_CRON_TOKEN`, also set the matching DB setting so pg_cron includes it:

```sql
alter database postgres set app.settings.news_autogen_cron_token = 'replace-with-same-token';
```

- Runtime auth behavior:
  - If `NEWS_AUTOGEN_CRON_TOKEN` is set, requests are accepted when either:
    - `x-egregor-cron-token` matches, or
    - both `Authorization: Bearer <SUPABASE_ANON_KEY>` and `apikey: <SUPABASE_ANON_KEY>` match.

## Request

- Method: `POST`
- Body (all optional):

```json
{
  "query": "(earthquake OR flood OR wildfire OR hurricane OR cyclone OR tsunami OR conflict OR war OR crisis)",
  "language": "en",
  "pageSize": 20,
  "fromHours": 24,
  "region": "GLOBAL",
  "timezone": "UTC",
  "startOffsetMinutes": 5,
  "durationMinutes": 30,
  "dryRun": false
}
```

## Dedupe behavior

- Each article is converted into a stable `source_fingerprint` (`news:<sha256>`).
- The function checks existing fingerprints in `public.events`.
- Inserts use `upsert(..., { onConflict: "source_fingerprint", ignoreDuplicates: true })`.

## Event metadata written

- `source = 'news'`
- `source_region` (from request `region` or `GLOBAL`)
- `source_fingerprint`

## Quick test

```bash
curl -X POST \
  "$SUPABASE_FUNCTIONS_URL/news-auto-events" \
  -H "Content-Type: application/json" \
  -H "x-egregor-cron-token: $NEWS_AUTOGEN_CRON_TOKEN" \
  -d '{"dryRun": true, "region": "GLOBAL"}'
```
