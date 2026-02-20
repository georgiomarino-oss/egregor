import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../../supabase/client";
import type { Database } from "../../types/db";

type PresenceRow = Database["public"]["Tables"]["event_presence"]["Row"];

type UseEventRoomPresenceParams = {
  eventId: string;
  hasValidEventId: boolean;
  appState: AppStateStatus;
  tick: number;
  userId: string;
  activeEventIdRef: React.MutableRefObject<string>;
  ensureUserId: () => Promise<string>;
  loadProfiles: (ids: string[]) => void | Promise<void>;
  logTelemetry: (eventName: string, details?: Record<string, unknown>) => void;
};

const ACTIVE_WINDOW_MS = 90_000;
const HEARTBEAT_MS = 10_000;
const PRESENCE_RESYNC_MS = 60_000;
const KEY_AUTO_JOIN_GLOBAL = "prefs:autoJoinLive";

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

export function useEventRoomPresence({
  eventId,
  hasValidEventId,
  appState,
  tick,
  userId,
  activeEventIdRef,
  ensureUserId,
  loadProfiles,
  logTelemetry,
}: UseEventRoomPresenceParams) {
  const [presenceRows, setPresenceRows] = useState<PresenceRow[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [isJoiningLive, setIsJoiningLive] = useState(false);
  const [isLeavingLive, setIsLeavingLive] = useState(false);
  const [presenceMsg, setPresenceMsg] = useState("");
  const [presenceErr, setPresenceErr] = useState("");
  const [joinPrefLoaded, setJoinPrefLoaded] = useState(false);
  const [shouldAutoJoinForEvent, setShouldAutoJoinForEvent] = useState(false);
  const [autoJoinGlobalLoaded, setAutoJoinGlobalLoaded] = useState(false);
  const [autoJoinGlobalEnabled, setAutoJoinGlobalEnabled] = useState(true);

  useEffect(() => {
    setPresenceRows([]);
    setIsJoined(false);
    setIsJoiningLive(false);
    setIsLeavingLive(false);
    setPresenceMsg("");
    setPresenceErr("");
  }, [eventId]);

  const loadPresence = useCallback(
    async (reason = "manual") => {
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
      if (activeEventIdRef.current !== eventId) return;

      const rows = (data ?? []) as PresenceRow[];
      setPresenceRows(rows);
      void loadProfiles(rows.map((r) => r.user_id));
      logTelemetry("presence_resync_success", { reason, count: rows.length });
    },
    [eventId, hasValidEventId, activeEventIdRef, loadProfiles, logTelemetry]
  );

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
    let cancelled = false;
    setJoinPrefLoaded(false);
    setShouldAutoJoinForEvent(false);
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
          if (activeEventIdRef.current !== eventId) return;
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
  }, [eventId, hasValidEventId, activeEventIdRef, loadPresence, loadProfiles, logTelemetry]);

  useEffect(() => {
    if (isLeavingLive) {
      setIsJoined(false);
      return;
    }
    if (!userId) {
      setIsJoined(false);
      return;
    }
    const joined = presenceRows.some((r) => r.user_id === userId);
    setIsJoined((prev) => (prev === joined ? prev : joined));
  }, [presenceRows, userId, isLeavingLive]);

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

  useEffect(() => {
    let cancelled = false;

    if (!hasValidEventId) return;
    if (!autoJoinGlobalLoaded || !joinPrefLoaded) return;
    if (!autoJoinGlobalEnabled) return;
    if (isJoiningLive) return;
    if (!shouldAutoJoinForEvent) return;
    if (isLeavingLive) return;
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
    isJoiningLive,
    shouldAutoJoinForEvent,
    isLeavingLive,
    isJoined,
    loadPresence,
    upsertPresencePreserveJoinedAt,
    ensureUserId,
  ]);

  useEffect(() => {
    if (!isJoined) return;
    if (isLeavingLive) return;
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
  }, [isJoined, isLeavingLive, eventId, hasValidEventId, appState, userId, logTelemetry]);

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

  const handleJoinLive = useCallback(async () => {
    const targetEventId = eventId;
    const isStale = () => activeEventIdRef.current !== targetEventId;
    if (!hasValidEventId) {
      Alert.alert("Missing event", "This screen was opened without a valid event id.");
      return;
    }
    if (isJoiningLive || isLeavingLive) return;

    try {
      setIsJoiningLive(true);
      setPresenceErr("");
      setPresenceMsg("");

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      const uid = user?.id ?? (await ensureUserId());
      if (isStale()) return;

      if (error || !uid) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      await upsertPresencePreserveJoinedAt(uid);
      if (isStale()) return;

      setIsJoined(true);
      setPresenceMsg("You joined live.");
      await writeJoinPref(targetEventId, true);
      if (isStale()) return;
      setShouldAutoJoinForEvent(true);
      if (isStale()) return;
      await loadPresence();
    } catch (e: any) {
      if (!isStale()) setPresenceErr(e?.message ?? "Failed to join live.");
    } finally {
      if (!isStale()) setIsJoiningLive(false);
    }
  }, [
    eventId,
    hasValidEventId,
    activeEventIdRef,
    loadPresence,
    upsertPresencePreserveJoinedAt,
    ensureUserId,
    isJoiningLive,
    isLeavingLive,
  ]);

  const handleLeaveLive = useCallback(async () => {
    const targetEventId = eventId;
    const isStale = () => activeEventIdRef.current !== targetEventId;
    if (!hasValidEventId) return;
    if (isJoiningLive || isLeavingLive) return;
    const wasJoined = isJoined;

    try {
      setPresenceErr("");
      setPresenceMsg("Leaving live...");
      setIsLeavingLive(true);
      setIsJoined(false);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id ?? (await ensureUserId());
      if (isStale()) return;

      if (!uid) {
        setIsJoined(wasJoined);
        setPresenceErr("Not signed in.");
        return;
      }

      const { error } = await supabase
        .from("event_presence")
        .delete()
        .eq("event_id", targetEventId)
        .eq("user_id", uid);
      if (isStale()) return;

      if (error) {
        setIsJoined(wasJoined);
        setPresenceErr(error.message);
        return;
      }

      setPresenceMsg("You left live.");
      await writeJoinPref(targetEventId, false);
      if (isStale()) return;
      setShouldAutoJoinForEvent(false);
      if (isStale()) return;
      await loadPresence();
    } catch (e: any) {
      if (!isStale()) {
        setIsJoined(wasJoined);
        setPresenceErr(e?.message ?? "Failed to leave.");
      }
    } finally {
      if (!isStale()) setIsLeavingLive(false);
    }
  }, [
    eventId,
    hasValidEventId,
    activeEventIdRef,
    loadPresence,
    ensureUserId,
    isJoined,
    isJoiningLive,
    isLeavingLive,
  ]);

  const handleToggleAutoJoinGlobal = useCallback(async (next: boolean) => {
    setAutoJoinGlobalEnabled(next);
    await writeBool(KEY_AUTO_JOIN_GLOBAL, next);
  }, []);

  return {
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
  };
}

