export const APP_NAME = "Egregor";

export const DEFAULT_TIMEZONE = "Europe/London";

export const PRESENCE_HEARTBEAT_MS = 15000; // 15s
export const PRESENCE_STALE_AFTER_SECONDS = 35; // used by UI expectations

export const SCRIPT_MIN_DURATION = 3;
export const SCRIPT_MAX_DURATION = 60;

export const DEFAULT_SCRIPT_TONE = "calm" as const;

export const DEFAULT_EVENT_TITLE = "Global Peace Circle";
export const DEFAULT_EVENT_INTENTION =
  "May people everywhere experience peace, clarity, compassion, and healing.";
export const DEFAULT_EVENT_DESCRIPTION =
  "A guided collective intention session for positive change.";

export const MAP_DEFAULT_REGION = {
  latitude: 51.5074, // London
  longitude: -0.1278,
  latitudeDelta: 20,
  longitudeDelta: 20
};
