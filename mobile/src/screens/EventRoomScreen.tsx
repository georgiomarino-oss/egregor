import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { supabase } from "../supabase/client";
import type { RootStackParamList } from "../types";
import type { Database } from "../types/db";

type Props = NativeStackScreenProps<RootStackParamList, "EventRoom">;

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type ScriptDbRow = Database["public"]["Tables"]["scripts"]["Row"];
type PresenceRow = Database["public"]["Tables"]["event_presence"]["Row"];

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

export default function EventRoomScreen({ route, navigation }: Props) {
  const eventId = route.params?.eventId ?? "";
  const hasValidEventId = !!eventId && isLikelyUuid(eventId);

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<EventRow | null>(null);

  const [scriptDbRow, setScriptDbRow] = useState<
    Pick<ScriptDbRow, "id" | "title" | "content_json"> | null
  >(null);
  const [script, setScript] = useState<ScriptContent | null>(null);

  // Presence
  const [presenceRows, setPresenceRows] = useState<PresenceRow[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [presenceMsg, setPresenceMsg] = useState("");
  const [presenceErr, setPresenceErr] = useState("");

  // Guided flow state
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentSection = useMemo(() => {
    if (!script?.sections?.length) return null;
    return script.sections[currentSectionIdx] ?? null;
  }, [script, currentSectionIdx]);

  const sectionTotalSeconds = useMemo(() => {
    if (!currentSection) return 0;
    return Math.max(1, Math.floor(currentSection.minutes * 60));
  }, [currentSection]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setSecondsLeft(sectionTotalSeconds);

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
  }, [sectionTotalSeconds, stopTimer]);

  const loadPresence = useCallback(async () => {
    if (!hasValidEventId) {
      setPresenceRows([]);
      return;
    }

    const { data, error } = await supabase
      .from("event_presence")
      .select("event_id,user_id,joined_at,last_seen_at,created_at")
      .eq("event_id", eventId);

    if (error) {
      // keep screen usable; presence is secondary
      return;
    }

    setPresenceRows((data ?? []) as PresenceRow[]);
  }, [eventId, hasValidEventId]);

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
      .single();

    if (scErr || !scData) {
      setScriptDbRow(null);
      setScript(null);
      return;
    }

    const row = scData as Pick<ScriptDbRow, "id" | "title" | "content_json">;
    setScriptDbRow(row);
    setScript(parseScriptContent(row.content_json));
    setCurrentSectionIdx(0);
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

    await Promise.all([loadPresence(), loadScriptById(eventRow.script_id ?? null)]);

    setLoading(false);
  }, [eventId, hasValidEventId, loadPresence, loadScriptById]);

  useEffect(() => {
    loadEventRoom();
  }, [loadEventRoom]);

  // Realtime subscription: keep EventRoom synced with events row changes (incl script_id attach/detach)
  useEffect(() => {
    if (!hasValidEventId) return;

    const channel = supabase
      .channel(`event:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "events",
          filter: `id=eq.${eventId}`,
        },
        async (payload) => {
          const next = payload.new as Partial<EventRow> | null;
          const prev = payload.old as Partial<EventRow> | null;

          // Update the local event state quickly
          setEvent((cur) => {
            if (!cur) return cur;
            return { ...cur, ...(next as any) };
          });

          // If script changed, reload script and reset guided flow cleanly
          const nextScriptId = (next as any)?.script_id ?? null;
          const prevScriptId = (prev as any)?.script_id ?? null;

          if (nextScriptId !== prevScriptId) {
            stopTimer();
            setSecondsLeft(0);
            setCurrentSectionIdx(0);
            await loadScriptById(nextScriptId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, hasValidEventId, loadScriptById, stopTimer]);

  // Timer reset on section change
  useEffect(() => {
    if (!script || !currentSection) {
      stopTimer();
      setSecondsLeft(0);
      return;
    }
    startTimer();
    return () => stopTimer();
  }, [script, currentSectionIdx, currentSection, startTimer, stopTimer]);

  // Auto-advance when timer hits 0
  useEffect(() => {
    if (!script?.sections?.length) return;
    if (secondsLeft > 0) return;

    if (currentSectionIdx < script.sections.length - 1) {
      const t = setTimeout(() => setCurrentSectionIdx((i) => i + 1), 800);
      return () => clearTimeout(t);
    }
  }, [secondsLeft, currentSectionIdx, script]);

  // Realtime subscription for event_presence changes
  useEffect(() => {
    if (!hasValidEventId) return;

    const channel = supabase
      .channel(`presence:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_presence",
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          loadPresence();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, hasValidEventId, loadPresence]);

  // Heartbeat while joined (keeps you active)
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
        {
          event_id: eventId,
          user_id: user.id,
          last_seen_at: now,
          created_at: now,
        },
        { onConflict: "event_id,user_id" }
      );

      if (error && !cancelled) {
        setPresenceErr(error.message);
      }
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

  const activePresence = useMemo(() => {
    const now = Date.now();
    return presenceRows.filter((r) => {
      const t = new Date(r.last_seen_at).getTime();
      return Number.isFinite(t) && now - t <= activeWindowMs;
    });
  }, [presenceRows]);

  const activeCount = activePresence.length;

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
        {
          event_id: eventId,
          user_id: user.id,
          last_seen_at: now,
          created_at: now,
        },
        { onConflict: "event_id,user_id" }
      );

      if (upErr) {
        setPresenceErr(upErr.message);
        return;
      }

      setIsJoined(true);
      setPresenceMsg("✅ You joined live.");
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
      await loadPresence();
    } catch (e: any) {
      setPresenceErr(e?.message ?? "Failed to leave.");
    }
  }, [eventId, hasValidEventId, loadPresence]);

  const handlePrev = useCallback(() => setCurrentSectionIdx((i) => Math.max(0, i - 1)), []);
  const handleNext = useCallback(() => {
    if (!script?.sections?.length) return;
    setCurrentSectionIdx((i) => Math.min(script.sections.length - 1, i + 1));
  }, [script]);

  useEffect(() => {
    return () => stopTimer();
  }, [stopTimer]);

  if (!hasValidEventId) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <Text style={styles.err}>Missing or invalid event id.</Text>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => navigation.goBack()}>
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
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => navigation.goBack()}>
            <Text style={styles.btnGhostText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>{event.title}</Text>

        {!!event.description && <Text style={styles.body}>{event.description}</Text>}

        <Text style={styles.body}>Intention: {event.intention_statement}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attached Script</Text>
          <Text style={styles.meta}>
            {event.script_id
              ? scriptDbRow?.title
                ? scriptDbRow.title
                : event.script_id
              : "(none)"}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Live Presence</Text>

          <Text style={styles.meta}>
            Active now: <Text style={{ fontWeight: "900", color: "white" }}>{activeCount}</Text>
          </Text>

          <Text style={styles.meta}>
            {new Date(event.start_time_utc).toLocaleString()} →{" "}
            {new Date(event.end_time_utc).toLocaleString()} ({event.timezone ?? "UTC"})
          </Text>

          {activePresence.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              {activePresence.slice(0, 10).map((p) => (
                <Text key={p.user_id} style={styles.meta}>
                  • {shortId(p.user_id)} (seen{" "}
                  {Math.max(
                    0,
                    Math.floor((Date.now() - new Date(p.last_seen_at).getTime()) / 1000)
                  )}
                  s ago)
                </Text>
              ))}
              {activePresence.length > 10 ? (
                <Text style={styles.meta}>…and {activePresence.length - 10} more</Text>
              ) : null}
            </View>
          ) : (
            <Text style={[styles.meta, { marginTop: 8 }]}>No one active yet.</Text>
          )}

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
              No script attached to this event yet. Attach one from the Scripts screen.
            </Text>
          ) : (
            <>
              <Text style={styles.cardTitle}>{script.title}</Text>
              <Text style={styles.meta}>
                Tone: {script.tone} | Duration: {script.durationMinutes} min
              </Text>

              <View style={styles.timerBox}>
                <Text style={styles.timerLabel}>
                  Section {currentSectionIdx + 1} of {script.sections.length}
                </Text>
                <Text style={styles.timerValue}>{formatSeconds(secondsLeft)}</Text>
                <Text style={styles.timerSub}>{currentSection?.name ?? "Section"}</Text>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.cardTitle}>{currentSection?.name}</Text>
                <Text style={styles.meta}>{currentSection?.minutes ?? 0} min</Text>
                <Text style={styles.body}>{currentSection?.text ?? ""}</Text>
              </View>

              <View style={styles.row}>
                <Pressable
                  style={[styles.btn, styles.btnGhost, currentSectionIdx === 0 && styles.disabled]}
                  onPress={handlePrev}
                  disabled={currentSectionIdx === 0}
                >
                  <Text style={styles.btnGhostText}>Previous</Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    currentSectionIdx >= script.sections.length - 1 && styles.disabled,
                  ]}
                  onPress={handleNext}
                  disabled={currentSectionIdx >= script.sections.length - 1}
                >
                  <Text style={styles.btnText}>Next</Text>
                </Pressable>
              </View>

              <View style={{ marginTop: 10 }}>
                {script.sections.map((s, i) => (
                  <Pressable
                    key={`${s.name}-${i}`}
                    onPress={() => setCurrentSectionIdx(i)}
                    style={[
                      styles.listItem,
                      i === currentSectionIdx ? styles.listItemActive : undefined,
                    ]}
                  >
                    <Text style={styles.listTitle}>
                      {i + 1}. {s.name}
                    </Text>
                    <Text style={styles.meta}>{s.minutes} min</Text>
                  </Pressable>
                ))}
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
});
