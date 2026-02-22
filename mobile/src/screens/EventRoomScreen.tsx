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
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { supabase } from "../supabase/client";
import type { RootStackParamList } from "../types";
import type { Database } from "../types/db";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";

import type { EventRunMode } from "../features/events/runStateRepo";
import {
  CHAT_MAX_CHARS,
  ENERGY_GIFT_VALUES,
  useEventRoomChat,
} from "../features/events/useEventRoomChat";
import { useEventRoomPresence } from "../features/events/useEventRoomPresence";
import { useEventRoomRunState } from "../features/events/useEventRoomRunState";

type Props = NativeStackScreenProps<RootStackParamList, "EventRoom">;

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type ScriptDbRow = Database["public"]["Tables"]["scripts"]["Row"];
type PresenceRow = Database["public"]["Tables"]["event_presence"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type EventMessageRow = Database["public"]["Tables"]["event_messages"]["Row"];

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

type ProfileMini = Pick<ProfileRow, "id" | "display_name" | "avatar_url">;

export default function EventRoomScreen({ route, navigation }: Props) {
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const insets = useSafeAreaInsets();
  const eventId = route.params?.eventId ?? "";
  const hasValidEventId = !!eventId && isLikelyUuid(eventId);
  const activeEventIdRef = useRef(eventId);
  const roomLoadSeqRef = useRef(0);
  useEffect(() => {
    activeEventIdRef.current = eventId;
  }, [eventId]);

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<EventRow | null>(null);

  const [scriptDbRow, setScriptDbRow] = useState<
    Pick<ScriptDbRow, "id" | "title" | "content_json"> | null
  >(null);
  const [script, setScript] = useState<ScriptContent | null>(null);

  // Auth user
  const [userId, setUserId] = useState<string>("");
  const userIdRef = useRef("");
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);
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

  // Local ticker for UI countdown/presence "ago" labels
  const [tick, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasScript = !!script && !!script.sections?.length;

  const {
    runState,
    runReady,
    runErr,
    setRunErr,
    clampSectionIndex: clampIndex,
    loadRunState,
    hostStart,
    hostRestart,
    hostPause,
    hostResume,
    hostEnd,
    hostGoTo,
  } = useEventRoomRunState({
    eventId,
    hasValidEventId,
    sectionCount: script?.sections?.length ?? 0,
    activeEventIdRef,
    logTelemetry,
  });

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

  const loadScriptById = useCallback(async (scriptId: string | null, targetEventId?: string) => {
    const expectedEventId = targetEventId ?? activeEventIdRef.current;
    if (!scriptId) {
      if (activeEventIdRef.current !== expectedEventId) return;
      setScriptDbRow(null);
      setScript(null);
      return;
    }

    const { data: scData, error: scErr } = await supabase
      .from("scripts")
      .select("id,title,content_json")
      .eq("id", scriptId)
      .maybeSingle();

    if (activeEventIdRef.current !== expectedEventId) return;

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

  const {
    chatListRef,
    messages,
    chatText,
    setChatText,
    sending,
    sendingEnergy,
    pendingMessageCount,
    unreadMarkerMessageId,
    loadingEarlier,
    hasEarlierMessages,
    chatChars,
    loadMessages,
    loadEarlierMessages,
    sendMessage,
    sendEnergyGift,
    jumpToLatestMessages,
    onChatScroll,
    onChatContentSizeChange,
    resetForEventChange: resetChatForEventChange,
  } = useEventRoomChat({
    eventId,
    hasValidEventId,
    appState,
    activeEventIdRef,
    userIdRef,
    ensureUserId,
    loadProfiles,
    logTelemetry,
  });

  const {
    presenceRows,
    isJoined,
    isJoiningLive,
    isLeavingLive,
    presenceMsg,
    presenceErr,
    joinPrefLoaded,
    shouldAutoJoinForEvent,
    autoJoinGlobalLoaded,
    autoJoinGlobalEnabled,
    activePresence,
    recentPresence,
    activeCount,
    totalAttendees,
    loadPresence,
    handleJoinLive,
    handleLeaveLive,
    handleToggleAutoJoinGlobal,
  } = useEventRoomPresence({
    eventId,
    hasValidEventId,
    appState,
    tick,
    userId,
    activeEventIdRef,
    ensureUserId,
    loadProfiles,
    logTelemetry,
  });

  // ---- Load room ----
  const loadEventRoom = useCallback(async () => {
    const expectedEventId = eventId;
    const loadSeq = roomLoadSeqRef.current + 1;
    roomLoadSeqRef.current = loadSeq;
    const isStale = () =>
      roomLoadSeqRef.current !== loadSeq || activeEventIdRef.current !== expectedEventId;

    if (!hasValidEventId) {
      if (isStale()) return;
      setLoading(false);
      setEvent(null);
      setScript(null);
      setScriptDbRow(null);
      return;
    }

    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (isStale()) return;
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

      if (isStale()) return;
      if (evErr || !evData) {
        setLoading(false);
        setEvent(null);
        setScript(null);
        setScriptDbRow(null);
        Alert.alert("Event load failed", "This event is unavailable right now.");
        return;
      }

      const eventRow = evData as EventRow;
      setEvent(eventRow);

      const hostUserId = String((eventRow as any).host_user_id ?? "");
      void loadProfiles([hostUserId]);

      await Promise.all([
        loadPresence("room_load"),
        loadMessages("room_load"),
        loadScriptById((eventRow as any).script_id ?? null, expectedEventId),
        loadRunState("room_load"),
      ]);

      if (isStale()) return;
      setLoading(false);
      // initial scroll only once; assume user wants latest
      jumpToLatestMessages();
    } catch {
      if (isStale()) return;
      setLoading(false);
      Alert.alert("Load failed", "We couldn't load this event right now. Please try again.");
    }
  }, [
    eventId,
    hasValidEventId,
    loadPresence,
    loadMessages,
    loadScriptById,
    loadRunState,
    loadProfiles,
    jumpToLatestMessages,
  ]);

  useEffect(() => {
    loadEventRoom();
  }, [loadEventRoom]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppState(next);
    });
    return () => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    resetChatForEventChange();
    setRunErr("");
  }, [eventId, resetChatForEventChange]);

  useEffect(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (appState !== "active") return;
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [appState]);

  // Events row realtime
  useEffect(() => {
    if (!hasValidEventId) return;

    const channel = supabase
      .channel(`event:${eventId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${eventId}` },
        async (payload) => {
          if (activeEventIdRef.current !== eventId) return;
          const next = payload.new as Partial<EventRow> | null;
          const prev = payload.old as Partial<EventRow> | null;

          setEvent((cur) => {
            if (!cur) return cur;
            return { ...cur, ...(next as any) };
          });

          const nextScriptId = (next as any)?.script_id ?? null;
          const prevScriptId = (prev as any)?.script_id ?? null;
          if (nextScriptId !== prevScriptId) await loadScriptById(nextScriptId, eventId);

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
          if (activeEventIdRef.current !== eventId) return;
          const eventType = String((payload as any).eventType ?? "");
          if (eventType === "DELETE") {
            setScriptDbRow(null);
            setScript(null);
            return;
          }
          await loadScriptById(scriptId, eventId);
        }
      )
      .subscribe((status) => {
        logTelemetry("script_channel_status", { status, scriptId });
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, hasValidEventId, scriptDbRow?.id, loadScriptById, logTelemetry]);

  const heartScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (appState !== "active" || activeCount <= 0) {
      heartScale.stopAnimation();
      heartScale.setValue(1);
      return;
    }

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
  }, [activeCount, heartScale, appState]);

  const hostName = hostId ? displayNameForUserId(hostId) : "(unknown)";

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
        } catch {
          setRunErr("Couldn't change section right now. Please try again.");
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
      } catch {
        setRunErr("Couldn't move to the previous section right now.");
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
      } catch {
        setRunErr("Couldn't move to the next section right now.");
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
    } catch {
      Alert.alert("Share failed", "Could not open the share sheet right now.");
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
          <Pressable
            style={[
              styles.btn,
              styles.btnPrimary,
              { backgroundColor: c.primary },
              (isJoined || isJoiningLive || isLeavingLive) && styles.disabled,
            ]}
            onPress={handleJoinLive}
            disabled={isJoined || isJoiningLive || isLeavingLive}
          >
            <Text style={styles.btnText}>{isJoiningLive ? "Joining..." : "Join live"}</Text>
          </Pressable>

          <Pressable
            style={[
              styles.btn,
              styles.btnGhost,
              { borderColor: c.border },
              (!isJoined || isJoiningLive || isLeavingLive) && styles.disabled,
            ]}
            onPress={handleLeaveLive}
            disabled={!isJoined || isJoiningLive || isLeavingLive}
          >
            <Text style={[styles.btnGhostText, { color: c.text }]}>
              {isLeavingLive ? "Leaving..." : "Leave live"}
            </Text>
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
                  <Pressable
                    style={[
                      styles.btn,
                      styles.btnPrimary,
                      { backgroundColor: c.primary },
                      (isJoiningLive || isLeavingLive) && styles.disabled,
                    ]}
                    onPress={handleJoinLive}
                    disabled={isJoiningLive || isLeavingLive}
                  >
                    <Text style={styles.btnText}>{isJoiningLive ? "Joining..." : "Join live"}</Text>
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
        <View style={styles.row}>
          <Pressable
            style={[
              styles.btn,
              styles.btnGhost,
              { borderColor: c.border },
              (!hasEarlierMessages || loadingEarlier || messages.length === 0) && styles.disabled,
            ]}
            onPress={loadEarlierMessages}
            disabled={!hasEarlierMessages || loadingEarlier || messages.length === 0}
          >
            <Text style={[styles.btnGhostText, { color: c.text }]}>
              {loadingEarlier ? "Loading..." : hasEarlierMessages ? "Load earlier" : "No earlier messages"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
      >
        <FlatList
          ref={chatListRef}
          data={messages}
          keyExtractor={(m) => String((m as any).id)}
          renderItem={renderMsg}
          style={{ flex: 1 }}
          refreshing={loading}
          onRefresh={loadEventRoom}
          ListHeaderComponent={Header}
          contentContainerStyle={styles.content}
          onContentSizeChange={onChatContentSizeChange}
          onScroll={onChatScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        />

        <View
          style={[
            styles.chatComposerDock,
            {
              backgroundColor: c.background,
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, 10),
            },
          ]}
        >
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
              onFocus={jumpToLatestMessages}
              style={[styles.chatInput, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              placeholder="Message..."
              placeholderTextColor={c.textMuted}
              maxLength={CHAT_MAX_CHARS}
              multiline
              textAlignVertical="top"
              blurOnSubmit={false}
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
  content: { padding: 16, paddingBottom: 16 },

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
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
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






