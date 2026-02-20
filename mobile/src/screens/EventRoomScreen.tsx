// mobile/src/screens/EventRoomScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  AppState,
  AppStateStatus,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase/client";
import type { RootStackParamList } from "../types";
import type { Database } from "../types/db";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";

import {
  ensureRunState,
  normalizeRunState,
  subscribeRunState,
  setRunStateServerTime,
  type EventRunStateV1,
  type EventRunMode,
} from "../features/events/runStateRepo";

type Props = NativeStackScreenProps<RootStackParamList, "EventRoom">;

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type ScriptDbRow = Database["public"]["Tables"]["scripts"]["Row"];
type PresenceRow = Database["public"]["Tables"]["event_presence"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type EventMessageRow = Database["public"]["Tables"]["event_messages"]["Row"];
type EventMessageInsert = Database["public"]["Tables"]["event_messages"]["Insert"];

type ScriptSection = {
  name: string;
  minutes: number;
  text: string;
};

type ScriptContent = {
  title: string;
  durationMinutes: number;
  tone: "calm" | "uplifting" | "focused" | string;
  sections: ScriptSection[];
  speakerNotes?: string;
};

function parseScriptContent(raw: any): ScriptContent | null {
  if (!raw) return null;

  let obj: any = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!obj || typeof obj !== "object") return null;
  if (!Array.isArray(obj.sections)) return null;

  const sections: ScriptSection[] = obj.sections
    .map((s: any) => ({
      name: String(s?.name ?? "Section"),
      minutes: Number(s?.minutes ?? 1),
      text: String(s?.text ?? ""),
    }))
    .filter((s: ScriptSection) => Number.isFinite(s.minutes) && s.minutes > 0);

  if (sections.length === 0) return null;

  const durationMinutes =
    Number(obj.durationMinutes) ||
    sections.reduce((a, b) => a + (Number.isFinite(b.minutes) ? b.minutes : 0), 0);

  return {
    title: String(obj.title ?? "Guided Intention Script"),
    durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : 0,
    tone: String(obj.tone ?? "calm"),
    sections,
    speakerNotes: obj.speakerNotes ? String(obj.speakerNotes) : undefined,
  };
}

function formatSeconds(total: number) {
  const s = Math.max(0, Math.floor(total));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function secondsBetweenIso(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 1000));
}

function statusPillStyle(mode: EventRunMode) {
  switch (mode) {
    case "running":
      return { borderColor: "#2E5BFF", backgroundColor: "#0F1C44", textColor: "#DCE4FF" };
    case "paused":
      return { borderColor: "#8B5CF6", backgroundColor: "#1A1240", textColor: "#E4D7FF" };
    case "ended":
      return { borderColor: "#FB7185", backgroundColor: "#2A1220", textColor: "#FFE0E6" };
    default:
      return { borderColor: "#3E4C78", backgroundColor: "#0E1428", textColor: "#C8D3FF" };
  }
}

function formatAgo(secondsAgo: number) {
  const s = Math.max(0, Math.floor(secondsAgo));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function presenceRowKey(eventId: string, userId: string) {
  return `${eventId}:${userId}`;
}

function upsertPresenceRow(rows: PresenceRow[], next: PresenceRow): PresenceRow[] {
  const key = presenceRowKey(next.event_id, next.user_id);
  const idx = rows.findIndex((r) => presenceRowKey(r.event_id, r.user_id) === key);
  if (idx < 0) return [...rows, next];

  const copy = [...rows];
  copy[idx] = next;
  return copy;
}

function removePresenceRow(rows: PresenceRow[], eventId: string, userId: string): PresenceRow[] {
  if (!eventId || !userId) return rows;
  const key = presenceRowKey(eventId, userId);
  return rows.filter((r) => presenceRowKey(r.event_id, r.user_id) !== key);
}

function sortMessagesByCreatedAt(rows: EventMessageRow[]): EventMessageRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    const ta = safeTimeMs(a.created_at);
    const tb = safeTimeMs(b.created_at);
    if (ta !== tb) return ta - tb;

    const aid = String((a as any).id ?? "");
    const bid = String((b as any).id ?? "");
    return aid.localeCompare(bid);
  });
  return copy;
}

function upsertAndSortMessage(rows: EventMessageRow[], next: EventMessageRow): EventMessageRow[] {
  const id = String((next as any).id ?? "");
  if (!id) return sortMessagesByCreatedAt([...rows, next]);

  const idx = rows.findIndex((m: any) => String(m.id ?? "") === id);
  if (idx < 0) return sortMessagesByCreatedAt([...rows, next]);

  const copy = [...rows];
  copy[idx] = next;
  return sortMessagesByCreatedAt(copy);
}

function removeMessageById(rows: EventMessageRow[], id: string): EventMessageRow[] {
  if (!id) return rows;
  return rows.filter((m: any) => String((m as any).id ?? "") !== id);
}

/**
 * Local preferences:
 * - Global: prefs:autoJoinLive (default true)
 * - Per-event: joined:event:<eventId> (sticky join state)
 */
const KEY_AUTO_JOIN_GLOBAL = "prefs:autoJoinLive";

function joinPrefKey(eventId: string) {
  return `joined:event:${eventId}`;
}

async function readBool(key: string, defaultValue: boolean) {
  try {
    const v = await AsyncStorage.getItem(key);
    if (v === null) return defaultValue;
    return v === "1";
  } catch {
    return defaultValue;
  }
}

async function writeBool(key: string, value: boolean) {
  try {
    await AsyncStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore
  }
}

async function readJoinPref(eventId: string): Promise<boolean> {
  return readBool(joinPrefKey(eventId), false);
}

async function writeJoinPref(eventId: string, joined: boolean): Promise<void> {
  return writeBool(joinPrefKey(eventId), joined);
}

type ProfileMini = Pick<ProfileRow, "id" | "display_name" | "avatar_url">;

// Tuneables
const ACTIVE_WINDOW_MS = 90_000;
const HEARTBEAT_MS = 10_000;
const PRESENCE_RESYNC_MS = 60_000;
const CHAT_RESYNC_MS = 60_000;
const RUN_STATE_RESYNC_MS = 60_000;
const CHAT_MAX_CHARS = 1000;
const ENERGY_GIFT_VALUES = [1, 3, 7] as const;

function mapChatSendError(message: string) {
  const m = String(message ?? "").toLowerCase();
  if (m.includes("too many messages")) {
    return {
      title: "Slow down",
      body: "You are sending messages too quickly. Please wait a few seconds and try again.",
    };
  }
  if (m.includes("cannot be empty")) {
    return {
      title: "Empty message",
      body: "Type a message before sending.",
    };
  }
  if (m.includes("exceeds 1000 characters")) {
    return {
      title: "Message too long",
      body: `Keep messages under ${CHAT_MAX_CHARS} characters.`,
    };
  }
  return {
    title: "Send failed",
    body: message || "Unknown error",
  };
}


// Chat: how close to bottom counts as "near bottom"
const CHAT_BOTTOM_THRESHOLD_PX = 120;

export default function EventRoomScreen({ route, navigation }: Props) {
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const eventId = route.params?.eventId ?? "";
  const hasValidEventId = !!eventId && isLikelyUuid(eventId);

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<EventRow | null>(null);

  const [scriptDbRow, setScriptDbRow] = useState<
    Pick<ScriptDbRow, "id" | "title" | "content_json"> | null
  >(null);
  const [script, setScript] = useState<ScriptContent | null>(null);

  // Auth user
  const [userId, setUserId] = useState<string>("");

  // Presence
  const [presenceRows, setPresenceRows] = useState<PresenceRow[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [presenceMsg, setPresenceMsg] = useState("");
  const [presenceErr, setPresenceErr] = useState("");
  const telemetryCountsRef = useRef<Record<string, number>>({});

  const logTelemetry = useCallback(
    (eventName: string, details?: Record<string, unknown>) => {
      if (!__DEV__) return;
      const key = eventName.trim();
      if (!key) return;

      const counts = telemetryCountsRef.current;
      const nextCount = (counts[key] ?? 0) + 1;
      counts[key] = nextCount;

      if (nextCount <= 5 || nextCount % 10 === 0) {
        console.log(`[EventRoom:${eventId || "no-event"}] ${key} #${nextCount}`, details ?? {});
      }
    },
    [eventId]
  );

  // App state tracking (for heartbeat/presence correctness)
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  // Profiles cache
  const [profilesById, setProfilesById] = useState<Record<string, ProfileMini>>({});
  const profilesByIdRef = useRef<Record<string, ProfileMini>>({});
  useEffect(() => {
    profilesByIdRef.current = profilesById;
  }, [profilesById]);

  // Join preference loaded
  const [joinPrefLoaded, setJoinPrefLoaded] = useState(false);
  const [shouldAutoJoinForEvent, setShouldAutoJoinForEvent] = useState(false);

  // Global auto-join setting
  const [autoJoinGlobalLoaded, setAutoJoinGlobalLoaded] = useState(false);
  const [autoJoinGlobalEnabled, setAutoJoinGlobalEnabled] = useState(true);

  // Run state (synced)
  const [runState, setRunState] = useState<EventRunStateV1>({
    version: 1,
    mode: "idle",
    sectionIndex: 0,
  });
  const [runReady, setRunReady] = useState(false);
  const [runErr, setRunErr] = useState("");

  // Local ticker for UI countdown refresh
  const [tick, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasScript = !!script && !!script.sections?.length;

  // Attendee preview
  const [previewSectionIdx, setPreviewSectionIdx] = useState<number | null>(null);

  const hostId = useMemo(() => String((event as any)?.host_user_id ?? ""), [event]);

  const isHost = useMemo(() => {
    if (!userId || !hostId) return false;
    return userId === hostId;
  }, [userId, hostId]);

  useEffect(() => {
    if (isHost) {
      setPreviewSectionIdx(null);
      return;
    }
    if (!hasScript) setPreviewSectionIdx(null);
  }, [isHost, hasScript, runState.sectionIndex]);

  const hostSectionIdx = useMemo(() => {
    const len = script?.sections?.length ?? 0;
    if (len <= 0) return 0;
    const idx = Number.isFinite(runState.sectionIndex) ? runState.sectionIndex : 0;
    return Math.min(Math.max(0, idx), len - 1);
  }, [runState.sectionIndex, script?.sections?.length]);

  const viewingSectionIdx = useMemo(() => {
    if (isHost) return hostSectionIdx;
    if (previewSectionIdx === null) return hostSectionIdx;
    const len = script?.sections?.length ?? 0;
    if (len <= 0) return 0;
    return Math.min(Math.max(0, previewSectionIdx), len - 1);
  }, [isHost, hostSectionIdx, previewSectionIdx, script?.sections?.length]);

  const viewingHostLive = useMemo(() => {
    if (isHost) return true;
    return previewSectionIdx === null || viewingSectionIdx === hostSectionIdx;
  }, [isHost, previewSectionIdx, viewingSectionIdx, hostSectionIdx]);

  const currentSection = useMemo(() => {
    if (!script?.sections?.length) return null;
    return script.sections[viewingSectionIdx] ?? null;
  }, [script, viewingSectionIdx]);

  const sectionTotalSeconds = useMemo(() => {
    if (!currentSection) return 0;
    return Math.max(1, Math.floor(currentSection.minutes * 60));
  }, [currentSection]);

  const secondsLeft = useMemo(() => {
    if (!script || !currentSection) return 0;

    if (!viewingHostLive || viewingSectionIdx !== hostSectionIdx) {
      return sectionTotalSeconds;
    }

    const durationSec = sectionTotalSeconds;
    const baseElapsed = runState.elapsedBeforePauseSec ?? 0;

    if (runState.mode === "running" && runState.startedAt) {
      const elapsedThisRun = secondsBetweenIso(runState.startedAt, nowIso());
      const elapsed = baseElapsed + elapsedThisRun;
      return Math.max(0, durationSec - elapsed);
    }

    return Math.max(0, durationSec - baseElapsed);
  }, [
    script,
    currentSection,
    sectionTotalSeconds,
    runState,
    tick,
    viewingHostLive,
    viewingSectionIdx,
    hostSectionIdx,
  ]);

  const totalScriptSeconds = useMemo(() => {
    if (!script?.sections?.length) return 0;
    return script.sections.reduce((sum, s) => sum + Math.max(1, Math.floor(s.minutes * 60)), 0);
  }, [script]);

  const elapsedWithinSectionSeconds = useMemo(() => {
    if (sectionTotalSeconds <= 0) return 0;
    return Math.max(0, Math.min(sectionTotalSeconds, sectionTotalSeconds - secondsLeft));
  }, [sectionTotalSeconds, secondsLeft]);

  const elapsedBeforeSectionSeconds = useMemo(() => {
    if (!script?.sections?.length) return 0;
    const clampedIdx = Math.min(Math.max(0, viewingSectionIdx), script.sections.length - 1);
    let sum = 0;
    for (let i = 0; i < clampedIdx; i += 1) {
      sum += Math.max(1, Math.floor((script.sections[i]?.minutes ?? 1) * 60));
    }
    return sum;
  }, [script, viewingSectionIdx]);

  const sectionProgressPct = useMemo(() => {
    if (runState.mode === "ended") return 1;
    if (sectionTotalSeconds <= 0) return 0;
    return Math.max(0, Math.min(1, elapsedWithinSectionSeconds / sectionTotalSeconds));
  }, [runState.mode, elapsedWithinSectionSeconds, sectionTotalSeconds]);

  const totalProgressPct = useMemo(() => {
    if (runState.mode === "ended") return 1;
    if (totalScriptSeconds <= 0) return 0;
    const elapsed = elapsedBeforeSectionSeconds + elapsedWithinSectionSeconds;
    return Math.max(0, Math.min(1, elapsed / totalScriptSeconds));
  }, [runState.mode, totalScriptSeconds, elapsedBeforeSectionSeconds, elapsedWithinSectionSeconds]);

  const runStatusLabel = useMemo(() => {
    if (!runReady) return "...";
    if (runState.mode === "idle") return "Idle";
    if (runState.mode === "running") return "Running";
    if (runState.mode === "paused") return "Paused";
    if (runState.mode === "ended") return "Ended";
    return String(runState.mode);
  }, [runReady, runState.mode]);

  const displayNameForUserId = useCallback((id: string) => {
    const p = profilesByIdRef.current[id];
    const name = (p?.display_name ?? "").trim();
    return name.length > 0 ? name : shortId(id);
  }, []);

  const ensureUserId = useCallback(async () => {
    if (userId) return userId;
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return "";
    setUserId(user.id);
    return user.id;
  }, [userId]);

  const loadProfiles = useCallback(async (ids: string[]) => {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (uniq.length === 0) return;

    const missing = uniq.filter((id) => !profilesByIdRef.current[id]);
    if (missing.length === 0) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("id,display_name,avatar_url")
      .in("id", missing);

    if (error) return;

    const rows = (data ?? []) as ProfileMini[];
    if (rows.length === 0) return;

    setProfilesById((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.id] = r;
      return next;
    });
  }, []);

  const loadPresence = useCallback(async (reason = "manual") => {
    if (!hasValidEventId) {
      setPresenceRows([]);
      return;
    }

    logTelemetry("presence_resync_attempt", { reason });
    const { data, error } = await supabase
      .from("event_presence")
      .select("event_id,user_id,joined_at,last_seen_at,created_at")
      .eq("event_id", eventId);

    if (error) {
      logTelemetry("presence_resync_error", { reason, message: error.message });
      return;
    }

    const rows = (data ?? []) as PresenceRow[];
    setPresenceRows(rows);
    void loadProfiles(rows.map((r) => r.user_id));
    logTelemetry("presence_resync_success", { reason, count: rows.length });
  }, [eventId, hasValidEventId, loadProfiles, logTelemetry]);

  const loadScriptById = useCallback(async (scriptId: string | null) => {
    if (!scriptId) {
      setScriptDbRow(null);
      setScript(null);
      return;
    }

    const { data: scData, error: scErr } = await supabase
      .from("scripts")
      .select("id,title,content_json")
      .eq("id", scriptId)
      .maybeSingle();

    if (scErr || !scData) {
      setScriptDbRow(null);
      setScript(null);
      return;
    }

    const row = scData as Pick<ScriptDbRow, "id" | "title" | "content_json">;
    setScriptDbRow(row);
    setScript(parseScriptContent(row.content_json));
    setPreviewSectionIdx(null);
  }, []);

  // ---- Chat ----
  const [messages, setMessages] = useState<EventMessageRow[]>([]);
  const [chatText, setChatText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingEnergy, setSendingEnergy] = useState<number | null>(null);
  const [pendingMessageCount, setPendingMessageCount] = useState(0);
  const [unreadMarkerMessageId, setUnreadMarkerMessageId] = useState<string | null>(null);
  const chatListRef = useRef<FlatList<EventMessageRow>>(null);
  const chatContentHeightRef = useRef(0);
  const chatScrollOffsetYRef = useRef(0);

  // "Should we autoscroll?" tracking
  const shouldAutoScrollRef = useRef(true);

  const scrollChatToEnd = useCallback((animated = true) => {
    try {
      chatListRef.current?.scrollToEnd({ animated });
    } catch {
      // ignore
    }
  }, []);

  const onChatScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    chatScrollOffsetYRef.current = contentOffset.y;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const nearBottom = distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX;
    shouldAutoScrollRef.current = nearBottom;

    if (nearBottom) {
      setPendingMessageCount(0);
      setUnreadMarkerMessageId(null);
    }
  }, []);

  const chatChars = chatText.length;

  const loadMessages = useCallback(async (reason = "manual") => {
    if (!hasValidEventId) {
      setMessages([]);
      return;
    }

    logTelemetry("chat_resync_attempt", { reason });
    const { data, error } = await supabase
      .from("event_messages")
      .select("id,event_id,user_id,body,created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      logTelemetry("chat_resync_error", { reason, message: error.message });
      return;
    }

    const rows = (data ?? []) as EventMessageRow[];
    setMessages(sortMessagesByCreatedAt(rows));
    if (shouldAutoScrollRef.current) {
      setPendingMessageCount(0);
      setUnreadMarkerMessageId(null);
    }
    void loadProfiles(rows.map((m) => String((m as any).user_id ?? "")));
    logTelemetry("chat_resync_success", { reason, count: rows.length });
  }, [eventId, hasValidEventId, loadProfiles, logTelemetry]);

  const sendMessage = useCallback(async () => {
    const text = chatText.trim();
    if (!text) return;
    if (text.length > CHAT_MAX_CHARS) {
      Alert.alert("Message too long", `Keep messages under ${CHAT_MAX_CHARS} characters.`);
      return;
    }

    const uid = await ensureUserId();
    if (!uid) {
      Alert.alert("Not signed in", "Please sign in first.");
      return;
    }

    if (!hasValidEventId) return;

    setSending(true);
    try {
      const payload: EventMessageInsert = {
        event_id: eventId,
        user_id: uid,
        body: text,
      };

      const { error } = await supabase.from("event_messages").insert(payload);
      if (error) {
        const mapped = mapChatSendError(error.message);
        Alert.alert(mapped.title, mapped.body);
        return;
      }

      setChatText("");
      shouldAutoScrollRef.current = true;
      setPendingMessageCount(0);
      setUnreadMarkerMessageId(null);
      setTimeout(() => scrollChatToEnd(true), 30);
    } finally {
      setSending(false);
    }
  }, [chatText, eventId, hasValidEventId, scrollChatToEnd, ensureUserId]);

  const sendEnergyGift = useCallback(
    async (amount: number) => {
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (!hasValidEventId) return;

      const uid = await ensureUserId();
      if (!uid) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      setSendingEnergy(amount);
      try {
        const payload: EventMessageInsert = {
          event_id: eventId,
          user_id: uid,
          body: `Sent ${amount} energy to this circle.`,
        };

        const { error } = await supabase.from("event_messages").insert(payload);
        if (error) {
          const mapped = mapChatSendError(error.message);
          Alert.alert(mapped.title, mapped.body);
          return;
        }

        shouldAutoScrollRef.current = true;
        setPendingMessageCount(0);
        setUnreadMarkerMessageId(null);
        setTimeout(() => scrollChatToEnd(true), 30);
      } finally {
        setSendingEnergy(null);
      }
    },
    [ensureUserId, eventId, hasValidEventId, scrollChatToEnd]
  );

  // ---- Load room ----
  const loadEventRoom = useCallback(async () => {
    if (!hasValidEventId) {
      setLoading(false);
      setEvent(null);
      setScript(null);
      setScriptDbRow(null);
      setPresenceRows([]);
      setMessages([]);
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id ?? "");

      const { data: evData, error: evErr } = await supabase
        .from("events")
        .select(
          `
        id,title,description,intention_statement,script_id,
        start_time_utc,end_time_utc,timezone,status,
        active_count_snapshot,total_join_count,host_user_id
      `
        )
        .eq("id", eventId)
        .single();

      if (evErr || !evData) {
        setLoading(false);
        setEvent(null);
        setScript(null);
        setScriptDbRow(null);
        Alert.alert("Event load failed", evErr?.message ?? "Event not found");
        return;
      }

      const eventRow = evData as EventRow;
      setEvent(eventRow);

      const hostUserId = String((eventRow as any).host_user_id ?? "");
      void loadProfiles([hostUserId]);

      await Promise.all([
        loadPresence("room_load"),
        loadMessages("room_load"),
        loadScriptById((eventRow as any).script_id ?? null),
        (async () => {
          const row = await ensureRunState(eventId);
          setRunState(normalizeRunState(row.state));
          setRunReady(true);
        })(),
      ]);

      setLoading(false);
      // initial scroll only once; assume user wants latest
      setTimeout(() => scrollChatToEnd(false), 50);
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Load failed", e?.message ?? "Unknown error");
    }
  }, [
    eventId,
    hasValidEventId,
    loadPresence,
    loadMessages,
    loadScriptById,
    loadProfiles,
    scrollChatToEnd,
  ]);

  useEffect(() => {
    loadEventRoom();
  }, [loadEventRoom]);

  // Load global auto-join setting (default true)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const enabled = await readBool(KEY_AUTO_JOIN_GLOBAL, true);
      if (cancelled) return;
      setAutoJoinGlobalEnabled(enabled);
      setAutoJoinGlobalLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppState(next);
    });
    return () => {
      sub.remove();
    };
  }, []);

  // Load per-event sticky join pref
  useEffect(() => {
    let cancelled = false;
    if (!hasValidEventId) return;

    (async () => {
      const pref = await readJoinPref(eventId);
      if (cancelled) return;
      setShouldAutoJoinForEvent(pref);
      setJoinPrefLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, hasValidEventId]);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => setTick((t) => t + 1), 500);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, []);

  // Events row realtime
  useEffect(() => {
    if (!hasValidEventId) return;

    const channel = supabase
      .channel(`event:${eventId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${eventId}` },
        async (payload) => {
          const next = payload.new as Partial<EventRow> | null;
          const prev = payload.old as Partial<EventRow> | null;

          setEvent((cur) => {
            if (!cur) return cur;
            return { ...cur, ...(next as any) };
          });

          const nextScriptId = (next as any)?.script_id ?? null;
          const prevScriptId = (prev as any)?.script_id ?? null;
          if (nextScriptId !== prevScriptId) await loadScriptById(nextScriptId);

          const nextHostId = String((next as any)?.host_user_id ?? "");
          const prevHostId = String((prev as any)?.host_user_id ?? "");
          if (nextHostId && nextHostId !== prevHostId) void loadProfiles([nextHostId]);
        }
      )
      .subscribe((status) => {
        logTelemetry("event_channel_status", { status });
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, hasValidEventId, loadScriptById, loadProfiles, logTelemetry]);

  // Run state realtime
  useEffect(() => {
    if (!hasValidEventId) return;

    let disposed = false;
    const resync = async () => {
      if (disposed) return;
      try {
        logTelemetry("run_state_resync_attempt");
        const row = await ensureRunState(eventId);
        if (disposed) return;
        setRunState(normalizeRunState(row.state));
        setRunReady(true);
        logTelemetry("run_state_resync_success");
      } catch (e: any) {
        logTelemetry("run_state_resync_error", { message: e?.message ?? "Unknown error" });
        // keep realtime subscription as primary source
      }
    };

    void resync();
    const intervalId = setInterval(() => {
      void resync();
    }, RUN_STATE_RESYNC_MS);

    const sub = subscribeRunState(eventId, (row) => {
      setRunState(normalizeRunState(row.state));
      setRunReady(true);
    });

    return () => {
      disposed = true;
      clearInterval(intervalId);
      logTelemetry("run_state_resync_stop");
      sub.unsubscribe();
    };
  }, [eventId, hasValidEventId, logTelemetry]);

  // Attached script realtime (script edits while room is open)
  useEffect(() => {
    if (!hasValidEventId) return;
    const scriptId = scriptDbRow?.id ?? null;
    if (!scriptId) return;

    const channel = supabase
      .channel(`event-script:${eventId}:${scriptId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scripts", filter: `id=eq.${scriptId}` },
        async (payload) => {
          const eventType = String((payload as any).eventType ?? "");
          if (eventType === "DELETE") {
            setScriptDbRow(null);
            setScript(null);
            return;
          }
          await loadScriptById(scriptId);
        }
      )
      .subscribe((status) => {
        logTelemetry("script_channel_status", { status, scriptId });
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, hasValidEventId, scriptDbRow?.id, loadScriptById, logTelemetry]);

  // Presence realtime
  useEffect(() => {
    if (!hasValidEventId) return;

    let disposed = false;
    const resync = () => {
      if (disposed) return;
      void loadPresence("interval");
    };

    void loadPresence("initial");
    const intervalId = setInterval(resync, PRESENCE_RESYNC_MS);

    const channel = supabase
      .channel(`presence:${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_presence", filter: `event_id=eq.${eventId}` },
        (payload) => {
          const eventType = String((payload as any).eventType ?? "");
          logTelemetry("presence_realtime_event", { eventType });
          const next = ((payload as any).new ?? null) as PresenceRow | null;
          const prev = ((payload as any).old ?? null) as PresenceRow | null;

          setPresenceRows((rows) => {
            if (eventType === "DELETE") {
              const eventIdToDrop = String((prev as any)?.event_id ?? eventId);
              const userIdToDrop = String((prev as any)?.user_id ?? "");
              return removePresenceRow(rows, eventIdToDrop, userIdToDrop);
            }

            if (!next) return rows;
            return upsertPresenceRow(rows, next);
          });

          const changedUserId = String((next as any)?.user_id ?? (prev as any)?.user_id ?? "");
          if (changedUserId) void loadProfiles([changedUserId]);
        }
      )
      .subscribe((status) => {
        logTelemetry("presence_channel_status", { status });
      });

    return () => {
      disposed = true;
      clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [eventId, hasValidEventId, loadPresence, loadProfiles, logTelemetry]);

  // Chat realtime incremental updates with periodic resync fallback
  useEffect(() => {
    if (!hasValidEventId) return;

    let disposed = false;
    const resync = () => {
      if (disposed) return;
      void loadMessages("interval");
    };

    void loadMessages("initial");
    const intervalId = setInterval(resync, CHAT_RESYNC_MS);

    const ch = supabase
      .channel(`chat:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_messages",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const eventType = String((payload as any).eventType ?? "");
          const nextRow = (payload.new ?? null) as EventMessageRow | null;
          const prevRow = (payload.old ?? null) as EventMessageRow | null;
          const nextId = String((nextRow as any)?.id ?? "");
          const prevId = String((prevRow as any)?.id ?? "");
          const targetId = nextId || prevId;

          if (eventType === "DELETE") {
            if (!targetId) return;
            setMessages((prev) => removeMessageById(prev, targetId));
            setPendingMessageCount((count) => Math.max(0, count - 1));
            setUnreadMarkerMessageId((cur) => (cur === targetId ? null : cur));
            return;
          }

          if (!nextRow) return;

          const rowUserId = String((nextRow as any).user_id ?? "");
          const isMine = !!userId && rowUserId === userId;
          let insertedNew = false;

          setMessages((prev) => {
            const hadMessage = !!nextId && prev.some((m: any) => String((m as any).id ?? "") === nextId);
            insertedNew = !hadMessage;
            const merged = upsertAndSortMessage(prev, nextRow);
            const insertedIdx = merged.findIndex((m: any) => String((m as any).id ?? "") === nextId);
            const expectedTailIdx = Math.max(0, merged.length - 1);

            if (!hadMessage && insertedIdx >= 0 && insertedIdx < expectedTailIdx) {
              logTelemetry("chat_reorder_correction", {
                insertedIdx,
                expectedTailIdx,
                createdAt: nextRow.created_at ?? null,
              });
            } else if (hadMessage) {
              logTelemetry("chat_dedupe_hit", { id: nextId });
            }

            return merged;
          });

          void loadProfiles([rowUserId]);

          if (eventType !== "INSERT") return;

          setTimeout(() => {
            if (shouldAutoScrollRef.current) {
              scrollChatToEnd(true);
              setPendingMessageCount(0);
              setUnreadMarkerMessageId(null);
            } else if (!isMine && insertedNew) {
              setPendingMessageCount((count) => {
                if (count === 0 && nextId) setUnreadMarkerMessageId(nextId);
                return count + 1;
              });
            }
          }, 30);
        }
      )
      .subscribe((status) => {
        logTelemetry("chat_channel_status", { status });
      });

    return () => {
      disposed = true;
      clearInterval(intervalId);
      supabase.removeChannel(ch);
    };
  }, [eventId, hasValidEventId, loadMessages, loadProfiles, scrollChatToEnd, userId, logTelemetry]);

  const jumpToLatestMessages = useCallback(() => {
    setPendingMessageCount(0);
    setUnreadMarkerMessageId(null);
    shouldAutoScrollRef.current = true;
    scrollChatToEnd(true);
  }, [scrollChatToEnd]);

  useEffect(() => {
    if (!userId) {
      setIsJoined(false);
      return;
    }
    const joined = presenceRows.some((r) => r.user_id === userId);
    setIsJoined((prev) => (prev === joined ? prev : joined));
  }, [presenceRows, userId]);

  // Helper: upsert presence, preserving joined_at if it already exists
  const upsertPresencePreserveJoinedAt = useCallback(
    async (uid: string) => {
      const now = new Date().toISOString();
      const existing = presenceRows.find((r) => r.user_id === uid);

      const payload: Database["public"]["Tables"]["event_presence"]["Insert"] = {
        event_id: eventId,
        user_id: uid,
        last_seen_at: now,
        joined_at: existing?.joined_at ?? (existing ? null : now),
      };

      if (existing && existing.joined_at) (payload as any).joined_at = existing.joined_at;
      else if (existing && !existing.joined_at) (payload as any).joined_at = now;

      const { error } = await supabase.from("event_presence").upsert(payload, {
        onConflict: "event_id,user_id",
      });

      if (error) throw error;
    },
    [eventId, presenceRows]
  );

  // Auto-join
  useEffect(() => {
    let cancelled = false;

    if (!hasValidEventId) return;
    if (!autoJoinGlobalLoaded || !joinPrefLoaded) return;
    if (!autoJoinGlobalEnabled) return;
    if (!shouldAutoJoinForEvent) return;
    if (isJoined) return;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        const uid = user?.id ?? (await ensureUserId());
        if (!uid || cancelled) return;

        await upsertPresencePreserveJoinedAt(uid);
        if (cancelled) return;

        setIsJoined(true);
        setPresenceMsg("You joined live.");
        await loadPresence();
      } catch (e: any) {
        if (!cancelled) setPresenceErr(e?.message ?? "Auto-join failed.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    eventId,
    hasValidEventId,
    autoJoinGlobalLoaded,
    joinPrefLoaded,
    autoJoinGlobalEnabled,
    shouldAutoJoinForEvent,
    isJoined,
    loadPresence,
    upsertPresencePreserveJoinedAt,
    ensureUserId,
  ]);

  // Heartbeat while joined - only when app is active
  useEffect(() => {
    if (!isJoined) return;
    if (!hasValidEventId) return;
    if (appState !== "active") return;
    if (!userId) return;

    let cancelled = false;

    const beat = async () => {
      if (cancelled) return;

      const now = new Date().toISOString();

      const { error } = await supabase.from("event_presence").upsert(
        { event_id: eventId, user_id: userId, last_seen_at: now },
        { onConflict: "event_id,user_id" }
      );

      if (error && !cancelled) {
        logTelemetry("heartbeat_upsert_error", { message: error.message, appState });
        setPresenceErr((prev) => (prev === error.message ? prev : error.message));
      }
    };

    void beat();
    const intervalId = setInterval(() => {
      void beat();
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [isJoined, eventId, hasValidEventId, appState, userId, logTelemetry]);

  // Presence computed
  const presenceSortedByLastSeen = useMemo(() => {
    const rows = [...presenceRows];
    rows.sort((a, b) => safeTimeMs(b.last_seen_at) - safeTimeMs(a.last_seen_at));
    return rows;
  }, [presenceRows]);

  const activePresence = useMemo(() => {
    const now = Date.now();
    return presenceSortedByLastSeen.filter((r) => {
      const t = safeTimeMs(r.last_seen_at);
      return t > 0 && now - t <= ACTIVE_WINDOW_MS;
    });
  }, [presenceSortedByLastSeen, tick]);

  const recentPresence = useMemo(() => {
    const now = Date.now();
    return presenceSortedByLastSeen.filter((r) => {
      const t = safeTimeMs(r.last_seen_at);
      return t > 0 && now - t > ACTIVE_WINDOW_MS;
    });
  }, [presenceSortedByLastSeen, tick]);

  const activeCount = activePresence.length;
  const totalAttendees = presenceRows.length;
  const heartScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const intensity = Math.max(0, Math.min(1, activeCount / 40));
    const expandTo = 1.02 + intensity * 0.18;
    const duration = Math.max(700, 1500 - Math.round(intensity * 650));

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(heartScale, {
          toValue: expandTo,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
      heartScale.stopAnimation();
      heartScale.setValue(1);
    };
  }, [activeCount, heartScale]);

  const hostName = hostId ? displayNameForUserId(hostId) : "(unknown)";

  const handleJoinLive = useCallback(async () => {
    if (!hasValidEventId) {
      Alert.alert("Missing event", "This screen was opened without a valid event id.");
      return;
    }

    try {
      setPresenceErr("");
      setPresenceMsg("");

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      const uid = user?.id ?? (await ensureUserId());

      if (error || !uid) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      await upsertPresencePreserveJoinedAt(uid);

      setIsJoined(true);
      setPresenceMsg("You joined live.");
      await writeJoinPref(eventId, true);
      setShouldAutoJoinForEvent(true);
      await loadPresence();
    } catch (e: any) {
      setPresenceErr(e?.message ?? "Failed to join live.");
    }
  }, [eventId, hasValidEventId, loadPresence, upsertPresencePreserveJoinedAt, ensureUserId]);

  const handleLeaveLive = useCallback(async () => {
    if (!hasValidEventId) return;

    try {
      setPresenceErr("");
      setPresenceMsg("");

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id ?? (await ensureUserId());

      if (!uid) {
        setPresenceErr("Not signed in.");
        return;
      }

      const { error } = await supabase
        .from("event_presence")
        .delete()
        .eq("event_id", eventId)
        .eq("user_id", uid);

      if (error) {
        setPresenceErr(error.message);
        return;
      }

      setIsJoined(false);
      setPresenceMsg("You left live.");
      await writeJoinPref(eventId, false);
      setShouldAutoJoinForEvent(false);
      await loadPresence();
    } catch (e: any) {
      setPresenceErr(e?.message ?? "Failed to leave.");
    }
  }, [eventId, hasValidEventId, loadPresence, ensureUserId]);

  const handleToggleAutoJoinGlobal = useCallback(async (next: boolean) => {
    setAutoJoinGlobalEnabled(next);
    await writeBool(KEY_AUTO_JOIN_GLOBAL, next);
  }, []);

  const clampIndex = useCallback(
    (idx: number) => {
      const len = script?.sections?.length ?? 0;
      if (len <= 0) return 0;
      return Math.min(Math.max(0, idx), len - 1);
    },
    [script?.sections?.length]
  );

  const hostSetViaServer = useCallback(
    async (
      mode: EventRunMode,
      sectionIndex: number,
      elapsedBeforePauseSec: number,
      resetTimer: boolean
    ) => {
      if (!hasValidEventId) return;

      const row = await setRunStateServerTime({
        eventId,
        mode,
        sectionIndex,
        elapsedBeforePauseSec,
        resetTimer,
      });

      setRunState(normalizeRunState(row.state));
      setRunReady(true);
    },
    [eventId, hasValidEventId]
  );

  const hostStart = useCallback(async () => {
    try {
      setRunErr("");
      const idx = clampIndex(runState.sectionIndex ?? 0);
      await hostSetViaServer("running", idx, 0, true);
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to start.");
    }
  }, [clampIndex, hostSetViaServer, runState.sectionIndex]);

  const hostRestart = useCallback(async () => {
    try {
      setRunErr("");
      const idx = clampIndex(runState.sectionIndex ?? 0);
      await hostSetViaServer("running", idx, 0, true);
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to restart.");
    }
  }, [clampIndex, hostSetViaServer, runState.sectionIndex]);

  const hostPause = useCallback(async () => {
    if (runState.mode !== "running" || !runState.startedAt) return;

    try {
      setRunErr("");
      const elapsedThisRun = secondsBetweenIso(runState.startedAt, nowIso());
      const accumulated = (runState.elapsedBeforePauseSec ?? 0) + elapsedThisRun;

      await hostSetViaServer("paused", clampIndex(runState.sectionIndex), accumulated, false);
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to pause.");
    }
  }, [clampIndex, hostSetViaServer, runState]);

  const hostResume = useCallback(async () => {
    if (runState.mode !== "paused") return;
    try {
      setRunErr("");
      await hostSetViaServer(
        "running",
        clampIndex(runState.sectionIndex),
        runState.elapsedBeforePauseSec ?? 0,
        false
      );
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to resume.");
    }
  }, [clampIndex, hostSetViaServer, runState]);

  const hostEnd = useCallback(async () => {
    try {
      setRunErr("");
      await hostSetViaServer(
        "ended",
        clampIndex(runState.sectionIndex),
        runState.elapsedBeforePauseSec ?? 0,
        false
      );
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to end session.");
    }
  }, [clampIndex, hostSetViaServer, runState]);

  const hostGoTo = useCallback(
    async (idx: number) => {
      const nextIndex = clampIndex(idx);

      if (runState.mode === "running") {
        await hostSetViaServer("running", nextIndex, 0, true);
        return;
      }
      if (runState.mode === "paused") {
        await hostSetViaServer("paused", nextIndex, 0, true);
        return;
      }
      await hostSetViaServer(runState.mode, nextIndex, 0, true);
    },
    [clampIndex, hostSetViaServer, runState.mode]
  );

  const autoAdvanceGuardRef = useRef(false);
  useEffect(() => {
    if (!isHost) return;
    if (!script?.sections?.length) return;
    if (runState.mode !== "running") return;

    if (secondsLeft > 0) {
      autoAdvanceGuardRef.current = false;
      return;
    }

    if (autoAdvanceGuardRef.current) return;
    autoAdvanceGuardRef.current = true;

    const nextIndex = hostSectionIdx + 1;
    if (nextIndex <= (script?.sections?.length ?? 1) - 1) {
      hostGoTo(nextIndex).catch(() => (autoAdvanceGuardRef.current = false));
    } else {
      hostEnd().catch(() => (autoAdvanceGuardRef.current = false));
    }
  }, [isHost, script, runState.mode, secondsLeft, hostSectionIdx, hostGoTo, hostEnd]);

  const handleSelectSection = useCallback(
    async (idx: number) => {
      if (!script?.sections?.length) return;
      if (isHost) {
        try {
          setRunErr("");
          await hostGoTo(idx);
        } catch (e: any) {
          setRunErr(e?.message ?? "Failed to change section.");
        }
        return;
      }
      setPreviewSectionIdx(idx);
    },
    [script, isHost, hostGoTo]
  );

  const handleFollowHost = useCallback(() => {
    setPreviewSectionIdx(null);
  }, []);

  const handlePrev = useCallback(async () => {
    if (!script?.sections?.length) return;
    if (isHost) {
      try {
        setRunErr("");
        await hostGoTo(hostSectionIdx - 1);
      } catch (e: any) {
        setRunErr(e?.message ?? "Failed to move to previous section.");
      }
      return;
    }
    setPreviewSectionIdx((cur) => {
      const base = cur === null ? hostSectionIdx : cur;
      return clampIndex(base - 1);
    });
  }, [script, isHost, hostGoTo, hostSectionIdx, clampIndex]);

  const handleNext = useCallback(async () => {
    if (!script?.sections?.length) return;
    if (isHost) {
      try {
        setRunErr("");
        await hostGoTo(hostSectionIdx + 1);
      } catch (e: any) {
        setRunErr(e?.message ?? "Failed to move to next section.");
      }
      return;
    }
    setPreviewSectionIdx((cur) => {
      const base = cur === null ? hostSectionIdx : cur;
      return clampIndex(base + 1);
    });
  }, [script, isHost, hostGoTo, hostSectionIdx, clampIndex]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("RootTabs");
  }, [navigation]);

  const handleShareEvent = useCallback(async () => {
    if (!event) return;

    const eventTitle = String((event as any).title ?? "Egregor Event");
    const intentionText = String((event as any).intention_statement ?? "").trim();
    const startLabel = (event as any).start_time_utc
      ? new Date((event as any).start_time_utc).toLocaleString()
      : "Unknown time";
    const tz = String((event as any).timezone ?? "UTC");

    const lines = [
      `Join me on Egregor: ${eventTitle}`,
      intentionText ? `Intention: ${intentionText}` : "",
      `Start: ${startLabel} (${tz})`,
      eventId ? `Event ID: ${eventId}` : "",
    ].filter(Boolean);

    try {
      await Share.share({ message: lines.join("\n") });
    } catch (e: any) {
      Alert.alert("Share failed", e?.message ?? "Could not open share sheet.");
    }
  }, [event, eventId]);

  if (!hasValidEventId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
        <View style={styles.center}>
          <Text style={styles.err}>Missing or invalid event id.</Text>
          <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={handleBack}>
            <Text style={[styles.btnGhostText, { color: c.text }]}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={[styles.meta, { color: c.textMuted }]}>Loading event room...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
        <View style={styles.center}>
          <Text style={styles.err}>Event not found.</Text>
          <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={handleBack}>
            <Text style={[styles.btnGhostText, { color: c.text }]}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const atLast = hasScript ? viewingSectionIdx >= script!.sections.length - 1 : true;
  const atFirst = viewingSectionIdx === 0;
  const pill = statusPillStyle(runState.mode);

  const renderPersonLine = (p: PresenceRow, kind: "active" | "recent") => {
    const seenSec = Math.max(0, Math.floor((Date.now() - safeTimeMs(p.last_seen_at)) / 1000));
    const joinedBase = p.joined_at ?? p.created_at;
    const joinedSec = joinedBase
      ? Math.max(0, Math.floor((Date.now() - safeTimeMs(joinedBase)) / 1000))
      : null;

    const isHostRow = hostId && p.user_id === hostId;
    const isMe = userId && p.user_id === userId;

    const badge = isHostRow ? "HOST" : isMe ? "YOU" : null;
    const isNew = joinedSec !== null && joinedSec <= 60;

    return (
      <Text key={`${kind}-${p.user_id}`} style={[styles.meta, { color: c.textMuted }]}>
        - {displayNameForUserId(p.user_id)}{" "}
        <Text style={{ color: c.primary }}>({shortId(p.user_id)})</Text>
        {badge ? <Text style={{ color: c.text }}>  [{badge}]</Text> : null}
        {isNew ? <Text style={{ color: "#6EE7B7" }}>  NEW</Text> : null}
        {"  "}- seen {formatAgo(seenSec)} ago
        {joinedSec !== null ? <Text> - first joined {formatAgo(joinedSec)} ago</Text> : null}
      </Text>
    );
  };

  const renderMsg = ({ item }: { item: EventMessageRow }) => {
    const messageId = String((item as any).id ?? "");
    const uid = String((item as any).user_id ?? "");
    const mine = !!userId && uid === userId;
    const name = uid ? displayNameForUserId(uid) : "Unknown";
    const ts = (item as any).created_at ? new Date((item as any).created_at).toLocaleTimeString() : "";
    const showUnreadMarker = !!unreadMarkerMessageId && messageId === unreadMarkerMessageId;

    return (
      <View>
        {showUnreadMarker ? (
          <View style={styles.unreadMarkerWrap}>
            <View style={styles.unreadMarkerLine} />
            <Text style={styles.unreadMarkerText}>Unread messages</Text>
            <View style={styles.unreadMarkerLine} />
          </View>
        ) : null}
        <View style={[styles.msgRow, mine ? styles.msgMine : styles.msgOther]}>
          <Text style={styles.msgMeta}>
            <Text style={{ color: c.text, fontWeight: "800" }}>{mine ? "You" : name}</Text>
            <Text style={{ color: c.textMuted }}> | {ts}</Text>
          </Text>
          <Text style={[styles.msgText, { color: c.text }]}>{String((item as any).body ?? "")}</Text>
        </View>
      </View>
    );
  };

  const Header = (
    <View style={styles.headerWrap}>
      <Text style={[styles.h1, { color: c.text }]}>{(event as any).title}</Text>

      <Text style={[styles.meta, { color: c.textMuted }]}>Host: <Text style={{ color: c.text, fontWeight: "800" }}>{hostName}</Text></Text>

      {!!(event as any).description && <Text style={[styles.body, { color: c.text }]}>{(event as any).description}</Text>}

      <Text style={[styles.body, { color: c.text }]}>Intention: {(event as any).intention_statement}</Text>

      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Attached Script</Text>
        <Text style={[styles.meta, { color: c.textMuted }]}>
          {(event as any).script_id
            ? scriptDbRow?.title
              ? scriptDbRow.title
              : (event as any).script_id
            : "(none)"}
        </Text>
      </View>

      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Attendees</Text>

        <Text style={[styles.meta, { color: c.textMuted }]}>Total: <Text style={{ fontWeight: "900", color: c.text }}>{presenceRows.length}</Text> | Active now:{" "}<Text style={{ fontWeight: "900", color: c.text }}>{activeCount}</Text></Text>

        <Text style={[styles.meta, { color: c.textMuted }]}>
          {(event as any).start_time_utc
            ? new Date((event as any).start_time_utc).toLocaleString()
            : "Unknown start"}
          {" -> "}
          {(event as any).end_time_utc
            ? new Date((event as any).end_time_utc).toLocaleString()
            : "Open ended"}{" "}
          ({(event as any).timezone ?? "UTC"})
        </Text>

        <View style={[styles.heartPulseWrap, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
          <Animated.View style={[styles.heartPulseBubble, { transform: [{ scale: heartScale }] }]}>
            <Text style={styles.heartPulseIcon}>Pulse</Text>
          </Animated.View>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Collective pulse intensity follows active participants in real time.
          </Text>
        </View>

        <View style={[styles.settingsRow, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsTitle, { color: c.text }]}>Auto-join live</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>Rejoin rooms automatically when you reopen them.</Text>
          </View>
          <Switch value={autoJoinGlobalEnabled} onValueChange={handleToggleAutoJoinGlobal} disabled={!autoJoinGlobalLoaded} />
        </View>

        {activePresence.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <Text style={[styles.meta, { marginBottom: 6, color: c.text }]}>Active now</Text>
            {activePresence.slice(0, 10).map((p) => renderPersonLine(p, "active"))}
            {activePresence.length > 10 ? (
              <Text style={styles.meta}>...and {activePresence.length - 10} more active</Text>
            ) : null}
          </View>
        ) : (
          <Text style={[styles.meta, { marginTop: 10 }]}>No one active right now.</Text>
        )}

        {recentPresence.length > 0 ? (
          <View style={{ marginTop: 12 }}>
            <Text style={[styles.meta, { marginBottom: 6, color: c.text }]}>Recently seen</Text>
            {recentPresence.slice(0, 10).map((p) => renderPersonLine(p, "recent"))}
            {recentPresence.length > 10 ? (
              <Text style={styles.meta}>...and {recentPresence.length - 10} more</Text>
            ) : null}
          </View>
        ) : totalAttendees > 0 ? (
          <Text style={[styles.meta, { marginTop: 12 }]}>Everyone here is currently active (or attendance is empty).</Text>
        ) : null}

        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, isJoined && styles.disabled]} onPress={handleJoinLive} disabled={isJoined}>
            <Text style={styles.btnText}>Join live</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }, !isJoined && styles.disabled]} onPress={handleLeaveLive} disabled={!isJoined}>
            <Text style={[styles.btnGhostText, { color: c.text }]}>Leave live</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={loadEventRoom}>
            <Text style={[styles.btnGhostText, { color: c.text }]}>Refresh</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={handleShareEvent}>
            <Text style={[styles.btnGhostText, { color: c.text }]}>Share</Text>
          </Pressable>
        </View>

        {!!presenceMsg && <Text style={styles.ok}>{presenceMsg}</Text>}
        {!!presenceErr && <Text style={styles.err}>{presenceErr}</Text>}
      </View>

      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Guided Flow</Text>

        {!script ? (
          <Text style={styles.meta}>No script attached to this event yet. Attach one from the Events screen.</Text>
        ) : (
          <>
            <Text style={styles.cardTitle}>{script.title}</Text>
            <Text style={styles.meta}>
              Tone: {script.tone} | Duration: {script.durationMinutes} min
            </Text>

            <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <View style={[styles.pill, { borderColor: pill.borderColor, backgroundColor: pill.backgroundColor }]}>
                <Text style={[styles.pillText, { color: pill.textColor }]}>{runReady ? runStatusLabel : "..."}</Text>
              </View>
              {isHost ? (
                <Text style={[styles.meta, { color: c.textMuted }]}>You are the host.</Text>
              ) : (
                <Text style={[styles.meta, { color: c.textMuted }]}>{viewingHostLive ? "Following host." : "Previewing (not following host)."}</Text>
              )}
            </View>

            {!isJoined ? (
              <View style={[styles.banner, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                <Text style={[styles.bannerTitle, { color: c.text }]}>
                  {autoJoinGlobalLoaded && joinPrefLoaded && autoJoinGlobalEnabled && shouldAutoJoinForEvent ? "Rejoining..." : "You are not live yet"}
                </Text>
                <Text style={[styles.meta, { color: c.textMuted }]}>Join live to appear in the room and be counted as active.</Text>
                <View style={[styles.row, { marginTop: 8 }]}>
                  <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }]} onPress={handleJoinLive}>
                    <Text style={styles.btnText}>Join live</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {!isHost && !viewingHostLive ? (
              <View style={[styles.banner, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                <Text style={[styles.bannerTitle, { color: c.text }]}>Preview mode</Text>
                <Text style={[styles.meta, { color: c.textMuted }]}>
                  You are reading a different section locally. Tap Follow host to return to the live section/timer.
                </Text>
                <View style={[styles.row, { marginTop: 8 }]}>
                  <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }]} onPress={handleFollowHost}>
                    <Text style={styles.btnText}>Follow host</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <View style={[styles.timerBox, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
              <Text style={[styles.timerLabel, { color: c.textMuted }]}>
                Section {viewingSectionIdx + 1} of {script.sections.length}
                {!isHost && !viewingHostLive ? " (preview)" : ""}
              </Text>
              <Text style={[styles.timerValue, { color: c.text }]}>{formatSeconds(secondsLeft)}</Text>
              <Text style={[styles.timerSub, { color: c.text }]}>{currentSection?.name ?? "Section"}</Text>

              <View style={styles.progressWrap}>
                <View style={styles.progressMetaRow}>
                  <Text style={[styles.progressLabel, { color: c.textMuted }]}>Section progress</Text>
                  <Text style={[styles.progressLabel, { color: c.textMuted }]}>{Math.round(sectionProgressPct * 100)}%</Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: c.background, borderColor: c.border }]}>
                  <View style={[styles.progressFill, { backgroundColor: c.primary, width: `${Math.max(0, Math.min(100, Math.round(sectionProgressPct * 100)))}%` }]} />
                </View>
              </View>

              <View style={styles.progressWrap}>
                <View style={styles.progressMetaRow}>
                  <Text style={[styles.progressLabel, { color: c.textMuted }]}>Overall flow</Text>
                  <Text style={[styles.progressLabel, { color: c.textMuted }]}>{Math.round(totalProgressPct * 100)}%</Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: c.background, borderColor: c.border }]}>
                  <View style={[styles.progressFill, { backgroundColor: c.primary, width: `${Math.max(0, Math.min(100, Math.round(totalProgressPct * 100)))}%` }]} />
                </View>
              </View>
            </View>

            {runState.mode === "ended" ? (
              <View style={[styles.sectionCard, { marginTop: 10, backgroundColor: c.cardAlt, borderColor: c.border }]}>
                <Text style={[styles.cardTitle, { color: c.text }]}>Session ended</Text>
                <Text style={[styles.meta, { color: c.textMuted }]}>
                  {isHost ? "You can restart the session when ready." : "Wait for the host to restart the session."}
                </Text>
                {isHost ? (
                  <View style={styles.row}>
                    <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, !hasScript && styles.disabled]} onPress={hostRestart} disabled={!hasScript}>
                      <Text style={styles.btnText}>Restart</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.sectionCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
              <Text style={[styles.cardTitle, { color: c.text }]}>{currentSection?.name}</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>{currentSection?.minutes ?? 0} min</Text>
              <Text style={[styles.body, { color: c.text }]}>{currentSection?.text ?? ""}</Text>
            </View>

            <View style={styles.row}>
              {isHost ? (
                <>
                  {(runState.mode === "idle" || runState.mode === "ended") && (
                    <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, !hasScript && styles.disabled]} onPress={hostStart} disabled={!hasScript}>
                      <Text style={styles.btnText}>Start</Text>
                    </Pressable>
                  )}

                  {runState.mode === "running" && (
                    <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={hostPause}>
                      <Text style={[styles.btnGhostText, { color: c.text }]}>Pause</Text>
                    </Pressable>
                  )}

                  {runState.mode === "paused" && (
                    <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }]} onPress={hostResume}>
                      <Text style={styles.btnText}>Resume</Text>
                    </Pressable>
                  )}
                </>
              ) : null}

              <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }, atFirst && styles.disabled]} onPress={handlePrev} disabled={atFirst}>
                <Text style={[styles.btnGhostText, { color: c.text }]}>Previous</Text>
              </Pressable>

              <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, atLast && styles.disabled]} onPress={handleNext} disabled={atLast}>
                <Text style={styles.btnText}>Next</Text>
              </Pressable>

              {isHost && runState.mode !== "ended" ? (
                <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={hostEnd}>
                  <Text style={[styles.btnGhostText, { color: c.text }]}>End</Text>
                </Pressable>
              ) : null}

              {!isHost && !viewingHostLive ? (
                <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={handleFollowHost}>
                  <Text style={[styles.btnGhostText, { color: c.text }]}>Follow host</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={{ marginTop: 10 }}>
              {script.sections.map((s, i) => {
                const isActive = i === viewingSectionIdx;
                return (
                  <Pressable
                    key={`${s.name}-${i}`}
                    onPress={() => handleSelectSection(i)}
                    style={[
                      styles.listItem,
                      { backgroundColor: c.cardAlt, borderColor: c.border },
                      isActive ? styles.listItemActive : undefined,
                      isActive ? { borderColor: c.primary, backgroundColor: c.card } : undefined,
                    ]}
                  >
                    <Text style={[styles.listTitle, { color: c.text }]}>
                      {i + 1}. {s.name}
                      {!isHost && i === hostSectionIdx ? " (host)" : ""}
                    </Text>
                    <Text style={[styles.meta, { color: c.textMuted }]}>{s.minutes} min</Text>
                  </Pressable>
                );
              })}
            </View>

            {!!script.speakerNotes && (
              <View style={[styles.sectionCard, { marginTop: 10, backgroundColor: c.cardAlt, borderColor: c.border }]}>
                <Text style={[styles.cardTitle, { color: c.text }]}>Speaker Notes</Text>
                <Text style={[styles.body, { color: c.text }]}>{script.speakerNotes}</Text>
              </View>
            )}

            {!!runErr && <Text style={styles.err}>{runErr}</Text>}
          </>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Chat</Text>
        <Text style={[styles.meta, { color: c.textMuted }]}>Messages are below. Use the box at the bottom to send.</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
      >
        <FlatList
          ref={chatListRef}
          data={messages}
          keyExtractor={(m) => String((m as any).id)}
          renderItem={renderMsg}
          refreshing={loading}
          onRefresh={loadEventRoom}
          ListHeaderComponent={Header}
          contentContainerStyle={styles.content}
          onContentSizeChange={(_, height) => {
            const previousHeight = chatContentHeightRef.current;
            chatContentHeightRef.current = height;

            if (shouldAutoScrollRef.current) {
              scrollChatToEnd(false);
              return;
            }

            if (previousHeight > 0 && height > previousHeight) {
              const delta = height - previousHeight;
              const nextOffset = Math.max(0, chatScrollOffsetYRef.current + delta);
              chatScrollOffsetYRef.current = nextOffset;
              try {
                chatListRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
              } catch {
                // ignore
              }
            }
          }}
          onScroll={onChatScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
        />

        <View style={[styles.chatComposerDock, { backgroundColor: c.background, borderTopColor: c.border }]}>
          {pendingMessageCount > 0 ? (
            <Pressable style={[styles.newMessagesBadge, { backgroundColor: c.primary, borderColor: c.primary }]} onPress={jumpToLatestMessages}>
              <Text style={styles.newMessagesBadgeText}>
                {pendingMessageCount === 1
                  ? "1 new message"
                  : `${pendingMessageCount} new messages`}
              </Text>
            </Pressable>
          ) : null}

          <View style={{ flex: 1 }}>
            <View style={styles.energyRow}>
              {ENERGY_GIFT_VALUES.map((amount) => (
                <Pressable
                  key={amount}
                  onPress={() => sendEnergyGift(amount)}
                  disabled={!!sendingEnergy}
                  style={[
                    styles.energyChip,
                    { borderColor: c.border, backgroundColor: c.cardAlt },
                    sendingEnergy === amount && { borderColor: c.primary },
                    !!sendingEnergy && styles.disabled,
                  ]}
                >
                  <Text style={[styles.energyChipText, { color: c.text }]}>
                    +{amount} energy
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={chatText}
              onChangeText={setChatText}
              style={[styles.chatInput, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              placeholder="Message..."
              placeholderTextColor={c.textMuted}
              maxLength={CHAT_MAX_CHARS}
              multiline
            />
            <Text style={[styles.chatCounter, { color: c.textMuted }, chatChars > CHAT_MAX_CHARS * 0.9 && styles.chatCounterWarn]}>
              {chatChars}/{CHAT_MAX_CHARS}
            </Text>
          </View>
          <Pressable
            onPress={sendMessage}
            disabled={sending || !chatText.trim()}
            style={[styles.chatSend, { backgroundColor: c.primary }, (sending || !chatText.trim()) && styles.disabled]}
          >
            <Text style={styles.btnText}>{sending ? "..." : "Send"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  content: { padding: 16, paddingBottom: 120 },

  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 10 },

  headerWrap: { paddingBottom: 10 },

  h1: { color: "white", fontSize: 28, fontWeight: "800", marginBottom: 10 },
  body: { color: "#D7E0FF", lineHeight: 20 },
  meta: { color: "#93A3D9", fontSize: 12 },

  section: {
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
    marginTop: 12,
  },
  sectionTitle: { color: "#DCE4FF", fontSize: 16, fontWeight: "700", marginBottom: 8 },

  row: { flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" },

  btn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 110,
  },
  btnPrimary: { backgroundColor: "#5B8CFF" },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3E4C78",
  },
  btnText: { color: "white", fontWeight: "700" },
  btnGhostText: { color: "#C8D3FF", fontWeight: "700" },
  disabled: { opacity: 0.45 },

  ok: { color: "#6EE7B7", marginTop: 8 },
  err: { color: "#FB7185", marginTop: 8 },

  timerBox: {
    marginTop: 10,
    backgroundColor: "#0E1428",
    borderWidth: 1,
    borderColor: "#2A365E",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
  },
  timerLabel: { color: "#9FB0E7", fontSize: 12 },
  timerValue: {
    color: "white",
    fontSize: 42,
    fontWeight: "800",
    marginVertical: 2,
    fontVariant: ["tabular-nums"],
  },
  timerSub: { color: "#D7E0FF", fontSize: 14, fontWeight: "600" },
  progressWrap: { width: "100%", marginTop: 8 },
  progressMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
  },
  progressLabel: { fontSize: 11, fontWeight: "700" },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2A365E",
    overflow: "hidden",
    backgroundColor: "#0B1020",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#5B8CFF",
  },

  sectionCard: {
    marginTop: 10,
    backgroundColor: "#121A31",
    borderWidth: 1,
    borderColor: "#27345C",
    borderRadius: 12,
    padding: 12,
  },
  cardTitle: { color: "white", fontSize: 16, fontWeight: "700", marginBottom: 4 },

  listItem: {
    backgroundColor: "#101833",
    borderWidth: 1,
    borderColor: "#26345F",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  listItemActive: {
    borderColor: "#6EA1FF",
    backgroundColor: "#1A2C5F",
  },
  listTitle: { color: "#E4EBFF", fontWeight: "700", marginBottom: 2 },

  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillText: { fontWeight: "800", fontSize: 12 },

  banner: {
    marginTop: 10,
    backgroundColor: "#0E1428",
    borderWidth: 1,
    borderColor: "#2A365E",
    borderRadius: 12,
    padding: 12,
  },
  bannerTitle: { color: "white", fontSize: 14, fontWeight: "800", marginBottom: 4 },

  settingsRow: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#27345C",
    borderRadius: 12,
    backgroundColor: "#121A31",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  settingsTitle: { color: "#E4EBFF", fontWeight: "800", marginBottom: 2 },
  heartPulseWrap: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#27345C",
    borderRadius: 12,
    backgroundColor: "#121A31",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heartPulseBubble: {
    width: 48,
    height: 30,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2A1220",
    borderWidth: 1,
    borderColor: "#FB7185",
  },
  heartPulseIcon: {
    color: "#FB7185",
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 12,
  },

  // Chat bubbles
  msgRow: {
    marginVertical: 6,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  msgMine: {
    alignSelf: "flex-end",
    backgroundColor: "#1A2C5F",
    borderColor: "#6EA1FF",
    maxWidth: "88%",
  },
  msgOther: {
    alignSelf: "flex-start",
    backgroundColor: "#121A31",
    borderColor: "#27345C",
    maxWidth: "88%",
  },
  msgMeta: { color: "#93A3D9", fontSize: 11, marginBottom: 4 },
  msgText: { color: "white", lineHeight: 18 },
  unreadMarkerWrap: {
    marginTop: 8,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  unreadMarkerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#36508F",
  },
  unreadMarkerText: {
    color: "#9DB6FF",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  // Docked composer (outside FlatList)
  chatComposerDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    paddingBottom: 14,
    backgroundColor: "#0B1020",
    borderTopWidth: 1,
    borderTopColor: "#243258",
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-end",
  },
  newMessagesBadge: {
    position: "absolute",
    top: -44,
    alignSelf: "center",
    backgroundColor: "#5B8CFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#6EA1FF",
  },
  newMessagesBadgeText: {
    color: "white",
    fontWeight: "800",
    fontSize: 12,
  },
  energyRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  energyChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  energyChipText: {
    fontSize: 11,
    fontWeight: "800",
  },
  chatInput: {
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: "#0E1428",
    borderWidth: 1,
    borderColor: "#2A365E",
    borderRadius: 10,
    color: "white",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chatCounter: {
    color: "#6B7BB2",
    fontSize: 11,
    textAlign: "right",
    marginTop: 4,
    paddingRight: 2,
  },
  chatCounterWarn: {
    color: "#FBBF24",
  },
  chatSend: {
    backgroundColor: "#5B8CFF",
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
  },
});






