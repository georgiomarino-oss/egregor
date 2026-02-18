# Egregor — Final Mobile App Build (Clean Reset)

## Vision
Egregor is a mobile app that brings people together for collective prayer/manifestation to create positive change through focused intention.

Core features:
1. User authentication
2. Create and join intention events
3. Live participant count ("active now")
4. Presence heartbeat + leave flow
5. Heat-map style activity by location grid
6. AI-guided scripts (calm/uplifting/focused)
7. Attach scripts to events
8. Theme-based events and intentions

---

## Final Tech Stack

- **Mobile:** Expo + React Native + TypeScript
- **Backend:** Supabase (Auth + Postgres + Realtime + Storage optional)
- **Server logic:** Supabase Edge Functions
- **AI scripts:** OpenAI from Edge Function (secure key on server)
- **Maps/heat display:** grid-cell aggregation from opt-in location

---

## Folder Structure (target)

egregor/
  mobile/
    App.tsx
    app.json
    babel.config.js
    package.json
    tsconfig.json
    .env
    src/
      lib/
        supabase.ts
      config/
        index.ts
      types/
        db.ts
      state/
        appState.tsx
      screens/
        AuthScreen.tsx
        EventsScreen.tsx
        EventRoomScreen.tsx
        ScriptsScreen.tsx
        ProfileScreen.tsx
      components/
        EventCard.tsx
        SectionCard.tsx
        PrimaryButton.tsx
      services/
        authService.ts
        eventsService.ts
        scriptsService.ts
        presenceService.ts
        heatmapService.ts
      utils/
        date.ts
        validation.ts
  supabase/
    migrations/
      001_init.sql
      002_rls.sql
      003_functions.sql
    functions/
      generate-script/
        index.ts

---

## Build Strategy

We will add files one-by-one in this order:

1. `mobile/package.json`
2. `mobile/app.json`
3. `mobile/babel.config.js`
4. `mobile/tsconfig.json`
5. `mobile/.env.example`
6. `mobile/src/lib/supabase.ts`
7. `mobile/src/types/db.ts`
8. `mobile/App.tsx`
9. Auth screen + service
10. Events screen + services
11. Scripts screen + edge function integration
12. Supabase SQL migrations
13. Presence + heat map aggregation
14. Final polish and test checklist

---

## Non-negotiables for stability

- No local custom API server required for core app flow
- No OpenAI key in mobile app
- Supabase keys only:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- All privileged logic in Supabase Edge Functions
- RLS enforced on all tables

---

## Success Criteria

After final step, user can:
- Sign up/sign in
- Create event
- Join event
- See active participant count update live
- Generate AI script
- Attach script to event
- Follow guided script with group
- View activity heat signal
