# delete-account

Supabase Edge Function that lets an authenticated user permanently delete their
account and linked app data.

## Behavior

1. Validates the caller from the bearer token.
2. Deletes user-scoped rows from app tables.
3. Deletes hosted events and dependent event rows.
4. Detaches authored scripts from events and deletes authored scripts.
5. Deletes the auth user from `auth.users`.

## Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Request

- Method: `POST`
- Auth: `Authorization: Bearer <access_token>`
- Body: none required

## Response

```json
{
  "ok": true,
  "userId": "uuid",
  "deletedAt": "2026-02-21T13:57:00.000Z",
  "cleanupSteps": ["events.id", "profiles.id"]
}
```
