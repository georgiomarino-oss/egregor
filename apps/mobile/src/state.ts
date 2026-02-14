import { createContext } from "react";
import type { EventItem, GeneratedScript, ScriptListItem, Tone } from "./types";

export const TOKEN_KEY = "egregor_mobile_token";

export type AppStateShape = {
  // Auth
  email: string;
  setEmail: (value: string) => void;
  displayName: string;
  setDisplayName: (value: string) => void;
  token: string;
  setToken: (value: string) => void;
  authStatus: string;
  setAuthStatus: (value: string) => void;

  // Create event
  newTitle: string;
  setNewTitle: (value: string) => void;
  newIntention: string;
  setNewIntention: (value: string) => void;
  newDescription: string;
  setNewDescription: (value: string) => void;
  newStartLocal: string;
  setNewStartLocal: (value: string) => void;
  newEndLocal: string;
  setNewEndLocal: (value: string) => void;
  newTimezone: string;
  setNewTimezone: (value: string) => void;
  createEventStatus: string;
  setCreateEventStatus: (value: string) => void;

  // Events / presence
  events: EventItem[];
  setEvents: (value: EventItem[]) => void;
  eventsError: string;
  setEventsError: (value: string) => void;
  selectedEventId: string;
  setSelectedEventId: (value: string) => void;
  isJoined: boolean;
  setIsJoined: (value: boolean) => void;
  presenceStatus: string;
  setPresenceStatus: (value: string) => void;
  presenceError: string;
  setPresenceError: (value: string) => void;

  // Script generation
  scriptIntention: string;
  setScriptIntention: (value: string) => void;
  scriptDuration: string;
  setScriptDuration: (value: string) => void;
  scriptTone: Tone;
  setScriptTone: (value: Tone) => void;
  generatedScript: GeneratedScript | null;
  setGeneratedScript: (value: GeneratedScript | null) => void;
  generatedScriptId: string;
  setGeneratedScriptId: (value: string) => void;
  scriptLoading: boolean;
  setScriptLoading: (value: boolean) => void;
  scriptError: string;
  setScriptError: (value: string) => void;

  // Script list / attach
  scripts: ScriptListItem[];
  setScripts: (value: ScriptListItem[]) => void;
  scriptsError: string;
  setScriptsError: (value: string) => void;
  selectedScriptId: string;
  setSelectedScriptId: (value: string) => void;
  attachStatus: string;
  setAttachStatus: (value: string) => void;

  // Actions
  loadEvents: () => Promise<void>;
  loadScripts: () => Promise<void>;
  handleSignup: () => Promise<void>;
  handleLogout: () => void;
  handleCreateEvent: () => Promise<void>;
  handleJoinLive: () => Promise<void>;
  handleLeaveLive: () => Promise<void>;
  sendHeartbeat: () => Promise<void>;
  handleGenerateScript: () => Promise<void>;
  handleAttachScript: () => Promise<void>;
};

export const AppStateContext = createContext<AppStateShape | null>(null);
