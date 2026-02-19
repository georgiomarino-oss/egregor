import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase/client";
import type { RootStackParamList } from "../types";
import type { Database } from "../types/db";

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
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
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

export default function EventRoomScreen({ route, navigation }: Props) {
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

  // Profiles cache for presence display (STATE for UI)
  const [profilesById, setProfilesById] = useState<Record<string, ProfileMini>>({});
  // Ref cache to avoid dependency loops
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

  // Local ticker for UI countdown refresh
  const [tick, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isHost = useMemo(() => {
    const hostId = (event as any)?.host_user_id as string | null;
    if (!userId || !hostId) return false;
    return userId === hostId;
  }, [userId, event]);

  const hasScript = !!script && !!script.sections?.length;

  // Attendee preview
  const [previewSectionIdx, setPreviewSectionIdx] = useState<number | null>(null);

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

  const runStatusLabel = useMemo(() => {
    if (!runReady) return "…";
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

  const loadProfiles = useCallback(async (ids: string[]) => {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (uniq.length === 0) return;

    // Use REF cache to avoid dependency loops.
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

  const loadPresence = useCallback(async () => {
    if (!hasValidEventId) {
      setPresenceRows([]);
      return;
    }

    const { data, error } = await supabase
      .from("event_presence")
      .select("event_id,user_id,joined_at,last_seen_at,created_at")
      .eq("event_id", eventId);

    if (error) return;

    const rows = (data ?? []) as PresenceRow[];
    setPresenceRows(rows);

    // Fetch profiles for all present users (async, non-blocking)
    void loadProfiles(rows.map((r) => r.user_id));
  }, [eventId, hasValidEventId, loadProfiles]);

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

  const loadEventRoom = useCallback(async () => {
    if (!hasValidEventId) {
      setLoading(false);
      setEvent(null);
      setScript(null);
      setScriptDbRow(null);
      setPresenceRows([]);
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

      // Ensure host profile is available even if host isn't present
      void loadProfiles([String((eventRow as any).host_user_id ?? "")]);

      await Promise.all([
        loadPresence(),
        loadScriptById((eventRow as any).script_id ?? null),
        (async () => {
          const row = await ensureRunState(eventId);
          setRunState(normalizeRunState(row.state));
          setRunReady(true);
        })(),
      ]);

      setLoading(false);
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Load failed", e?.message ?? "Unknown error");
    }
  }, [eventId, hasValidEventId, loadPresence, loadScriptById, loadProfiles]);

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

          if (nextScriptId !== prevScriptId) {
            await loadScriptById(nextScriptId);
          }

          const nextHostId = String((next as any)?.host_user_id ?? "");
          const prevHostId = String((prev as any)?.host_user_id ?? "");
          if (nextHostId && nextHostId !== prevHostId) {
            void loadProfiles([nextHostId]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, hasValidEventId, loadScriptById, loadProfiles]);

  // Run state realtime
  useEffect(() => {
    if (!hasValidEventId) return;

    const sub = subscribeRunState(eventId, (row) => {
      setRunState(normalizeRunState(row.state));
      setRunReady(true);
    });

    return () => sub.unsubscribe();
  }, [eventId, hasValidEventId]);

  // Presence realtime
  useEffect(() => {
    if (!hasValidEventId) return;

    const channel = supabase
      .channel(`presence:${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_presence", filter: `event_id=eq.${eventId}` },
        () => loadPresence()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, hasValidEventId, loadPresence]);

  // Auto-join if:
  // - global setting enabled
  // - per-event sticky join enabled
  // - not already joined
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

        if (!user || cancelled) return;

        const now = new Date().toISOString();
        const { error: upErr } = await supabase.from("event_presence").upsert(
          { event_id: eventId, user_id: user.id, last_seen_at: now, created_at: now },
          { onConflict: "event_id,user_id" }
        );

        if (cancelled) return;

        if (upErr) {
          setPresenceErr(upErr.message);
          return;
        }

        setIsJoined(true);
        setPresenceMsg("✅ You joined live.");
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
  ]);

  // Heartbeat while joined
  useEffect(() => {
    if (!isJoined) return;
    if (!hasValidEventId) return;

    let cancelled = false;

    const beat = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const now = new Date().toISOString();

      const { error } = await supabase.from("event_presence").upsert(
        { event_id: eventId, user_id: user.id, last_seen_at: now, created_at: now },
        { onConflict: "event_id,user_id" }
      );

      if (error && !cancelled) setPresenceErr(error.message);
    };

    beat();
    const id = setInterval(beat, 10_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isJoined, eventId, hasValidEventId]);

  // Compute active users: last_seen_at within 25 seconds
  const activeWindowMs = 25_000;

  const presenceSorted = useMemo(() => {
    const rows = [...presenceRows];
    rows.sort((a, b) => {
      const ta = new Date(a.last_seen_at).getTime();
      const tb = new Date(b.last_seen_at).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    return rows;
  }, [presenceRows]);

  const activePresence = useMemo(() => {
    const now = Date.now();
    return presenceSorted.filter((r) => {
      const t = new Date(r.last_seen_at).getTime();
      return Number.isFinite(t) && now - t <= activeWindowMs;
    });
  }, [presenceSorted]);

  const activeCount = activePresence.length;
  const totalAttendees = presenceRows.length;

  const recentPresence = useMemo(() => {
    const now = Date.now();
    // Exclude active now to avoid duplication
    return presenceSorted.filter((r) => {
      const t = new Date(r.last_seen_at).getTime();
      if (!Number.isFinite(t)) return false;
      return now - t > activeWindowMs;
    });
  }, [presenceSorted]);

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

      if (error || !user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      const now = new Date().toISOString();

      const { error: upErr } = await supabase.from("event_presence").upsert(
        { event_id: eventId, user_id: user.id, last_seen_at: now, created_at: now },
        { onConflict: "event_id,user_id" }
      );

      if (upErr) {
        setPresenceErr(upErr.message);
        return;
      }

      setIsJoined(true);
      setPresenceMsg("✅ You joined live.");
      await writeJoinPref(eventId, true);
      setShouldAutoJoinForEvent(true);
      await loadPresence();
    } catch (e: any) {
      setPresenceErr(e?.message ?? "Failed to join live.");
    }
  }, [eventId, hasValidEventId, loadPresence]);

  const handleLeaveLive = useCallback(async () => {
    if (!hasValidEventId) return;

    try {
      setPresenceErr("");
      setPresenceMsg("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setPresenceErr("Not signed in.");
        return;
      }

      const { error } = await supabase
        .from("event_presence")
        .delete()
        .eq("event_id", eventId)
        .eq("user_id", user.id);

      if (error) {
        setPresenceErr(error.message);
        return;
      }

      setIsJoined(false);
      setPresenceMsg("✅ You left live.");
      await writeJoinPref(eventId, false);
      setShouldAutoJoinForEvent(false);
      await loadPresence();
    } catch (e: any) {
      setPresenceErr(e?.message ?? "Failed to leave.");
    }
  }, [eventId, hasValidEventId, loadPresence]);

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
    const idx = clampIndex(runState.sectionIndex ?? 0);
    await hostSetViaServer("running", idx, 0, true);
  }, [clampIndex, hostSetViaServer, runState.sectionIndex]);

  const hostRestart = useCallback(async () => {
    const idx = clampIndex(runState.sectionIndex ?? 0);
    await hostSetViaServer("running", idx, 0, true);
  }, [clampIndex, hostSetViaServer, runState.sectionIndex]);

  const hostPause = useCallback(async () => {
    if (runState.mode !== "running" || !runState.startedAt) return;

    const elapsedThisRun = secondsBetweenIso(runState.startedAt, nowIso());
    const accumulated = (runState.elapsedBeforePauseSec ?? 0) + elapsedThisRun;

    await hostSetViaServer("paused", clampIndex(runState.sectionIndex), accumulated, false);
  }, [clampIndex, hostSetViaServer, runState]);

  const hostResume = useCallback(async () => {
    if (runState.mode !== "paused") return;
    await hostSetViaServer(
      "running",
      clampIndex(runState.sectionIndex),
      runState.elapsedBeforePauseSec ?? 0,
      false
    );
  }, [clampIndex, hostSetViaServer, runState]);

  const hostEnd = useCallback(async () => {
    await hostSetViaServer(
      "ended",
      clampIndex(runState.sectionIndex),
      runState.elapsedBeforePauseSec ?? 0,
      false
    );
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
        await hostGoTo(idx);
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
      await hostGoTo(hostSectionIdx - 1);
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
      await hostGoTo(hostSectionIdx + 1);
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

  if (!hasValidEventId) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <Text style={styles.err}>Missing or invalid event id.</Text>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={handleBack}>
            <Text style={styles.btnGhostText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.meta}>Loading event room…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <Text style={styles.err}>Event not found.</Text>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={handleBack}>
            <Text style={styles.btnGhostText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const atLast = hasScript ? viewingSectionIdx >= script!.sections.length - 1 : true;
  const atFirst = viewingSectionIdx === 0;
  const pill = statusPillStyle(runState.mode);

  const hostId = String((event as any).host_user_id ?? "");
  const hostName = hostId ? displayNameForUserId(hostId) : "(unknown)";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>{(event as any).title}</Text>

        <Text style={styles.meta}>
          Host: <Text style={{ color: "white", fontWeight: "800" }}>{hostName}</Text>
        </Text>

        {!!(event as any).description && (
          <Text style={styles.body}>{(event as any).description}</Text>
        )}

        <Text style={styles.body}>Intention: {(event as any).intention_statement}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attached Script</Text>
          <Text style={styles.meta}>
            {(event as any).script_id
              ? scriptDbRow?.title
                ? scriptDbRow.title
                : (event as any).script_id
              : "(none)"}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attendees</Text>

          <Text style={styles.meta}>
            Total:{" "}
            <Text style={{ fontWeight: "900", color: "white" }}>{totalAttendees}</Text> • Active now:{" "}
            <Text style={{ fontWeight: "900", color: "white" }}>{activeCount}</Text>
          </Text>

          <Text style={styles.meta}>
            {new Date((event as any).start_time_utc).toLocaleString()} →{" "}
            {new Date((event as any).end_time_utc).toLocaleString()} (
            {(event as any).timezone ?? "UTC"})
          </Text>

          <View style={styles.settingsRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsTitle}>Auto-join live</Text>
              <Text style={styles.meta}>Rejoin rooms automatically when you reopen them.</Text>
            </View>
            <Switch
              value={autoJoinGlobalEnabled}
              onValueChange={handleToggleAutoJoinGlobal}
              disabled={!autoJoinGlobalLoaded}
            />
          </View>

          {/* Active now */}
          {activePresence.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              <Text style={[styles.meta, { marginBottom: 6, color: "#C8D3FF" }]}>
                Active now
              </Text>

              {activePresence.slice(0, 10).map((p) => {
                const secondsAgo = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(p.last_seen_at).getTime()) / 1000)
                );
                return (
                  <Text key={`active-${p.user_id}`} style={styles.meta}>
                    • {displayNameForUserId(p.user_id)}{" "}
                    <Text style={{ color: "#5B8CFF" }}>({shortId(p.user_id)})</Text> • seen{" "}
                    {formatAgo(secondsAgo)} ago
                  </Text>
                );
              })}

              {activePresence.length > 10 ? (
                <Text style={styles.meta}>…and {activePresence.length - 10} more active</Text>
              ) : null}
            </View>
          ) : (
            <Text style={[styles.meta, { marginTop: 10 }]}>No one active right now.</Text>
          )}

          {/* Recently seen */}
          {recentPresence.length > 0 ? (
            <View style={{ marginTop: 12 }}>
              <Text style={[styles.meta, { marginBottom: 6, color: "#C8D3FF" }]}>
                Recently seen
              </Text>

              {recentPresence.slice(0, 10).map((p) => {
                const secondsAgo = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(p.last_seen_at).getTime()) / 1000)
                );

                return (
                  <Text key={`recent-${p.user_id}`} style={styles.meta}>
                    • {displayNameForUserId(p.user_id)}{" "}
                    <Text style={{ color: "#5B8CFF" }}>({shortId(p.user_id)})</Text> • seen{" "}
                    {formatAgo(secondsAgo)} ago
                  </Text>
                );
              })}

              {recentPresence.length > 10 ? (
                <Text style={styles.meta}>…and {recentPresence.length - 10} more</Text>
              ) : null}
            </View>
          ) : totalAttendees > 0 ? (
            <Text style={[styles.meta, { marginTop: 12 }]}>
              Everyone here is currently active (or attendance is empty).
            </Text>
          ) : null}

          <View style={styles.row}>
            <Pressable
              style={[styles.btn, styles.btnPrimary, isJoined && styles.disabled]}
              onPress={handleJoinLive}
              disabled={isJoined}
            >
              <Text style={styles.btnText}>Join live</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.btnGhost, !isJoined && styles.disabled]}
              onPress={handleLeaveLive}
              disabled={!isJoined}
            >
              <Text style={styles.btnGhostText}>Leave live</Text>
            </Pressable>

            <Pressable style={[styles.btn, styles.btnGhost]} onPress={loadEventRoom}>
              <Text style={styles.btnGhostText}>Refresh</Text>
            </Pressable>
          </View>

          {!!presenceMsg && <Text style={styles.ok}>{presenceMsg}</Text>}
          {!!presenceErr && <Text style={styles.err}>{presenceErr}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Guided Flow</Text>

          {!script ? (
            <Text style={styles.meta}>
              No script attached to this event yet. Attach one from the Events screen.
            </Text>
          ) : (
            <>
              <Text style={styles.cardTitle}>{script.title}</Text>
              <Text style={styles.meta}>
                Tone: {script.tone} | Duration: {script.durationMinutes} min
              </Text>

              <View
                style={{
                  marginTop: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <View
                  style={[
                    styles.pill,
                    { borderColor: pill.borderColor, backgroundColor: pill.backgroundColor },
                  ]}
                >
                  <Text style={[styles.pillText, { color: pill.textColor }]}>
                    {runReady ? runStatusLabel : "…"}
                  </Text>
                </View>
                {isHost ? (
                  <Text style={styles.meta}>You are the host.</Text>
                ) : (
                  <Text style={styles.meta}>
                    {viewingHostLive ? "Following host." : "Previewing (not following host)."}
                  </Text>
                )}
              </View>

              {!isJoined ? (
                <View style={styles.banner}>
                  <Text style={styles.bannerTitle}>
                    {autoJoinGlobalLoaded &&
                    joinPrefLoaded &&
                    autoJoinGlobalEnabled &&
                    shouldAutoJoinForEvent
                      ? "Rejoining…"
                      : "You’re not live yet"}
                  </Text>
                  <Text style={styles.meta}>
                    Join live to appear in the room and be counted as active.
                  </Text>
                  <View style={[styles.row, { marginTop: 8 }]}>
                    <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleJoinLive}>
                      <Text style={styles.btnText}>Join live</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {!isHost && !viewingHostLive ? (
                <View style={styles.banner}>
                  <Text style={styles.bannerTitle}>Preview mode</Text>
                  <Text style={styles.meta}>
                    You’re reading a different section locally. Tap “Follow host” to return to the
                    live section/timer.
                  </Text>
                  <View style={[styles.row, { marginTop: 8 }]}>
                    <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleFollowHost}>
                      <Text style={styles.btnText}>Follow host</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View style={styles.timerBox}>
                <Text style={styles.timerLabel}>
                  Section {viewingSectionIdx + 1} of {script.sections.length}
                  {!isHost && !viewingHostLive ? " (preview)" : ""}
                </Text>
                <Text style={styles.timerValue}>{formatSeconds(secondsLeft)}</Text>
                <Text style={styles.timerSub}>{currentSection?.name ?? "Section"}</Text>
              </View>

              {runState.mode === "ended" ? (
                <View style={[styles.sectionCard, { marginTop: 10 }]}>
                  <Text style={styles.cardTitle}>Session ended</Text>
                  <Text style={styles.meta}>
                    {isHost
                      ? "You can restart the session when ready."
                      : "Wait for the host to restart the session."}
                  </Text>
                  {isHost ? (
                    <View style={styles.row}>
                      <Pressable
                        style={[styles.btn, styles.btnPrimary, !hasScript && styles.disabled]}
                        onPress={hostRestart}
                        disabled={!hasScript}
                      >
                        <Text style={styles.btnText}>Restart</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>{currentSection?.name}</Text>
                <Text style={styles.meta}>{currentSection?.minutes ?? 0} min</Text>
                <Text style={styles.body}>{currentSection?.text ?? ""}</Text>
              </View>

              <View style={styles.row}>
                {isHost ? (
                  <>
                    {(runState.mode === "idle" || runState.mode === "ended") && (
                      <Pressable
                        style={[styles.btn, styles.btnPrimary, !hasScript && styles.disabled]}
                        onPress={hostStart}
                        disabled={!hasScript}
                      >
                        <Text style={styles.btnText}>Start</Text>
                      </Pressable>
                    )}

                    {runState.mode === "running" && (
                      <Pressable style={[styles.btn, styles.btnGhost]} onPress={hostPause}>
                        <Text style={styles.btnGhostText}>Pause</Text>
                      </Pressable>
                    )}

                    {runState.mode === "paused" && (
                      <Pressable style={[styles.btn, styles.btnPrimary]} onPress={hostResume}>
                        <Text style={styles.btnText}>Resume</Text>
                      </Pressable>
                    )}
                  </>
                ) : null}

                <Pressable
                  style={[styles.btn, styles.btnGhost, atFirst && styles.disabled]}
                  onPress={handlePrev}
                  disabled={atFirst}
                >
                  <Text style={styles.btnGhostText}>Previous</Text>
                </Pressable>

                <Pressable
                  style={[styles.btn, styles.btnPrimary, atLast && styles.disabled]}
                  onPress={handleNext}
                  disabled={atLast}
                >
                  <Text style={styles.btnText}>Next</Text>
                </Pressable>

                {isHost && runState.mode !== "ended" ? (
                  <Pressable style={[styles.btn, styles.btnGhost]} onPress={hostEnd}>
                    <Text style={styles.btnGhostText}>End</Text>
                  </Pressable>
                ) : null}

                {!isHost && !viewingHostLive ? (
                  <Pressable style={[styles.btn, styles.btnGhost]} onPress={handleFollowHost}>
                    <Text style={styles.btnGhostText}>Follow host</Text>
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
                      style={[styles.listItem, isActive ? styles.listItemActive : undefined]}
                    >
                      <Text style={styles.listTitle}>
                        {i + 1}. {s.name}
                        {!isHost && i === hostSectionIdx ? " (host)" : ""}
                      </Text>
                      <Text style={styles.meta}>{s.minutes} min</Text>
                    </Pressable>
                  );
                })}
              </View>

              {!!script.speakerNotes && (
                <View style={[styles.sectionCard, { marginTop: 10 }]}>
                  <Text style={styles.cardTitle}>Speaker Notes</Text>
                  <Text style={styles.body}>{script.speakerNotes}</Text>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  content: { padding: 16, paddingBottom: 28 },

  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 10 },

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
});
