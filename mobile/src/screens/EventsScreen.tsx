import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useNavigation } from "@react-navigation/native";

import { supabase } from "../supabase/client";
import type { Database } from "../types/db";
import type { RootStackParamList } from "../types";

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

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

export default function EventsScreen() {
  // IMPORTANT:
  // EventsScreen is inside Tabs. We must navigate to EventRoom using the PARENT Stack navigator,
  // otherwise params can be missing and EventRoom shows "missing or invalid event id".
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);

  const [myUserId, setMyUserId] = useState<string>("");

  // Scripts for display (id -> title) + picker list
  const [scriptsById, setScriptsById] = useState<Record<string, ScriptRow>>({});
  const [myScripts, setMyScripts] = useState<ScriptRow[]>([]);

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

  // Attach modal state
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachEventId, setAttachEventId] = useState<string>("");
  const [scriptQuery, setScriptQuery] = useState("");

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const attachEvent = useMemo(
    () => events.find((e) => e.id === attachEventId) ?? null,
    [events, attachEventId]
  );

  const filteredScripts = useMemo(() => {
    const q = scriptQuery.trim().toLowerCase();
    if (!q) return myScripts;

    return myScripts.filter((s) => {
      const t = String((s as any).title ?? "").toLowerCase();
      const i = String((s as any).intention ?? "").toLowerCase();
      return t.includes(q) || i.includes(q);
    });
  }, [myScripts, scriptQuery]);

  const loadMyUserId = useCallback(async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return;
    setMyUserId(user.id);
  }, []);

  const loadScriptsForDisplay = useCallback(async () => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return;

    // NOTE: we only need scripts that THIS USER can see (RLS).
    const { data, error } = await supabase
      .from("scripts")
      .select("id,title,intention,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      // non-fatal; we can still display ids
      return;
    }

    const rows = (data ?? []) as ScriptRow[];
    const map: Record<string, ScriptRow> = {};
    for (const s of rows) map[s.id] = s;

    setScriptsById(map);
    setMyScripts(rows);
  }, []);

  const loadEvents = useCallback(async () => {
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

    if (error) {
      Alert.alert("Load events failed", error.message);
      return;
    }

    const rows = (data ?? []) as EventRow[];
    setEvents(rows);

    // keep selection stable
    if (!selectedEventId && rows.length > 0) {
      setSelectedEventId(rows[0].id);
    } else if (selectedEventId && !rows.some((r) => r.id === selectedEventId)) {
      setSelectedEventId(rows[0]?.id ?? "");
    }

    // If modal is open and the event disappeared due to RLS / delete, close it
    if (attachOpen && attachEventId && !rows.some((r) => r.id === attachEventId)) {
      setAttachOpen(false);
      setAttachEventId("");
    }
  }, [attachEventId, attachOpen, selectedEventId]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadMyUserId(), loadEvents(), loadScriptsForDisplay()]);
    } finally {
      setLoading(false);
    }
  }, [loadEvents, loadMyUserId, loadScriptsForDisplay]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Realtime updates from events table
  useEffect(() => {
    const channel = supabase
      .channel("events:list")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, async () => {
        await loadEvents();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadEvents]);

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

  // Heartbeat while joined (presence only)
  useEffect(() => {
    if (!isJoined || !selectedEventId) return;

    const id = setInterval(async () => {
      try {
        await upsertPresence(selectedEventId);
      } catch {
        // best-effort
      }
    }, 10_000);

    return () => clearInterval(id);
  }, [isJoined, selectedEventId, upsertPresence]);

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

      if (error) {
        Alert.alert("Create event failed", error.message);
        return;
      }

      Alert.alert("Success", "Event created.");
      await refreshAll();
    } catch (e: any) {
      Alert.alert("Create event failed", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [title, description, intention, startLocal, endLocal, timezone, refreshAll]);

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
    } catch (e: any) {
      setPresenceError(e?.message ?? "Failed to join");
    }
  }, [selectedEventId, upsertPresence]);

  const handleLeave = useCallback(async () => {
    try {
      setPresenceError("");
      setPresenceStatus("");

      if (!selectedEventId) return;

      const { data } = await supabase.auth.getUser();
      const user = data.user;

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
    } catch (e: any) {
      setPresenceError(e?.message ?? "Failed to leave");
    }
  }, [selectedEventId]);

  const openRoom = useCallback(
    (eventId: string) => {
      if (!eventId || !isLikelyUuid(eventId)) {
        Alert.alert("Invalid event", "This event id is missing or invalid.");
        return;
      }

      // Navigate using the parent Stack navigator so EventRoom receives params reliably.
      const parent = navigation.getParent?.();
      const navToUse = parent ?? navigation;

      (navToUse as any).navigate("EventRoom" as keyof RootStackParamList, { eventId });
    },
    [navigation]
  );

  const getScriptLabel = (scriptId: string | null) => {
    if (!scriptId) return "(none)";
    const t = scriptsById[scriptId]?.title;
    return t ? t : scriptId;
  };

  // ---- Attach UX (Events tab) ----

  const openAttachForEvent = useCallback(
    async (eventId: string) => {
      if (!eventId || !isLikelyUuid(eventId)) return;

      setAttachEventId(eventId);
      setScriptQuery("");
      setAttachOpen(true);

      await loadScriptsForDisplay();
    },
    [loadScriptsForDisplay]
  );

  const updateEventScript = useCallback(
    async (event: EventRow, nextScriptId: string | null) => {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      if (event.host_user_id !== user.id) {
        Alert.alert("Not allowed", "Only the host can change this event’s script.");
        return;
      }

      setLoading(true);
      try {
        const { error } = await supabase
          .from("events")
          .update({ script_id: nextScriptId })
          .eq("id", event.id);

        if (error) {
          Alert.alert("Update failed", error.message);
          return;
        }

        await loadEvents();
      } finally {
        setLoading(false);
      }
    },
    [loadEvents]
  );

  const attachOrReplace = useCallback(
    async (scriptId: string) => {
      if (!attachEvent) return;

      if (attachEvent.script_id === scriptId) {
        Alert.alert("Already attached", "This event already uses that script.");
        return;
      }

      if (attachEvent.script_id && attachEvent.script_id !== scriptId) {
        Alert.alert("Replace script?", "This event already has a script attached. Replace it?", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Replace",
            style: "destructive",
            onPress: async () => {
              await updateEventScript(attachEvent, scriptId);
              setAttachOpen(false);
            },
          },
        ]);
        return;
      }

      await updateEventScript(attachEvent, scriptId);
      setAttachOpen(false);
    },
    [attachEvent, updateEventScript]
  );

  const detach = useCallback(async () => {
    if (!attachEvent) return;
    if (!attachEvent.script_id) return;

    Alert.alert("Detach script?", "Remove the script from this event?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Detach",
        style: "destructive",
        onPress: async () => {
          await updateEventScript(attachEvent, null);
          setAttachOpen(false);
        },
      },
    ]);
  }, [attachEvent, updateEventScript]);

  const renderScriptRow = ({ item }: { item: ScriptRow }) => {
    const isSelected = !!attachEvent?.script_id && attachEvent.script_id === item.id;

    return (
      <View style={styles.pickerCard}>
        <Text style={styles.pickerTitle} numberOfLines={1}>
          {(item as any).title ?? "Untitled"}
        </Text>
        {(item as any).intention ? (
          <Text style={styles.pickerMeta} numberOfLines={2}>
            {(item as any).intention}
          </Text>
        ) : null}

        <View style={styles.row}>
          <Pressable
            onPress={() => attachOrReplace(item.id)}
            style={[
              styles.btn,
              isSelected ? styles.btnGhost : styles.btnPrimary,
              (loading || !attachEvent) && styles.disabled,
            ]}
            disabled={loading || !attachEvent}
          >
            <Text style={isSelected ? styles.btnGhostText : styles.btnText}>
              {isSelected ? "Currently Attached" : "Attach"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderEvent = ({ item }: { item: EventRow }) => {
    const isHost = !!myUserId && item.host_user_id === myUserId;

    return (
      <Pressable
        onPress={() => setSelectedEventId(item.id)}
        style={[
          styles.card,
          item.id === selectedEventId ? styles.cardSelected : undefined,
        ]}
      >
        <View style={styles.cardTopRow}>
          <Text style={styles.cardTitle}>{item.title}</Text>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => openRoom(item.id)}
              style={[styles.smallBtn, styles.smallBtnPrimary]}
            >
              <Text style={styles.smallBtnText}>Open</Text>
            </Pressable>

            {isHost ? (
              <Pressable
                onPress={() => openAttachForEvent(item.id)}
                style={[styles.smallBtn, styles.smallBtnGhost, loading && styles.disabled]}
                disabled={loading}
              >
                <Text style={styles.smallBtnGhostText}>
                  {item.script_id ? "Change" : "Attach"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

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
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
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
                  onPress={refreshAll}
                  disabled={loading}
                >
                  <Text style={styles.btnGhostText}>Refresh</Text>
                </Pressable>

                {loading ? <ActivityIndicator /> : null}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Live Presence</Text>
              <Text style={styles.meta}>Selected: {selectedEvent ? selectedEvent.title : "(none)"}</Text>

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

                <Pressable
                  style={[styles.btn, styles.btnGhost, !selectedEventId && styles.disabled]}
                  onPress={() => {
                    if (!selectedEventId) {
                      Alert.alert("Select event", "Please select an event first.");
                      return;
                    }
                    openRoom(selectedEventId);
                  }}
                  disabled={!selectedEventId}
                >
                  <Text style={styles.btnGhostText}>Open room</Text>
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

      {/* Attach Script Modal */}
      <Modal
        visible={attachOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Event Script</Text>
              <Pressable
                onPress={() => setAttachOpen(false)}
                style={styles.modalClose}
                disabled={loading}
              >
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>

            {attachEvent ? (
              <>
                <Text style={styles.modalMeta}>
                  Event:{" "}
                  <Text style={{ fontWeight: "900", color: "white" }}>
                    {attachEvent.title}
                  </Text>
                </Text>

                <Text style={styles.modalMeta}>
                  Current:{" "}
                  <Text style={{ fontWeight: "900", color: "white" }}>
                    {attachEvent.script_id ? getScriptLabel(attachEvent.script_id) : "(none)"}
                  </Text>
                </Text>

                <View style={styles.row}>
                  <Pressable
                    onPress={detach}
                    style={[
                      styles.btn,
                      styles.btnDanger,
                      (!attachEvent.script_id || loading) && styles.disabled,
                    ]}
                    disabled={!attachEvent.script_id || loading}
                  >
                    <Text style={styles.btnText}>Detach</Text>
                  </Pressable>

                  <Pressable
                    onPress={loadScriptsForDisplay}
                    style={[styles.btn, styles.btnGhost, loading && styles.disabled]}
                    disabled={loading}
                  >
                    <Text style={styles.btnGhostText}>Refresh scripts</Text>
                  </Pressable>
                </View>

                <TextInput
                  value={scriptQuery}
                  onChangeText={setScriptQuery}
                  style={styles.input}
                  placeholder="Search your scripts…"
                  placeholderTextColor="#6B7BB2"
                />

                {myScripts.length === 0 ? (
                  <Text style={styles.empty}>No scripts found. Create one in Scripts first.</Text>
                ) : (
                  <FlatList
                    data={filteredScripts}
                    keyExtractor={(s) => s.id}
                    renderItem={renderScriptRow}
                    contentContainerStyle={{ paddingTop: 10, paddingBottom: 6, gap: 10 }}
                  />
                )}
              </>
            ) : (
              <Text style={styles.empty}>No event selected.</Text>
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

  row: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    flexWrap: "wrap",
    alignItems: "center",
  },

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
  btnDanger: { backgroundColor: "#FB7185" },
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
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
    flex: 1,
  },
  cardText: { color: "#C6D0F5", marginBottom: 6 },
  meta: { color: "#93A3D9", fontSize: 12 },

  smallBtn: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnPrimary: { backgroundColor: "#5B8CFF" },
  smallBtnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3E4C78",
  },
  smallBtnText: { color: "white", fontWeight: "800" },
  smallBtnGhostText: { color: "#C8D3FF", fontWeight: "800" },

  ok: { color: "#6EE7B7", marginTop: 8 },
  err: { color: "#FB7185", marginTop: 8 },
  empty: { color: "#9EB0E3", marginTop: 8 },

  // Modal
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

  // Picker cards (scripts list)
  pickerCard: {
    backgroundColor: "#121A31",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27345C",
    padding: 12,
  },
  pickerTitle: { color: "white", fontSize: 14, fontWeight: "800" },
  pickerMeta: { color: "#93A3D9", fontSize: 12, marginTop: 4 },
});
