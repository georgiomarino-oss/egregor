# news-auto-events

Supabase Edge Function scaffold to auto-create compassion events from world news.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEWS_API_KEY`
- `NEWS_AUTOGEN_HOST_USER_ID`

## Optional environment variables

- `NEWS_AUTOGEN_CRON_TOKEN` (recommended; request must include header `x-egregor-cron-token`)
- `NEWS_DEFAULT_TIMEZONE` (default: `UTC`)
- `NEWS_API_BASE_URL` (default: `https://newsapi.org`)

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
