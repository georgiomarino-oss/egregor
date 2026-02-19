import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../supabase/client";
import type { EventItem, ScriptListItem } from "../types";

type ScriptRow = {
  id: string;
  author_user_id: string;
  title: string;
  intention: string;
  duration_minutes: number;
  tone: string;
  content_json: any;
  created_at: string;
};

export default function ScriptsScreen() {
  const [loading, setLoading] = useState(false);

  // create script form
  const [title, setTitle] = useState("Peace Circle Script");
  const [intention, setIntention] = useState(
    "May people everywhere experience peace, clarity and compassion."
  );
  const [durationMinutes, setDurationMinutes] = useState("20");
  const [tone, setTone] = useState<"calm" | "uplifting" | "focused">("calm");

  // data
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);

  // selection
  const [selectedScriptId, setSelectedScriptId] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  const selectedScript = useMemo(
    () => scripts.find((s) => s.id === selectedScriptId) ?? null,
    [scripts, selectedScriptId]
  );

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const loadScripts = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("scripts")
      .select("id,author_user_id,title,intention,duration_minutes,tone,content_json,created_at")
      .order("created_at", { ascending: false });

    setLoading(false);

    if (error) {
      Alert.alert("Load scripts failed", error.message);
      return;
    }

    const rows = (data ?? []) as ScriptRow[];
    setScripts(rows);

    if (!selectedScriptId && rows.length > 0) setSelectedScriptId(rows[0].id);
    if (selectedScriptId && !rows.some((r) => r.id === selectedScriptId)) {
      setSelectedScriptId(rows[0]?.id ?? "");
    }
  }, [selectedScriptId]);

  const loadMyEvents = useCallback(async () => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return;

    // Only events YOU host — avoids "you can only attach to your own events"
    const { data, error } = await supabase
      .from("events")
      .select(
        "id,host_user_id,theme_id,title,description,intention_statement,visibility,guidance_mode,script_id,start_time_utc,end_time_utc,timezone,status,active_count_snapshot,total_join_count,created_at"
      )
      .eq("host_user_id", user.id)
      .order("start_time_utc", { ascending: false });

    if (error) {
      Alert.alert("Load events failed", error.message);
      return;
    }

    const rows = (data ?? []) as EventItem[];
    setEvents(rows);

    if (!selectedEventId && rows.length > 0) setSelectedEventId(rows[0].id);
    if (selectedEventId && !rows.some((r) => r.id === selectedEventId)) {
      setSelectedEventId(rows[0]?.id ?? "");
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadScripts();
    loadMyEvents();
  }, [loadScripts, loadMyEvents]);

  const handleCreateScript = useCallback(async () => {
    try {
      const mins = Number(durationMinutes);
      if (!title.trim()) {
        Alert.alert("Validation", "Title is required.");
        return;
      }
      if (!intention.trim()) {
        Alert.alert("Validation", "Intention is required.");
        return;
      }
      if (!Number.isFinite(mins) || mins <= 0) {
        Alert.alert("Validation", "Duration must be a positive number.");
        return;
      }

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      setLoading(true);

      // Minimal script content; your generate function can overwrite/update later if needed
      const content_json = {
        title: title.trim(),
        durationMinutes: mins,
        tone,
        sections: [
          { name: "Arrival", minutes: 2, text: "Take a breath and arrive." },
          { name: "Intention", minutes: 6, text: intention.trim() },
          { name: "Silence", minutes: 10, text: "Hold the intention in silence." },
          { name: "Closing", minutes: 2, text: "Gently return and close." },
        ],
      };

      const { error } = await supabase.from("scripts").insert({
        author_user_id: user.id,
        title: title.trim(),
        intention: intention.trim(),
        duration_minutes: mins,
        tone,
        content_json,
      });

      setLoading(false);

      if (error) {
        Alert.alert("Create script failed", error.message);
        return;
      }

      Alert.alert("Success", "Script created.");
      await loadScripts();
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Create script failed", e?.message ?? "Unknown error");
    }
  }, [title, intention, durationMinutes, tone, loadScripts]);

  const handleAttach = useCallback(async () => {
    try {
      if (!selectedScriptId) {
        Alert.alert("Pick a script", "Select a script first.");
        return;
      }
      if (!selectedEventId) {
        Alert.alert("Pick an event", "Select one of your events first.");
        return;
      }

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      // Optional safety check client-side
      const ev = events.find((e) => e.id === selectedEventId);
      if (!ev) {
        Alert.alert("Event not found", "Refresh events and try again.");
        return;
      }
      if (ev.host_user_id !== user.id) {
        Alert.alert("Not allowed", "You can only attach scripts to your own events.");
        return;
      }

      setLoading(true);

      const { error } = await supabase
        .from("events")
        .update({ script_id: selectedScriptId })
        .eq("id", selectedEventId);

      setLoading(false);

      if (error) {
        Alert.alert("Attach failed", error.message);
        return;
      }

      Alert.alert("Attached", "Script attached to event.");
      await loadMyEvents();
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Attach failed", e?.message ?? "Unknown error");
    }
  }, [selectedScriptId, selectedEventId, events, loadMyEvents]);

  const renderScript = ({ item }: { item: ScriptRow }) => {
    const selected = item.id === selectedScriptId;
    return (
      <Pressable
        onPress={() => setSelectedScriptId(item.id)}
        style={[styles.card, selected && styles.cardSelected]}
      >
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.meta}>Tone: {item.tone}</Text>
        <Text style={styles.meta}>Duration: {item.duration_minutes} min</Text>
        <Text style={styles.meta}>Intention: {item.intention}</Text>
        <Text style={styles.meta}>ID: {item.id}</Text>
      </Pressable>
    );
  };

  const renderEventPick = ({ item }: { item: EventItem }) => {
    const selected = item.id === selectedEventId;
    return (
      <Pressable
        onPress={() => setSelectedEventId(item.id)}
        style={[styles.cardSmall, selected && styles.cardSelected]}
      >
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.meta}>
          {new Date(item.start_time_utc).toLocaleString()} ({item.timezone ?? "UTC"})
        </Text>
        <Text style={styles.meta}>Current script: {item.script_id ?? "(none)"}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={scripts}
        keyExtractor={(item) => item.id}
        renderItem={renderScript}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <Text style={styles.h1}>Scripts</Text>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Create Script</Text>

              <Text style={styles.label}>Title</Text>
              <TextInput style={styles.input} value={title} onChangeText={setTitle} />

              <Text style={styles.label}>Intention</Text>
              <TextInput
                style={[styles.input, styles.multi]}
                value={intention}
                onChangeText={setIntention}
                multiline
              />

              <Text style={styles.label}>Duration (minutes)</Text>
              <TextInput
                style={styles.input}
                value={durationMinutes}
                onChangeText={setDurationMinutes}
                keyboardType="number-pad"
              />

              <Text style={styles.label}>Tone (calm / uplifting / focused)</Text>
              <TextInput
                style={styles.input}
                value={tone}
                onChangeText={(v) => setTone((v as any) || "calm")}
              />

              <View style={styles.row}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, loading && styles.disabled]}
                  onPress={handleCreateScript}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>{loading ? "Working..." : "Create script"}</Text>
                </Pressable>

                <Pressable
                  style={[styles.btn, styles.btnGhost, loading && styles.disabled]}
                  onPress={() => {
                    loadScripts();
                    loadMyEvents();
                  }}
                  disabled={loading}
                >
                  <Text style={styles.btnGhostText}>Refresh</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Attach Script to Your Event</Text>

              <Text style={styles.meta}>
                Selected script: {selectedScript ? selectedScript.title : "(none)"}
              </Text>
              <Text style={styles.meta}>
                Selected event: {selectedEvent ? selectedEvent.title : "(none)"}
              </Text>

              <Text style={[styles.label, { marginTop: 12 }]}>Pick one of your events</Text>
              {events.length === 0 ? (
                <Text style={styles.empty}>
                  No hosted events found. Create an event in Events tab first.
                </Text>
              ) : (
                <FlatList
                  data={events}
                  keyExtractor={(e) => e.id}
                  renderItem={renderEventPick}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10, paddingVertical: 6 }}
                />
              )}

              <View style={styles.row}>
                <Pressable
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    (!selectedScriptId || !selectedEventId || loading) && styles.disabled,
                  ]}
                  onPress={handleAttach}
                  disabled={!selectedScriptId || !selectedEventId || loading}
                >
                  <Text style={styles.btnText}>Attach to event</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.sectionTitle}>All Scripts</Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>{loading ? "Loading..." : "No scripts yet."}</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  content: { padding: 16, paddingBottom: 32 },
  h1: { color: "white", fontSize: 28, fontWeight: "800", marginBottom: 12 },

  section: {
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: { color: "#DCE4FF", fontSize: 16, fontWeight: "700", marginBottom: 8 },

  label: { color: "#B9C3E6", fontSize: 12, marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: "#0E1428",
    borderColor: "#2A365E",
    borderWidth: 1,
    color: "white",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multi: { minHeight: 72, textAlignVertical: "top" },

  row: { flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" },

  btn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 120,
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

  card: {
    backgroundColor: "#121A31",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27345C",
    padding: 12,
    marginBottom: 10,
  },
  cardSmall: {
    backgroundColor: "#121A31",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27345C",
    padding: 12,
    width: 280,
  },
  cardSelected: { borderColor: "#6EA1FF", backgroundColor: "#1A2C5F" },
  cardTitle: { color: "white", fontSize: 16, fontWeight: "700", marginBottom: 6 },
  meta: { color: "#93A3D9", fontSize: 12 },

  empty: { color: "#9EB0E3", marginTop: 8 },
});
