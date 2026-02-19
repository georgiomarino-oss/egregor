// mobile/src/types.ts

export type Tone = "calm" | "uplifting" | "focused";

export type EventItem = {
  id: string;
  host_user_id: string;
  theme_id?: string | null;

  title: string;
  description?: string | null;
  intention_statement: string | null;

  visibility: "PUBLIC" | "PRIVATE" | string;
  guidance_mode: "AI" | "MANUAL" | "HYBRID" | string;
  script_id?: string | null;

  start_time_utc: string;
  end_time_utc: string;
  timezone: string | null;

  status: "SCHEDULED" | "LIVE" | "COMPLETED" | "CANCELLED" | string;

  active_count_snapshot?: number | null;
  total_join_count?: number | null;
  activeNow?: number;
  created_at?: string;
};

export type ScriptSection = {
  name: string;
  minutes: number;
  text: string;
};

export type GeneratedScript = {
  title: string;
  durationMinutes: number;
  tone: Tone;
  sections: ScriptSection[];
  speakerNotes?: string;
};

export type ScriptListItem = {
  id: string;
  title: string;
  intention: string;
  duration_minutes: number;
  tone: string;
  created_at: string;
};

/**
 * Tabs shown AFTER login
 */
export type RootTabParamList = {
  Events: undefined;
  Scripts: undefined;
};

/**
 * Top-level stack:
 * - Auth when logged out
 * - Tabs when logged in
 * - EventRoom pushed from either tab
 */
export type RootStackParamList = {
  Auth: undefined;
  Tabs: undefined;
  EventRoom: { eventId: string };
};
