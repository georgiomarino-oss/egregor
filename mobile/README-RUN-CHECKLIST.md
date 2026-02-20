# Egregor Mobile - Run Checklist

This is the canonical run-and-verify checklist for the Expo mobile app.

## 0) Prerequisites
- Node.js 20+
- npm 10+ (or pnpm)
- Expo Go (or Android/iOS emulator)
- Supabase project with API URL + anon key
- Supabase migrations applied

## 1) Environment variables
Create `mobile/.env` (or export in shell):

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

## 2) Install dependencies
From repo root:

```bash
cd mobile
npm install
```

## 3) Typecheck before run

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

## 4) Ensure DB migrations are current
From repo root:

```bash
supabase db push
supabase migration list
```

Expected: local and remote migration versions match.

## 5) Start Expo
From `mobile/`:

```bash
npm run start
```

Then open on:
- Android emulator (`a`)
- iOS simulator (`i` on macOS)
- Expo Go via QR scan

## 6) Sign-in smoke test
- Open app and sign up/sign in.
- Confirm app transitions from Auth -> tabbed app.
- Confirm sign out returns to Auth.

## 7) Core feature QA
Run:
- `mobile/QA_EVENTROOM_CHAT_PRESENCE_CHECKLIST.md`

Minimum pass criteria:
- Presence join/leave works across 2 devices.
- Presence realtime updates are incremental and stable.
- Heartbeat only updates in foreground.
- Chat remains deduped + sorted on reconnect.
- New-message badge appears only when scrolled up.

## 8) Script + Event management smoke
- Create script in Scripts tab.
- Confirm generated section durations match chosen duration.
- Attach/replace script on hosted event.
- Open EventRoom from Events and verify `eventId` navigation works.

## 9) Profile management smoke
- Update display name/avatar URL in Profile.
- Save and refresh.
- Confirm values persist.

## 10) Pre-release sanity
- `git status` is clean.
- `dev` is pushed.
- Migrations are applied in target environment.
- QA checklist has a pass log entry (date/build/device/tester).
