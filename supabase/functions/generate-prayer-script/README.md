# generate-prayer-script

Supabase Edge Function for AI-powered event scripts and solo guidance.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## Optional environment variables

- `OPENAI_API_KEY` (if missing, function returns deterministic fallback content)
- `OPENAI_MODEL` (default: `gpt-4.1-mini`)
- `AI_GENERATION_REQUIRE_AUTH` (default: `1`; set to `0` to disable auth requirement)

## Request

- Method: `POST`
- Body:

```json
{
  "mode": "event",
  "intention": "May people everywhere feel peace and resilience.",
  "durationMinutes": 20,
  "tone": "calm",
  "language": "English"
}
```

- `mode` can be `event` or `solo`.

## Response

```json
{
  "ok": true,
  "source": "openai",
  "payload": {}
}
```

- `source` is `openai` or `fallback`.
- If OpenAI fails or is not configured, `fallback` payload is returned with a `warning` field.
