# EventRoom Chat + Presence QA Checklist

Scope: `mobile/src/screens/EventRoomScreen.tsx`
Date: 2026-02-20
Branch: `dev`
Build/Commit: `b91c599`

## Setup
- Two signed-in test users (A and B) on separate devices/emulators.
- One PUBLIC event with attached script.
- EventRoom opens via normal app navigation path (Events -> EventRoom).

## Preflight (Completed)
- TypeScript check: `cd mobile && npx tsc --noEmit`.
- Result: PASS.

## Manual QA Matrix

### 1) Core Presence
- User A opens EventRoom and taps Join live.
- User B opens same EventRoom and taps Join live.
- Expected:
  - Both users appear in attendees list.
  - Active count increments for each joined user.
  - Leaving live removes that user from attendees list.
- Status: NOT RUN
- Notes:

### 2) Presence Realtime Incremental Updates
- Keep both users in room.
- Have user B leave live; do not manually refresh on user A.
- Expected: user A sees B removed without full-screen reload.
- Have user B re-join.
- Expected: user A sees B return without manual refresh.
- Status: NOT RUN
- Notes:

### 3) Presence Periodic Resync (60s)
- Keep user A in room for > 60s without interaction.
- Expected:
  - No regressions in attendees list.
  - Data remains consistent if a realtime event was missed.
- Status: NOT RUN
- Notes:

### 4) Heartbeat Foreground/Background
- User A joined live.
- Put app in background for ~20-30s.
- Return to foreground.
- Expected:
  - No repeated heartbeat errors.
  - User A remains joined unless explicitly left.
  - `last_seen_at` resumes updating after return to foreground.
- Status: NOT RUN
- Notes:

### 5) Auto-join Preferences
- Enable Auto-join live.
- Join live, leave screen, reopen same EventRoom.
- Expected: auto-join occurs for that event.
- Disable Auto-join live and reopen.
- Expected: no automatic join.
- Status: NOT RUN
- Notes:

### 6) Chat Ordering + De-dupe
- With A and B in room, send alternating messages quickly.
- Temporarily disconnect/reconnect network on one device.
- Send additional messages during/after reconnect.
- Expected:
  - No duplicate messages by id.
  - Messages remain sorted by `created_at`.
  - Reconnected inserts land in correct order.
  - Messages over 1000 chars are rejected with validation feedback.
- Status: NOT RUN
- Notes:

### 7) Chat Autoscroll Behavior
- While near bottom, receive new messages.
- Expected: list auto-scrolls to latest.
- Scroll up (not near bottom), receive new messages.
- Expected: list does not force-scroll to bottom.
- While scrolled up, send your own message.
- Expected: chat jumps to latest so your sent message is visible.
- Status: NOT RUN
- Notes:

### 8) Navigation Safety
- Enter EventRoom from Events screen.
- Use Back behavior from EventRoom.
- Expected: no crash; route params still use `eventId`.
- Delete a hosted event from Events tab.
- Expected: confirmation prompt appears and host-only delete succeeds.
- Edit a hosted event from Events tab.
- Expected: host-only edit succeeds and updated fields render in EventRoom.
- Status: NOT RUN
- Notes:

## Summary
- Overall result: IN PROGRESS
- Blocking issues:
- Follow-up fixes:
