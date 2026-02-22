# Egregor Mobile UX/Product Delivery Plan

## Phase 1: App Shell + Content Foundation (In Progress)
- Navigation IA: `Home`, `Group`, `Solo`, `Account`.
- Bottom nav tap safety on Android (safe-area aware tab bar).
- Solo prayer library structure:
  - catalog model (`soloCatalog`) for curated presets by category
  - dedicated `Solo` screen using the catalog
  - one-tap handoff into guided solo mode
- Post-session habit loop:
  - journal prompt after solo completion.
- Home declutter:
  - shorter event list and collapsed feed by default.

## Phase 2: Visual Identity and UI Quality
- Introduce full Egregor design language:
  - icon set, illustration set, typography hierarchy, spacing/radius tokens
  - motion system for transitions and breathing states.
- Rebuild top screens with fewer blocks per viewport:
  - home (focus-first), events (clear CTA hierarchy), account (clean settings structure).
- Add content cards with richer visual storytelling and category-led discovery.

## Phase 3: Heatmap V2 (Interactive Global Pulse)
- Replace numeric heat list with interactive world map.
- Region pulses:
  - animated circles that grow/intensify by activity.
- Zoom support:
  - city, country, continent, global levels.
- Map interactions:
  - tap pulse -> open region details/events.

## Phase 4: Solo Experience V2 (Voice + Guided Reading)
- Premium voice pipeline:
  - studio voice or premium TTS for human-like delivery.
- Guided playback experience:
  - line-by-line highlight while voice speaks
  - auto-scroll synced to timestamps.
- Preset and dynamic prayer blending:
  - curated canonical prayers + AI-personalized guidance.
- Social extension:
  - invite family/friends into private group prayer from solo flow.

## Phase 5: Intelligence and Retention Loop
- Event recommendations based on solo prayer interests and usage signals.
- Post-event and post-solo journaling prompts with thematic follow-up.
- Personal progress and intention insights (privacy-safe analytics).

## External Services Needed for Full Vision
- Visual assets:
  - custom icon/illustration pipeline (Figma + export process).
- Video/motion:
  - Lottie/Rive animation authoring.
- Voice:
  - TTS provider and/or studio recording workflow.
- Content ops:
  - CMS-backed prayer/content library with editorial workflow.
