import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../supabase/client";
import type { Database } from "../types/db";

type ScriptRow = Database["public"]["Tables"]["scripts"]["Row"];
type ScriptInsert = Database["public"]["Tables"]["scripts"]["Insert"];
type EventRow = Database["public"]["Tables"]["events"]["Row"];

export default function ScriptsScreen() {
  const [loading, setLoading] = useState(false);

  // Create script form
  const [title, setTitle] = useState("Peace Circle Script");
  const [intention, setIntention] = useState(
    "May people everywhere experience peace, clarity and compassion."
  );
  const [durationMinutes, setDurationMinutes] = useState("20");
  const [tone, setTone] = useState("calm");

  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [myEvents, setMyEvents] = useState<EventRow[]>([]);

  // Attach modal state
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachScriptId, setAttachScriptId] = useState<string>("");
  const [eventQuery, setEventQuery] = useState("");

  const scriptsById = useMemo(() => {
    const map: Record<string, ScriptRow> = {};
    for (const s of scripts) map[s.id] = s;
    return map;
  }, [scripts]);

  const selectedScript = useMemo(
    () => scripts.find((s) => s.id === attachScriptId) ?? null,
    [scripts, attachScriptId]
  );

  const filteredEvents = useMemo(() => {
    const q = eventQuery.trim().toLowerCase();
    if (!q) return myEvents;

    return myEvents.filter((e) => {
      const t = (e.title ?? "").toLowerCase();
      const d = (e.description ?? "").toLowerCase();
      const currentTitle = e.script_id ? (scriptsById[e.script_id]?.title ?? "") : "";
      return t.includes(q) || d.includes(q) || currentTitle.toLowerCase().includes(q);
    });
  }, [myEvents, eventQuery, scriptsById]);

  const loadScripts = useCallback(async () => {
    const { data, error } = await supabase
      .from("scripts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      Alert.alert("Load scripts failed", error.message);
      return;
    }
    setScripts((data ?? []) as ScriptRow[]);
  }, []);

  const loadMyHostedEvents = useCallback(async () => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return;

    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("host_user_id", user.id)
      .order("start_time_utc", { ascending: false });

    if (error) {
      Alert.alert("Load events failed", error.message);
      return;
    }
    setMyEvents((data ?? []) as EventRow[]);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadScripts(), loadMyHostedEvents()]);
    } finally {
      setLoading(false);
    }
  }, [loadMyHostedEvents, loadScripts]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleCreateScript = useCallback(async () => {
    const mins = Number(durationMinutes);

    if (!title.trim()) return Alert.alert("Validation", "Title is required.");
    if (!intention.trim()) return Alert.alert("Validation", "Intention is required.");
    if (!Number.isFinite(mins) || mins <= 0) {
      return Alert.alert("Validation", "Duration must be a positive number.");
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
    try {
      const payload: ScriptInsert = {
        // if your db.ts uses a different owner column, TS will complain here and we’ll adjust
        author_user_id: user.id as any,

        title: title.trim(),
        intention: intention.trim(),
        duration_minutes: mins as any,
        tone: tone as any,

        content_json: {
          title: title.trim(),
          durationMinutes: mins,
          tone,
          sections: [
            { name: "Arrival", minutes: 2, text: "Take a breath and arrive." },
            { name: "Intention", minutes: 6, text: intention.trim() },
            { name: "Silence", minutes: 10, text: "Hold the intention in silence." },
            { name: "Closing", minutes: 2, text: "Gently return and close." },
          ],
        } as any,
      };

      const { error } = await supabase.from("scripts").insert(payload);

      if (error) {
        Alert.alert("Create script failed", error.message);
        return;
      }

      Alert.alert("Success", "Script created.");
      await refreshAll();
    } catch (e: any) {
      Alert.alert("Create script failed", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [durationMinutes, intention, refreshAll, title, tone]);

  const openAttachForScript = useCallback(
    async (scriptId: string) => {
      setAttachScriptId(scriptId);
      setEventQuery("");
      setAttachOpen(true);

      // Ensure events are current when opening modal
      await loadMyHostedEvents();
    },
    [loadMyHostedEvents]
  );

  const updateEventScript = useCallback(
    async (event: EventRow, nextScriptId: string | null) => {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return false;
      }

      // Client-side guard; RLS must enforce.
      if (event.host_user_id !== user.id) {
        Alert.alert("Not allowed", "Only the host can change this event’s script.");
        return false;
      }

      setLoading(true);
      try {
        const { error } = await supabase
          .from("events")
          .update({ script_id: nextScriptId })
          .eq("id", event.id);

        if (error) {
          Alert.alert("Update failed", error.message);
          return false;
        }

        await loadMyHostedEvents();
        return true;
      } finally {
        setLoading(false);
      }
    },
    [loadMyHostedEvents]
  );

  const attachToEvent = useCallback(
    async (event: EventRow) => {
      if (!attachScriptId) return;

      if (event.script_id === attachScriptId) {
        Alert.alert("Already attached", "This event already uses the selected script.");
        return;
      }

      // If another script is attached, confirm replace
      if (event.script_id && event.script_id !== attachScriptId) {
        Alert.alert(
          "Replace script?",
          "This event already has a script attached. Replace it?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Replace",
              style: "destructive",
              onPress: async () => {
                const ok = await updateEventScript(event, attachScriptId);
                if (ok) {
                  setAttachOpen(false);
                  Alert.alert("Updated", "Script replaced.");
                }
              },
            },
          ]
        );
        return;
      }

      const ok = await updateEventScript(event, attachScriptId);
      if (ok) {
        setAttachOpen(false);
        Alert.alert("Attached", "Script attached to event.");
      }
    },
    [attachScriptId, updateEventScript]
  );

  const detachFromEvent = useCallback(
    async (event: EventRow) => {
      if (!event.script_id) return;

      Alert.alert("Detach script?", "Remove the current script from this event?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Detach",
          style: "destructive",
          onPress: async () => {
            const ok = await updateEventScript(event, null);
            if (ok) {
              setAttachOpen(false);
              Alert.alert("Detached", "Script removed from event.");
            }
          },
        },
      ]);
    },
    [updateEventScript]
  );

  const renderScript = ({ item }: { item: ScriptRow }) => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{(item as any).title ?? "Untitled"}</Text>

      {"tone" in (item as any) ? (
        <Text style={styles.meta}>Tone: {(item as any).tone}</Text>
      ) : null}

      {"duration_minutes" in (item as any) ? (
        <Text style={styles.meta}>Duration: {(item as any).duration_minutes} min</Text>
      ) : null}

      {"intention" in (item as any) ? (
        <Text style={styles.meta} numberOfLines={2}>
          Intention: {(item as any).intention}
        </Text>
      ) : null}

      <View style={styles.row}>
        <Pressable
          onPress={() => openAttachForScript(item.id)}
          style={[styles.btn, styles.btnPrimary, loading && styles.disabled]}
          disabled={loading}
        >
          <Text style={styles.btnText}>Attach to event</Text>
        </Pressable>
      </View>

      <Text style={styles.metaSmall}>ID: {item.id}</Text>
    </View>
  );

  const renderEventRow = ({ item }: { item: EventRow }) => {
    const isUsingSelected = !!attachScriptId && item.script_id === attachScriptId;

    const currentTitle =
      item.script_id ? scriptsById[item.script_id]?.title ?? item.script_id : "(none)";

    const attachLabel = isUsingSelected
      ? "Attached"
      : item.script_id
      ? "Replace"
      : "Attach";

    return (
      <View style={styles.eventCard}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {item.title}
        </Text>

        <Text style={styles.eventMeta} numberOfLines={1}>
          {new Date(item.start_time_utc).toLocaleString()} ({item.timezone ?? "UTC"})
        </Text>

        <Text style={styles.eventMeta} numberOfLines={1}>
          Current:{" "}
          <Text style={{ color: "white", fontWeight: "800" }}>{currentTitle}</Text>
        </Text>

        <View style={styles.row}>
          <Pressable
            onPress={() => attachToEvent(item)}
            style={[
              styles.btn,
              isUsingSelected ? styles.btnGhost : styles.btnPrimary,
              (loading || !attachScriptId) && styles.disabled,
            ]}
            disabled={loading || !attachScriptId || isUsingSelected}
          >
            <Text style={isUsingSelected ? styles.btnGhostText : styles.btnText}>
              {attachLabel}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => detachFromEvent(item)}
            style={[
              styles.btn,
              styles.btnDanger,
              (loading || !item.script_id) && styles.disabled,
            ]}
            disabled={loading || !item.script_id}
          >
            <Text style={styles.btnText}>Detach</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={scripts}
        keyExtractor={(item) => item.id}
        renderItem={renderScript}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Text style={styles.h1}>Scripts</Text>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Create Script</Text>

              <Text style={styles.label}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                style={styles.input}
                placeholder="Script title"
                placeholderTextColor="#6B7BB2"
              />

              <Text style={styles.label}>Intention</Text>
              <TextInput
                value={intention}
                onChangeText={setIntention}
                style={[styles.input, styles.multi]}
                multiline
                placeholder="What is this script for?"
                placeholderTextColor="#6B7BB2"
              />

              <View style={styles.row}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={styles.label}>Duration (minutes)</Text>
                  <TextInput
                    value={durationMinutes}
                    onChangeText={setDurationMinutes}
                    keyboardType="numeric"
                    style={styles.input}
                    placeholder="20"
                    placeholderTextColor="#6B7BB2"
                  />
                </View>

                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={styles.label}>Tone</Text>
                  <TextInput
                    value={tone}
                    onChangeText={setTone}
                    style={styles.input}
                    placeholder="calm"
                    placeholderTextColor="#6B7BB2"
                  />
                </View>
              </View>

              <View style={styles.row}>
                <Pressable
                  onPress={handleCreateScript}
                  style={[styles.btn, styles.btnPrimary, loading && styles.disabled]}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>
                    {loading ? "Working..." : "Create script"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={refreshAll}
                  style={[styles.btn, styles.btnGhost, loading && styles.disabled]}
                  disabled={loading}
                >
                  <Text style={styles.btnGhostText}>Refresh</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Attach Script to Event</Text>
              <Text style={styles.meta}>
                Tap “Attach to event” on a script, then choose one of your hosted events.
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>{loading ? "Loading..." : "No scripts yet."}</Text>
        }
      />

      <Modal
        visible={attachOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Attach Script</Text>
              <Pressable onPress={() => setAttachOpen(false)} style={styles.modalClose}>
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.modalMeta}>
              Selected script:{" "}
              <Text style={{ fontWeight: "800", color: "white" }}>
                {selectedScript ? (selectedScript as any).title : "(none)"}
              </Text>
            </Text>

            <TextInput
              value={eventQuery}
              onChangeText={setEventQuery}
              style={styles.input}
              placeholder="Search your events… (title, description, current script)"
              placeholderTextColor="#6B7BB2"
            />

            {myEvents.length === 0 ? (
              <Text style={styles.empty}>No hosted events found. Create one in Events first.</Text>
            ) : (
              <FlatList
                data={filteredEvents}
                keyExtractor={(e) => e.id}
                renderItem={renderEventRow}
                contentContainerStyle={{ paddingTop: 10, paddingBottom: 6, gap: 10 }}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  content: { padding: 16, paddingBottom: 32 },
  h1: { color: "white", fontSize: 28, fontWeight: "800", marginBottom: 4 },

  section: {
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
  },
  sectionTitle: {
    color: "#DCE4FF",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },

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
    minWidth: 110,
  },
  btnPrimary: { backgroundColor: "#5B8CFF" },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3E4C78",
  },
  btnDanger: { backgroundColor: "#FB7185" },
  btnText: { color: "white", fontWeight: "800" },
  btnGhostText: { color: "#C8D3FF", fontWeight: "800" },
  disabled: { opacity: 0.45 },

  card: {
    backgroundColor: "#121A31",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27345C",
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: { color: "white", fontSize: 16, fontWeight: "700", marginBottom: 6 },
  meta: { color: "#93A3D9", fontSize: 12, lineHeight: 16 },
  metaSmall: { color: "#6F83C6", fontSize: 11, marginTop: 10 },

  empty: { color: "#9EB0E3", marginTop: 10 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: 16,
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "85%",
    backgroundColor: "#0B1020",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  modalTitle: { color: "white", fontSize: 18, fontWeight: "900" },
  modalClose: {
    backgroundColor: "#3E4C78",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalMeta: { color: "#B9C3E6", marginBottom: 10 },

  eventCard: {
    backgroundColor: "#121A31",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27345C",
    padding: 12,
  },
  eventTitle: { color: "white", fontSize: 14, fontWeight: "800" },
  eventMeta: { color: "#93A3D9", fontSize: 12, marginTop: 4 },
});
