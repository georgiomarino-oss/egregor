export type Tone = "calm" | "uplifting" | "focused";

export type EventVisibility = "PUBLIC" | "PRIVATE";
export type GuidanceMode = "AI" | "HUMAN";
export type EventStatus = "SCHEDULED" | "LIVE" | "ENDED";

export type EventRow = {
  id: string;
  host_user_id: string;
  theme_id: string | null;
  title: string;
  description: string | null;
  intention_statement: string;
  visibility: EventVisibility;
  guidance_mode: GuidanceMode;
  script_id: string | null;
  start_time_utc: string; // ISO string
  end_time_utc: string; // ISO string
  timezone: string;
  status: EventStatus;
  active_count_snapshot: number;
  total_join_count: number;
  created_at: string; // ISO string
};

export type ScriptSection = {
  name: string;
  minutes: number;
  text: string;
};

export type ScriptContent = {
  title: string;
  durationMinutes: number;
  tone: Tone;
  sections: ScriptSection[];
  speakerNotes?: string;
};

export type ScriptRow = {
  id: string;
  author_user_id: string;
  title: string;
  intention: string;
  duration_minutes: number;
  tone: Tone;
  content_json: string; // stringified ScriptContent JSON
  created_at: string;
};

export type ThemeRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type PresenceRow = {
  id: string;
  event_id: string;
  user_id: string;
  is_active: boolean;
  last_heartbeat_at: string; // ISO string
  lat: number | null;
  lng: number | null;
  geohash: string | null;
};

export type HeatCell = {
  cell_id: string; // geohash/grid key
  active_count: number;
};

export type RootStackParamList = {
  Auth: undefined;
  Events: undefined;
  Scripts: { eventId?: string } | undefined;
};
