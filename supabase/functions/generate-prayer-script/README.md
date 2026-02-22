# generate-prayer-script

Supabase Edge Function for AI-powered event scripts, solo guidance, and solo voice audio.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## Optional environment variables

- `OPENAI_API_KEY` (if missing, function returns deterministic fallback content)
- `OPENAI_MODEL` (default: `gpt-4.1-mini`)
- `OPENAI_TTS_MODEL` (default: `gpt-4o-mini-tts`)
- `OPENAI_TTS_VOICE` (default: `alloy`)
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

- `mode` can be `event`, `solo`, or `solo_voice`.
- `solo_voice` expects `title` and `lines` and returns base64 audio:

```json
{
  "mode": "solo_voice",
  "title": "Prayer for Family",
  "intention": "peace, unity, and healing for my family",
  "tone": "calm",
  "language": "en-US",
  "lines": ["Breathe in slowly...", "Release tension..."]
}
```

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
