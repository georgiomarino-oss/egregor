export type Tone = "calm" | "uplifting" | "focused";

export type EventItem = {
  id: string;
  hostUserId: string;
  themeId?: string | null;
  title: string;
  description?: string | null;
  intentionStatement: string;
  visibility: string;
  guidanceMode: string;
  scriptId?: string | null;
  startTimeUtc: string;
  endTimeUtc: string;
  timezone: string;
  status: string;
  activeCountSnapshot?: number;
  totalJoinCount?: number;
  activeNow?: number;
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
  durationMinutes: number;
  tone: string;
  createdAt: string;
};

export type RootStackParamList = {
  Auth: undefined;
  Events: undefined;
  Scripts: undefined;
};
