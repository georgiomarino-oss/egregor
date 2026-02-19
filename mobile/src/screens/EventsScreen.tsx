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
import type { Database } from "../types/db";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type ScriptRow = Database["public"]["Tables"]["scripts"]["Row"];

function plusMinutesToLocalInput(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function localInputToIso(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function diffMinutes(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const mins = Math.round((end - start) / 60_000);
  return Number.isFinite(mins) ? mins : null;
}

export default function EventsScreen() {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);

  // Scripts for display (id -> title)
  const [scriptsById, setScriptsById] = useState<Record<string, ScriptRow>>({});

  // Create form
  const [title, setTitle] = useState("Global Peace Circle");
  const [intention, setIntention] = useState(
    "May people everywhere experience peace, clarity and compassion."
  );
  const [description, setDescription] = useState(
    "A short guided group intention for collective wellbeing."
  );
  const [startLocal, setStartLocal] = useState(plusMinutesToLocalInput(10));
  const [endLocal, setEndLocal] = useState(plusMinutesToLocalInput(40));
  const [timezone, setTimezone] = useState("Europe/London");

  // Presence
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [isJoined, setIsJoined] = useState(false);
  const [presenceStatus, setPresenceStatus] = useState("");
  const [presenceError, setPresenceError] = useState("");

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const loadScriptsForDisplay = useCallback(async () => {
    // We load only your scripts for display; if you want to display script titles
    // for scripts by other authors too, remove the author filter (and ensure RLS allows it).
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return;

    // Only need id/title for display; but selecting "*" is fine too.
    const { data, error } = await supabase
      .from("scripts")
      .select("id,title,created_at")
      // If your RLS allows reading only own scripts, this keeps it aligned.
      .eq("author_user_id" as any, user.id) // 'as any' only in case column name differs in generated types
      .order("created_at", { ascending: false });

    if (error) {
      // Don't hard-fail the screen if scripts can't load; we can still show IDs.
      return;
    }

    const rows = (data ?? []) as ScriptRow[];
    const map: Record<string, ScriptRow> = {};
    for (const s of rows) map[s.id] = s;
    setScriptsById(map);
  }, []);

  const loadEvents = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("events")
      .select(
        `
        id,title,description,
        intention,intention_statement,
        starts_at,
        start_time_utc,end_time_utc,
        duration_minutes,
        visibility,guidance_mode,script_id,
        timezone,status,active_count_snapshot,total_join_count,
        host_user_id,created_at
      `
      )
      .order("start_time_utc", { ascending: true });

    setLoading(false);

    if (error) {
      Alert.alert("Load events failed", error.message);
      return;
    }

    const rows = (data ?? []) as EventRow[];
    setEvents(rows);

    if (!selectedEventId && rows.length > 0) {
      setSelectedEventId(rows[0].id);
    } else if (selectedEventId && !rows.some((r) => r.id === selectedEventId)) {
      setSelectedEventId(rows[0]?.id ?? "");
    }
  }, [selectedEventId]);

  useEffect(() => {
    // Load both on mount
    loadScriptsForDisplay();
    loadEvents();
  }, [loadEvents, loadScriptsForDisplay]);

  const upsertPresence = useCallback(async (eventId: string) => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      throw new Error("Not signed in.");
    }

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

    if (error) throw error;
  }, []);

  useEffect(() => {
    if (!isJoined || !selectedEventId) return;

    const id = setInterval(async () => {
      try {
        await upsertPresence(selectedEventId);
        await loadEvents();
      } catch {
        // heartbeat best-effort
      }
    }, 10_000);

    return () => clearInterval(id);
  }, [isJoined, selectedEventId, loadEvents, upsertPresence]);

  const handleSignOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Sign out failed", error.message);
  }, []);

  const handleCreateEvent = useCallback(async () => {
    try {
      if (!title.trim()) {
        Alert.alert("Validation", "Title is required.");
        return;
      }

      const startIso = localInputToIso(startLocal);
      const endIso = localInputToIso(endLocal);

      if (!startIso || !endIso) {
        Alert.alert("Validation", "Start and end must be valid date-times.");
        return;
      }

      if (new Date(endIso) <= new Date(startIso)) {
        Alert.alert("Validation", "End time must be after start time.");
        return;
      }

      const mins = diffMinutes(startIso, endIso);
      if (!mins || mins <= 0) {
        Alert.alert("Validation", "Duration must be positive.");
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

      const intentionText = intention.trim();
      if (!intentionText) {
        Alert.alert("Validation", "Intention is required.");
        return;
      }

      setLoading(true);

      const payload: Database["public"]["Tables"]["events"]["Insert"] = {
        title: title.trim(),
        description: description.trim() || null,

        intention: intentionText,
        intention_statement: intentionText,

        starts_at: startIso,
        start_time_utc: startIso,
        end_time_utc: endIso,
        duration_minutes: mins,

        timezone: timezone.trim() || "Europe/London",

        visibility: "PUBLIC",
        guidance_mode: "AI",
        status: "SCHEDULED",

        host_user_id: user.id,
        created_by: user.id,
        script_id: null,
      };

      const { error } = await supabase.from("events").insert(payload);

      setLoading(false);

      if (error) {
        Alert.alert("Create event failed", error.message);
        return;
      }

      Alert.alert("Success", "Event created.");

      // Refresh both: event list + script titles (in case you attach soon after)
      await Promise.all([loadEvents(), loadScriptsForDisplay()]);
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Create event failed", e?.message ?? "Unknown error");
    }
  }, [
    title,
    description,
    intention,
    startLocal,
    endLocal,
    timezone,
    loadEvents,
    loadScriptsForDisplay,
  ]);

  const handleJoin = useCallback(async () => {
    try {
      setPresenceError("");
      setPresenceStatus("");

      if (!selectedEventId) {
        Alert.alert("Select event", "Please select an event first.");
        return;
      }

      await upsertPresence(selectedEventId);

      setIsJoined(true);
      setPresenceStatus("✅ Joined live.");
      await loadEvents();
    } catch (e: any) {
      setPresenceError(e?.message ?? "Failed to join");
    }
  }, [selectedEventId, loadEvents, upsertPresence]);

  const handleLeave = useCallback(async () => {
    try {
      setPresenceError("");
      setPresenceStatus("");

      if (!selectedEventId) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setPresenceError("Not signed in.");
        return;
      }

      const { error } = await supabase
        .from("event_presence")
        .delete()
        .eq("event_id", selectedEventId)
        .eq("user_id", user.id);

      if (error) {
        setPresenceError(error.message);
        return;
      }

      setIsJoined(false);
      setPresenceStatus("✅ Left live.");
      await loadEvents();
    } catch (e: any) {
      setPresenceError(e?.message ?? "Failed to leave");
    }
  }, [selectedEventId, loadEvents]);

  const getScriptLabel = (scriptId: string | null) => {
    if (!scriptId) return "(none)";
    const title = scriptsById[scriptId]?.title;
    return title ? title : scriptId; // fall back to uuid if we can't resolve
  };

  const renderEvent = ({ item }: { item: EventRow }) => (
    <Pressable
      onPress={() => setSelectedEventId(item.id)}
      style={[
        styles.card,
        item.id === selectedEventId ? styles.cardSelected : undefined,
      ]}
    >
      <Text style={styles.cardTitle}>{item.title}</Text>

      {!!item.description && <Text style={styles.cardText}>{item.description}</Text>}

      <Text style={styles.cardText}>Intention: {item.intention_statement}</Text>

      <Text style={styles.meta}>
        {new Date(item.start_time_utc).toLocaleString()} →{" "}
        {new Date(item.end_time_utc).toLocaleString()} ({item.timezone ?? "UTC"})
      </Text>

      <Text style={styles.meta}>Duration: {item.duration_minutes ?? 0} min</Text>

      <Text style={styles.meta}>
        Active snapshot: {item.active_count_snapshot ?? 0} | Total joined:{" "}
        {item.total_join_count ?? 0}
      </Text>

      <Text style={styles.meta}>Script: {getScriptLabel(item.script_id)}</Text>
      <Text style={styles.meta}>ID: {item.id}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <Text style={styles.h1}>Events</Text>
              <Pressable style={styles.signOutBtn} onPress={handleSignOut}>
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Create Event</Text>

              <Text style={styles.label}>Title</Text>
              <TextInput style={styles.input} value={title} onChangeText={setTitle} />

              <Text style={styles.label}>Intention</Text>
              <TextInput
                style={[styles.input, styles.multi]}
                value={intention}
                onChangeText={setIntention}
                multiline
              />

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.multi]}
                value={description}
                onChangeText={setDescription}
                multiline
              />

              <Text style={styles.label}>Start local (YYYY-MM-DDTHH:mm)</Text>
              <TextInput style={styles.input} value={startLocal} onChangeText={setStartLocal} />

              <Text style={styles.label}>End local (YYYY-MM-DDTHH:mm)</Text>
              <TextInput style={styles.input} value={endLocal} onChangeText={setEndLocal} />

              <Text style={styles.label}>Timezone</Text>
              <TextInput style={styles.input} value={timezone} onChangeText={setTimezone} />

              <View style={styles.row}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, loading && styles.disabled]}
                  onPress={handleCreateEvent}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>{loading ? "Working..." : "Create event"}</Text>
                </Pressable>

                <Pressable
                  style={[styles.btn, styles.btnGhost, loading && styles.disabled]}
                  onPress={async () => {
                    setLoading(true);
                    try {
                      await Promise.all([loadEvents(), loadScriptsForDisplay()]);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                >
                  <Text style={styles.btnGhostText}>Refresh</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Live Presence</Text>
              <Text style={styles.meta}>
                Selected: {selectedEvent ? selectedEvent.title : "(none)"}
              </Text>

              <View style={styles.row}>
                <Pressable
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    (!selectedEventId || isJoined) && styles.disabled,
                  ]}
                  onPress={handleJoin}
                  disabled={!selectedEventId || isJoined}
                >
                  <Text style={styles.btnText}>Join live</Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.btn,
                    styles.btnGhost,
                    (!selectedEventId || !isJoined) && styles.disabled,
                  ]}
                  onPress={handleLeave}
                  disabled={!selectedEventId || !isJoined}
                >
                  <Text style={styles.btnGhostText}>Leave live</Text>
                </Pressable>
              </View>

              {!!presenceStatus && <Text style={styles.ok}>{presenceStatus}</Text>}
              {!!presenceError && <Text style={styles.err}>{presenceError}</Text>}
            </View>

            <Text style={styles.sectionTitle}>All Events</Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>{loading ? "Loading..." : "No events yet."}</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  content: { padding: 16, paddingBottom: 32 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  h1: { color: "white", fontSize: 28, fontWeight: "800" },

  signOutBtn: {
    borderWidth: 1,
    borderColor: "#3E4C78",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  signOutText: { color: "#C8D3FF", fontWeight: "700" },

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
  cardSelected: { borderColor: "#6EA1FF", backgroundColor: "#1A2C5F" },
  cardTitle: { color: "white", fontSize: 16, fontWeight: "700", marginBottom: 6 },
  cardText: { color: "#C6D0F5", marginBottom: 6 },
  meta: { color: "#93A3D9", fontSize: 12 },

  ok: { color: "#6EE7B7", marginTop: 8 },
  err: { color: "#FB7185", marginTop: 8 },
  empty: { color: "#9EB0E3", marginTop: 8 },
});
