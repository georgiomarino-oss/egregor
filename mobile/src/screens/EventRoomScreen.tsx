// mobile/src/screens/EventRoomScreen.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../types/navigation";
import { supabase } from "../supabase/client";

import {
  ensureRunState,
  normalizeRunState,
  subscribeRunState,
  upsertRunState,
  type EventRunStateV1,
  type EventRunMode,
} from "../features/events/runStateRepo";

// If you already have a presence repo, you can swap these helper functions to your existing ones.
// This file keeps presence behavior exactly as you described: upsert on join + heartbeat, and active list by last_seen_at.
type PresenceRow = {
  event_id: string;
  user_id: string;
  joined_at: string | null;
  last_seen_at: string;
  created_at: string;
};

type ScriptRow = {
  id: string;
  title: string;
  intention: string | null;
  content_json: any;
  author_user_id: string;
  created_at: string;
};

type EventRow = {
  id: string;
  title?: string | null;
  script_id: string | null;
  host_user_id: string | null;
  created_by: string | null;
  start_time_utc?: string | null;
  end_time_utc?: string | null;
};

type Section = {
  title: string;
  body?: string;
  timer_seconds?: number; // optional
};

type Props = NativeStackScreenProps<RootStackParamList, "EventRoom">;

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function nowIso(): string {
  return new Date().toISOString();
}

function secondsBetweenIso(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 1000));
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export default function EventRoomScreen({ navigation, route }: Props) {
  const eventIdParam = (route.params as any)?.eventId;

  const [loading, setLoading] = useState(true);
  const [eventRow, setEventRow] = useState<EventRow | null>(null);
  const [scriptRow, setScriptRow] = useState<ScriptRow | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  // Presence
  const [joinedLive, setJoinedLive] = useState(false);
  const [activePresence, setActivePresence] = useState<PresenceRow[]>([]);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  // Run state
  const [runState, setRunState] = useState<EventRunStateV1>({ version: 1, mode: "idle", sectionIndex: 0 });
  const [runStateReady, setRunStateReady] = useState(false);

  // Local ticking (to update countdown display)
  const [tick, setTick] = useState(0);
  const localTickRef = useRef<NodeJS.Timeout | null>(null);

  const eventId = useMemo(() => (isUuid(eventIdParam) ? eventIdParam : null), [eventIdParam]);

  const hostId = useMemo(() => {
    if (!eventRow) return null;
    return (eventRow.host_user_id || eventRow.created_by) ?? null;
  }, [eventRow]);

  const isHost = useMemo(() => {
    if (!userId || !hostId) return false;
    return userId === hostId;
  }, [userId, hostId]);

  const sections: Section[] = useMemo(() => {
    const json = scriptRow?.content_json;
    const raw = json?.sections;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s: any) => {
        const title = typeof s?.title === "string" ? s.title : "Untitled";
        const body = typeof s?.body === "string" ? s.body : undefined;
        const timer_seconds =
          Number.isFinite(s?.timer_seconds) ? Math.max(0, Math.floor(s.timer_seconds)) : undefined;
        return { title, body, timer_seconds };
      })
      .filter((s) => !!s.title);
  }, [scriptRow]);

  const currentSection = useMemo(() => {
    if (!sections.length) return null;
    const idx = Math.min(Math.max(0, runState.sectionIndex), sections.length - 1);
    return { section: sections[idx], index: idx };
  }, [sections, runState.sectionIndex]);

  const timerInfo = useMemo(() => {
    const s = currentSection?.section;
    const duration = s?.timer_seconds ?? 0;
    const mode: EventRunMode = runState.mode;

    if (!s || duration <= 0) {
      return { hasTimer: false, durationSec: 0, remainingSec: 0, elapsedSec: 0 };
    }

    // Compute elapsed based on host timestamps
    let elapsed = 0;

    if (mode === "running" && runState.startedAt) {
      elapsed = secondsBetweenIso(runState.startedAt, nowIso());
      if (runState.elapsedBeforePauseSec) elapsed += runState.elapsedBeforePauseSec;
    } else if (mode === "paused") {
      // When paused, freeze elapsed at elapsedBeforePauseSec (host computed on pause)
      elapsed = runState.elapsedBeforePauseSec ?? 0;
    } else {
      elapsed = runState.elapsedBeforePauseSec ?? 0;
    }

    const remaining = Math.max(0, duration - elapsed);

    return {
      hasTimer: true,
      durationSec: duration,
      remainingSec: remaining,
      elapsedSec: elapsed,
    };
  }, [currentSection, runState, tick]);

  const load = useCallback(async () => {
    if (!eventId) {
      Alert.alert("Invalid event", "Missing or invalid event id.", [
        {
          text: "OK",
          onPress: () => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate("RootTabs" as any);
          },
        },
      ]);
      return;
    }

    setLoading(true);
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      setUserId(user?.id ?? null);

      const { data: eventData, error: eventErr } = await supabase
        .from("events")
        .select("id, title, script_id, host_user_id, created_by, start_time_utc, end_time_utc")
        .eq("id", eventId)
        .single();

      if (eventErr) throw eventErr;
      setEventRow(eventData as EventRow);

      let script: ScriptRow | null = null;
      if (eventData?.script_id) {
        const { data: scriptData, error: scriptErr } = await supabase
          .from("scripts")
          .select("id, title, intention, content_json, author_user_id, created_at")
          .eq("id", eventData.script_id)
          .single();
        if (scriptErr) throw scriptErr;
        script = scriptData as ScriptRow;
      }
      setScriptRow(script);

      // Ensure run state exists + subscribe
      const row = await ensureRunState(eventId);
      setRunState(normalizeRunState(row.state));
      setRunStateReady(true);
    } catch (e: any) {
      console.error(e);
      Alert.alert("Failed to load room", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [eventId, navigation]);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Subscribe run state changes
  useEffect(() => {
    if (!eventId) return;

    const sub = subscribeRunState(eventId, (row) => {
      setRunState(normalizeRunState(row.state));
      setRunStateReady(true);
    });

    return () => sub.unsubscribe();
  }, [eventId]);

  // Local ticking for countdown display
  useEffect(() => {
    if (localTickRef.current) clearInterval(localTickRef.current);
    localTickRef.current = setInterval(() => setTick((t) => t + 1), 500);
    return () => {
      if (localTickRef.current) clearInterval(localTickRef.current);
      localTickRef.current = null;
    };
  }, []);

  // Presence helpers
  const upsertPresence = useCallback(
    async (forceJoinedAt: boolean) => {
      if (!eventId || !userId) return;

      const payload: Partial<PresenceRow> & { event_id: string; user_id: string; last_seen_at: string } = {
        event_id: eventId,
        user_id: userId,
        last_seen_at: nowIso(),
      };
      if (forceJoinedAt) payload.joined_at = nowIso();

      const { error } = await supabase
        .from("event_presence")
        .upsert(payload, { onConflict: "event_id,user_id" });

      if (error) throw error;
    },
    [eventId, userId]
  );

  const refreshPresence = useCallback(async () => {
    if (!eventId) return;

    // Active = last_seen_at within 25s
    const cutoff = new Date(Date.now() - 25_000).toISOString();

    const { data, error } = await supabase
      .from("event_presence")
      .select("event_id, user_id, joined_at, last_seen_at, created_at")
      .eq("event_id", eventId)
      .gte("last_seen_at", cutoff)
      .order("last_seen_at", { ascending: false });

    if (error) throw error;
    setActivePresence((data ?? []) as PresenceRow[]);
  }, [eventId]);

  // Subscribe presence changes for this event
  useEffect(() => {
    if (!eventId) return;

    const channel = supabase
      .channel(`event_presence:${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_presence", filter: `event_id=eq.${eventId}` },
        () => {
          // Cheap + reliable: refetch active list
          refreshPresence().catch((e) => console.error("refreshPresence error", e));
        }
      )
      .subscribe();

    // initial list
    refreshPresence().catch(() => undefined);

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, refreshPresence]);

  const joinLive = useCallback(async () => {
    try {
      if (!userId) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }
      setJoinedLive(true);
      await upsertPresence(true);
      await refreshPresence();

      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        upsertPresence(false).catch((e) => console.error("heartbeat error", e));
      }, 10_000);
    } catch (e: any) {
      console.error(e);
      setJoinedLive(false);
      Alert.alert("Failed to join live", e?.message ?? "Unknown error");
    }
  }, [userId, upsertPresence, refreshPresence]);

  const leaveLive = useCallback(() => {
    setJoinedLive(false);
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      // cleanup on unmount
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    };
  }, []);

  // Host controls
  const hostSetState = useCallback(
    async (next: EventRunStateV1) => {
      if (!eventId) return;
      try {
        await upsertRunState(eventId, next);
        // optimistic (subscription will also update)
        setRunState(next);
      } catch (e: any) {
        console.error(e);
        Alert.alert("Failed to update session", e?.message ?? "Unknown error");
      }
    },
    [eventId]
  );

  const clampSectionIndex = useCallback(
    (idx: number) => {
      if (!sections.length) return 0;
      return Math.min(Math.max(0, idx), sections.length - 1);
    },
    [sections.length]
  );

  const hostStart = useCallback(async () => {
    const idx = clampSectionIndex(runState.sectionIndex ?? 0);
    const next: EventRunStateV1 = {
      version: 1,
      mode: "running",
      sectionIndex: idx,
      startedAt: nowIso(),
      elapsedBeforePauseSec: 0,
    };
    await hostSetState(next);
  }, [clampSectionIndex, hostSetState, runState.sectionIndex]);

  const hostPause = useCallback(async () => {
    if (runState.mode !== "running" || !runState.startedAt) return;
    const elapsedThisRun = secondsBetweenIso(runState.startedAt, nowIso());
    const accumulated = (runState.elapsedBeforePauseSec ?? 0) + elapsedThisRun;

    const next: EventRunStateV1 = {
      version: 1,
      mode: "paused",
      sectionIndex: clampSectionIndex(runState.sectionIndex),
      pausedAt: nowIso(),
      elapsedBeforePauseSec: accumulated,
      startedAt: runState.startedAt,
    };
    await hostSetState(next);
  }, [clampSectionIndex, hostSetState, runState]);

  const hostResume = useCallback(async () => {
    if (runState.mode !== "paused") return;
    const next: EventRunStateV1 = {
      version: 1,
      mode: "running",
      sectionIndex: clampSectionIndex(runState.sectionIndex),
      startedAt: nowIso(),
      elapsedBeforePauseSec: runState.elapsedBeforePauseSec ?? 0,
    };
    await hostSetState(next);
  }, [clampSectionIndex, hostSetState, runState]);

  const hostEnd = useCallback(async () => {
    const next: EventRunStateV1 = {
      version: 1,
      mode: "ended",
      sectionIndex: clampSectionIndex(runState.sectionIndex),
      elapsedBeforePauseSec: runState.elapsedBeforePauseSec ?? 0,
    };
    await hostSetState(next);
  }, [clampSectionIndex, hostSetState, runState]);

  const hostGoTo = useCallback(
    async (idx: number) => {
      const nextIndex = clampSectionIndex(idx);
      // When changing section:
      // - if running: restart timer at 0 from now
      // - if paused/idle/ended: keep mode, reset elapsed to 0 (so it's clean when started)
      const base: EventRunStateV1 = {
        version: 1,
        mode: runState.mode,
        sectionIndex: nextIndex,
      };

      if (runState.mode === "running") {
        await hostSetState({
          ...base,
          mode: "running",
          startedAt: nowIso(),
          elapsedBeforePauseSec: 0,
        });
      } else if (runState.mode === "paused") {
        await hostSetState({
          ...base,
          mode: "paused",
          pausedAt: nowIso(),
          elapsedBeforePauseSec: 0,
        });
      } else {
        await hostSetState({
          ...base,
          elapsedBeforePauseSec: 0,
        });
      }
    },
    [clampSectionIndex, hostSetState, runState.mode]
  );

  // Host auto-advance when timer hits 0 (only host does this)
  const autoAdvanceGuardRef = useRef(false);
  useEffect(() => {
    if (!isHost) return;
    if (!timerInfo.hasTimer) return;
    if (runState.mode !== "running") return;
    if (!sections.length) return;

    if (timerInfo.remainingSec > 0) {
      autoAdvanceGuardRef.current = false;
      return;
    }

    if (autoAdvanceGuardRef.current) return;
    autoAdvanceGuardRef.current = true;

    // Next section or end
    const nextIndex = runState.sectionIndex + 1;
    if (nextIndex <= sections.length - 1) {
      hostGoTo(nextIndex).catch(() => {
        autoAdvanceGuardRef.current = false;
      });
    } else {
      hostEnd().catch(() => {
        autoAdvanceGuardRef.current = false;
      });
    }
  }, [isHost, timerInfo.hasTimer, timerInfo.remainingSec, runState.mode, runState.sectionIndex, sections.length, hostGoTo, hostEnd]);

  const onBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("RootTabs" as any);
  }, [navigation]);

  if (!eventId) return null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading room…</Text>
      </View>
    );
  }

  const title = eventRow?.title ?? "Event";
  const scriptTitle = scriptRow?.title ?? (eventRow?.script_id ? "Script" : "No script attached");

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>{title}</Text>
          <Text style={styles.sub}>
            Script: <Text style={styles.mono}>{scriptTitle}</Text>
          </Text>
          <Text style={styles.sub}>
            Session: <Text style={styles.mono}>{runStateReady ? runState.mode : "…"}</Text>
            {isHost ? <Text style={styles.badge}> HOST </Text> : null}
          </Text>
        </View>
      </View>

      {/* Presence */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Live presence</Text>
        <View style={styles.row}>
          {!joinedLive ? (
            <Pressable onPress={joinLive} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Join live</Text>
            </Pressable>
          ) : (
            <Pressable onPress={leaveLive} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Leave</Text>
            </Pressable>
          )}

          <Text style={styles.muted}>{activePresence.length} active</Text>
        </View>

        <FlatList
          data={activePresence}
          keyExtractor={(p) => `${p.event_id}:${p.user_id}`}
          renderItem={({ item }) => (
            <View style={styles.presenceRow}>
              <Text style={styles.mono} numberOfLines={1}>
                {item.user_id}
              </Text>
              <Text style={styles.mutedSmall}>last seen {formatTime(secondsBetweenIso(item.last_seen_at, nowIso()))} ago</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.muted}>No one active (yet)</Text>}
        />
      </View>

      {/* Guided flow */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Guided flow</Text>

        {!scriptRow ? (
          <Text style={styles.muted}>Attach a script to run a guided flow.</Text>
        ) : sections.length === 0 ? (
          <Text style={styles.muted}>This script has no sections.</Text>
        ) : !currentSection ? (
          <Text style={styles.muted}>Loading section…</Text>
        ) : (
          <>
            <Text style={styles.sectionTitle}>
              {currentSection.index + 1}/{sections.length}: {currentSection.section.title}
            </Text>

            {currentSection.section.body ? (
              <Text style={styles.sectionBody}>{currentSection.section.body}</Text>
            ) : null}

            {timerInfo.hasTimer ? (
              <View style={styles.timerBox}>
                <Text style={styles.timerText}>{formatTime(timerInfo.remainingSec)}</Text>
                <Text style={styles.mutedSmall}>
                  duration {formatTime(timerInfo.durationSec)} • elapsed {formatTime(timerInfo.elapsedSec)}
                </Text>
              </View>
            ) : (
              <Text style={styles.mutedSmall}>No timer for this section.</Text>
            )}

            {/* Host controls */}
            {isHost ? (
              <View style={styles.hostControls}>
                <Text style={styles.hostTitle}>Host controls</Text>

                <View style={styles.rowWrap}>
                  {runState.mode === "idle" || runState.mode === "ended" ? (
                    <Pressable onPress={hostStart} style={styles.primaryBtn}>
                      <Text style={styles.primaryBtnText}>Start</Text>
                    </Pressable>
                  ) : null}

                  {runState.mode === "running" ? (
                    <Pressable onPress={hostPause} style={styles.secondaryBtn}>
                      <Text style={styles.secondaryBtnText}>Pause</Text>
                    </Pressable>
                  ) : null}

                  {runState.mode === "paused" ? (
                    <Pressable onPress={hostResume} style={styles.primaryBtn}>
                      <Text style={styles.primaryBtnText}>Resume</Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    onPress={() => hostGoTo(currentSection.index - 1)}
                    style={[styles.secondaryBtn, currentSection.index === 0 ? styles.disabled : null]}
                    disabled={currentSection.index === 0}
                  >
                    <Text style={styles.secondaryBtnText}>Prev</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => hostGoTo(currentSection.index + 1)}
                    style={[
                      styles.secondaryBtn,
                      currentSection.index >= sections.length - 1 ? styles.disabled : null,
                    ]}
                    disabled={currentSection.index >= sections.length - 1}
                  >
                    <Text style={styles.secondaryBtnText}>Next</Text>
                  </Pressable>

                  {runState.mode !== "ended" ? (
                    <Pressable onPress={hostEnd} style={styles.dangerBtn}>
                      <Text style={styles.dangerBtnText}>End</Text>
                    </Pressable>
                  ) : null}
                </View>

                <Text style={styles.mutedSmall}>
                  Tip: timers stay synced because everyone calculates time from the host’s <Text style={styles.mono}>startedAt</Text>.
                </Text>
              </View>
            ) : (
              <View style={styles.attendeeNote}>
                <Text style={styles.mutedSmall}>
                  You’re viewing the host’s session. Only the host can change steps/timers.
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },

  header: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  backBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: "#ddd" },
  backText: { fontSize: 14 },

  h1: { fontSize: 20, fontWeight: "700" },
  sub: { marginTop: 2, color: "#444" },
  badge: { fontWeight: "700" },
  mono: { fontFamily: "Courier", fontSize: 12 },

  card: { borderWidth: 1, borderColor: "#eee", borderRadius: 14, padding: 12, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "700" },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowWrap: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },

  muted: { color: "#666" },
  mutedSmall: { color: "#666", fontSize: 12 },

  primaryBtn: { backgroundColor: "#111", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  primaryBtnText: { color: "#fff", fontWeight: "700" },

  secondaryBtn: { borderWidth: 1, borderColor: "#ddd", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  secondaryBtnText: { color: "#111", fontWeight: "700" },

  dangerBtn: { backgroundColor: "#a00", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 },
  dangerBtnText: { color: "#fff", fontWeight: "700" },

  disabled: { opacity: 0.4 },

  presenceRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f1f1f1", gap: 2 },

  sectionTitle: { fontSize: 16, fontWeight: "700" },
  sectionBody: { fontSize: 14, lineHeight: 20 },

  timerBox: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 10, alignItems: "center", gap: 4 },
  timerText: { fontSize: 28, fontWeight: "800" },

  hostControls: { marginTop: 8, borderTopWidth: 1, borderTopColor: "#f1f1f1", paddingTop: 10, gap: 10 },
  hostTitle: { fontSize: 14, fontWeight: "800" },

  attendeeNote: { marginTop: 8, borderTopWidth: 1, borderTopColor: "#f1f1f1", paddingTop: 10 },
});
