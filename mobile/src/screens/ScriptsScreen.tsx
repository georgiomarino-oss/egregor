// mobile/src/screens/ScriptsScreen.tsx

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
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../supabase/client";
import type { Database } from "../types/db";

type ScriptRow = Database["public"]["Tables"]["scripts"]["Row"];
type ScriptInsert = Database["public"]["Tables"]["scripts"]["Insert"];
type EventRow = Database["public"]["Tables"]["events"]["Row"];

const RESYNC_MS = 60_000;
const SCRIPT_TITLE_MAX = 120;
const SCRIPT_INTENTION_MAX = 2000;
const SCRIPT_TONE_MAX = 40;
const SCRIPT_DURATION_MIN = 1;
const SCRIPT_DURATION_MAX = 240;

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sortScripts(rows: ScriptRow[]): ScriptRow[] {
  const copy = [...rows];
  copy.sort((a, b) => safeTimeMs(b.created_at) - safeTimeMs(a.created_at));
  return copy;
}

function sortEvents(rows: EventRow[]): EventRow[] {
  const copy = [...rows];
  copy.sort((a, b) => safeTimeMs(b.start_time_utc) - safeTimeMs(a.start_time_utc));
  return copy;
}

function upsertScriptRow(rows: ScriptRow[], next: ScriptRow): ScriptRow[] {
  const idx = rows.findIndex((r) => r.id === next.id);
  if (idx < 0) return sortScripts([...rows, next]);
  const copy = [...rows];
  copy[idx] = next;
  return sortScripts(copy);
}

function removeScriptRow(rows: ScriptRow[], scriptId: string): ScriptRow[] {
  if (!scriptId) return rows;
  return rows.filter((r) => r.id !== scriptId);
}

function upsertEventRow(rows: EventRow[], next: EventRow): EventRow[] {
  const idx = rows.findIndex((r) => r.id === next.id);
  if (idx < 0) return sortEvents([...rows, next]);
  const copy = [...rows];
  copy[idx] = next;
  return sortEvents(copy);
}

function removeEventRow(rows: EventRow[], eventId: string): EventRow[] {
  if (!eventId) return rows;
  return rows.filter((r) => r.id !== eventId);
}

function buildDefaultSections(durationMinutes: number, intentionText: string) {
  const mins = Math.max(1, Math.round(durationMinutes));

  if (mins <= 3) {
    return [{ name: "Guided Intention", minutes: mins, text: intentionText.trim() }];
  }

  let arrival = Math.max(1, Math.round(mins * 0.15));
  let intention = Math.max(1, Math.round(mins * 0.25));
  let closing = Math.max(1, Math.round(mins * 0.15));
  let silence = mins - arrival - intention - closing;

  while (silence < 1) {
    if (arrival > 1) {
      arrival -= 1;
      silence += 1;
      continue;
    }
    if (intention > 1) {
      intention -= 1;
      silence += 1;
      continue;
    }
    if (closing > 1) {
      closing -= 1;
      silence += 1;
      continue;
    }
    silence = 1;
    break;
  }

  return [
    { name: "Arrival", minutes: arrival, text: "Take a breath and arrive." },
    { name: "Intention", minutes: intention, text: intentionText.trim() },
    { name: "Silence", minutes: silence, text: "Hold the intention in silence." },
    { name: "Closing", minutes: closing, text: "Gently return and close." },
  ];
}

export default function ScriptsScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(false);
  const [myUserId, setMyUserId] = useState("");

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
  const [editOpen, setEditOpen] = useState(false);
  const [editScriptId, setEditScriptId] = useState<string>("");
  const [editTitle, setEditTitle] = useState("");
  const [editIntention, setEditIntention] = useState("");
  const [editDurationMinutes, setEditDurationMinutes] = useState("20");
  const [editTone, setEditTone] = useState("calm");

  const scriptsById = useMemo(() => {
    const map: Record<string, ScriptRow> = {};
    for (const s of scripts) map[s.id] = s;
    return map;
  }, [scripts]);

  const selectedScript = useMemo(
    () => scripts.find((s) => s.id === attachScriptId) ?? null,
    [scripts, attachScriptId]
  );
  const hostedUsageByScriptId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of myEvents) {
      const sid = e.script_id ?? "";
      if (!sid) continue;
      map[sid] = (map[sid] ?? 0) + 1;
    }
    return map;
  }, [myEvents]);
  const editingScript = useMemo(
    () => scripts.find((s) => s.id === editScriptId) ?? null,
    [scripts, editScriptId]
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
    setScripts(sortScripts((data ?? []) as ScriptRow[]));
  }, []);

  const loadMyUserId = useCallback(async () => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      setMyUserId("");
      return;
    }
    setMyUserId(user.id);
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
    setMyEvents(sortEvents((data ?? []) as EventRow[]));
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadMyUserId(), loadScripts(), loadMyHostedEvents()]);
    } finally {
      setLoading(false);
    }
  }, [loadMyHostedEvents, loadMyUserId, loadScripts]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (attachOpen && attachScriptId && !scripts.some((s) => s.id === attachScriptId)) {
      setAttachOpen(false);
      setAttachScriptId("");
    }
    if (editOpen && editScriptId && !scripts.some((s) => s.id === editScriptId)) {
      setEditOpen(false);
      setEditScriptId("");
    }
  }, [scripts, attachOpen, attachScriptId, editOpen, editScriptId]);

  useEffect(() => {
    let disposed = false;
    const resync = () => {
      if (disposed) return;
      void loadScripts();
    };

    resync();
    const intervalId = setInterval(resync, RESYNC_MS);

    const channel = supabase
      .channel("scripts:list")
      .on("postgres_changes", { event: "*", schema: "public", table: "scripts" }, (payload) => {
        const eventType = String((payload as any).eventType ?? "");
        const next = ((payload as any).new ?? null) as ScriptRow | null;
        const prev = ((payload as any).old ?? null) as ScriptRow | null;

        setScripts((rows) => {
          if (eventType === "DELETE") {
            const scriptId = String((prev as any)?.id ?? "");
            return removeScriptRow(rows, scriptId);
          }
          if (!next) return rows;
          return upsertScriptRow(rows, next);
        });
      })
      .subscribe();

    return () => {
      disposed = true;
      clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [loadScripts]);

  useEffect(() => {
    if (!myUserId) return;

    let disposed = false;
    const resync = () => {
      if (disposed) return;
      void loadMyHostedEvents();
    };

    resync();
    const intervalId = setInterval(resync, RESYNC_MS);

    const channel = supabase
      .channel(`events:hosted:${myUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events", filter: `host_user_id=eq.${myUserId}` },
        (payload) => {
          const eventType = String((payload as any).eventType ?? "");
          const next = ((payload as any).new ?? null) as EventRow | null;
          const prev = ((payload as any).old ?? null) as EventRow | null;

          setMyEvents((rows) => {
            if (eventType === "DELETE") {
              const eventId = String((prev as any)?.id ?? "");
              return removeEventRow(rows, eventId);
            }
            if (!next) return rows;
            return upsertEventRow(rows, next);
          });
        }
      )
      .subscribe();

    return () => {
      disposed = true;
      clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [myUserId, loadMyHostedEvents]);

  const handleCreateScript = useCallback(async () => {
    const mins = Number(durationMinutes);
    const titleText = title.trim();
    const intentionText = intention.trim();
    const toneText = tone.trim().toLowerCase();

    if (!titleText) return Alert.alert("Validation", "Title is required.");
    if (titleText.length > SCRIPT_TITLE_MAX) {
      return Alert.alert("Validation", `Title must be ${SCRIPT_TITLE_MAX} characters or fewer.`);
    }
    if (!intentionText) return Alert.alert("Validation", "Intention is required.");
    if (intentionText.length > SCRIPT_INTENTION_MAX) {
      return Alert.alert("Validation", `Intention must be ${SCRIPT_INTENTION_MAX} characters or fewer.`);
    }
    if (!toneText) return Alert.alert("Validation", "Tone is required.");
    if (toneText.length > SCRIPT_TONE_MAX) {
      return Alert.alert("Validation", `Tone must be ${SCRIPT_TONE_MAX} characters or fewer.`);
    }
    if (!/^[a-z][a-z0-9 _-]*$/.test(toneText)) {
      return Alert.alert("Validation", "Tone can contain lowercase letters, numbers, spaces, '_' and '-'.");
    }
    if (!Number.isFinite(mins) || mins < SCRIPT_DURATION_MIN || mins > SCRIPT_DURATION_MAX) {
      return Alert.alert(
        "Validation",
        `Duration must be between ${SCRIPT_DURATION_MIN} and ${SCRIPT_DURATION_MAX} minutes.`
      );
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
        author_user_id: user.id as any,
        title: titleText,
        intention: intentionText,
        duration_minutes: mins as any,
        tone: toneText as any,
        content_json: {
          title: titleText,
          durationMinutes: mins,
          tone: toneText,
          sections: buildDefaultSections(mins, intentionText),
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
      await loadMyHostedEvents();
    },
    [loadMyHostedEvents]
  );

  const openEditScript = useCallback((script: ScriptRow) => {
    setEditScriptId(script.id);
    setEditTitle(String((script as any).title ?? ""));
    setEditIntention(String((script as any).intention ?? ""));
    setEditDurationMinutes(String((script as any).duration_minutes ?? "20"));
    setEditTone(String((script as any).tone ?? "calm"));
    setEditOpen(true);
  }, []);

  const saveScriptEdit = useCallback(async () => {
    if (!editingScript) return;

    const mins = Number(editDurationMinutes);
    const titleText = editTitle.trim();
    const intentionText = editIntention.trim();
    const toneText = editTone.trim().toLowerCase();

    if (!titleText) return Alert.alert("Validation", "Title is required.");
    if (titleText.length > SCRIPT_TITLE_MAX) {
      return Alert.alert("Validation", `Title must be ${SCRIPT_TITLE_MAX} characters or fewer.`);
    }
    if (!intentionText) return Alert.alert("Validation", "Intention is required.");
    if (intentionText.length > SCRIPT_INTENTION_MAX) {
      return Alert.alert("Validation", `Intention must be ${SCRIPT_INTENTION_MAX} characters or fewer.`);
    }
    if (!toneText) return Alert.alert("Validation", "Tone is required.");
    if (toneText.length > SCRIPT_TONE_MAX) {
      return Alert.alert("Validation", `Tone must be ${SCRIPT_TONE_MAX} characters or fewer.`);
    }
    if (!/^[a-z][a-z0-9 _-]*$/.test(toneText)) {
      return Alert.alert("Validation", "Tone can contain lowercase letters, numbers, spaces, '_' and '-'.");
    }
    if (!Number.isFinite(mins) || mins < SCRIPT_DURATION_MIN || mins > SCRIPT_DURATION_MAX) {
      return Alert.alert(
        "Validation",
        `Duration must be between ${SCRIPT_DURATION_MIN} and ${SCRIPT_DURATION_MAX} minutes.`
      );
    }

    setLoading(true);
    try {
      const payload = {
        title: titleText,
        intention: intentionText,
        duration_minutes: mins,
        tone: toneText,
        content_json: {
          title: titleText,
          durationMinutes: mins,
          tone: toneText,
          sections: buildDefaultSections(mins, intentionText),
        },
      };

      const { error } = await supabase.from("scripts").update(payload as any).eq("id", editingScript.id);
      if (error) {
        Alert.alert("Update failed", error.message);
        return;
      }
      setEditOpen(false);
      setEditScriptId("");
      await refreshAll();
      Alert.alert("Updated", "Script saved.");
    } finally {
      setLoading(false);
    }
  }, [editDurationMinutes, editIntention, editTitle, editTone, editingScript, refreshAll]);

  const handleDeleteScript = useCallback(
    async (script: ScriptRow) => {
      const attachedCount = myEvents.filter((e) => e.script_id === script.id).length;
      if (attachedCount > 0) {
        Alert.alert(
          "Cannot delete",
          `This script is attached to ${attachedCount} hosted event${attachedCount === 1 ? "" : "s"}. Detach it first.`
        );
        return;
      }

      Alert.alert("Delete script?", `Delete "${script.title ?? "Untitled"}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.from("scripts").delete().eq("id", script.id);
              if (error) {
                Alert.alert("Delete failed", error.message);
                return;
              }
              await refreshAll();
              Alert.alert("Deleted", "Script removed.");
            } finally {
              setLoading(false);
            }
          },
        },
      ]);
    },
    [myEvents, refreshAll]
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

  const goProfile = useCallback(() => {
    navigation.navigate("Profile");
  }, [navigation]);

  const renderScript = ({ item }: { item: ScriptRow }) => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{(item as any).title ?? "Untitled"}</Text>

      {"tone" in (item as any) ? <Text style={styles.meta}>Tone: {(item as any).tone}</Text> : null}

      {"duration_minutes" in (item as any) ? (
        <Text style={styles.meta}>Duration: {(item as any).duration_minutes} min</Text>
      ) : null}

      {"intention" in (item as any) ? (
        <Text style={styles.meta} numberOfLines={2}>
          Intention: {(item as any).intention}
        </Text>
      ) : null}

      <Text style={styles.meta}>
        Used by hosted events: {hostedUsageByScriptId[item.id] ?? 0}
      </Text>

      <View style={styles.row}>
        <Pressable
          onPress={() => openEditScript(item)}
          style={[styles.btn, styles.btnGhost, loading && styles.disabled]}
          disabled={loading}
        >
          <Text style={styles.btnGhostText}>Edit</Text>
        </Pressable>

        <Pressable
          onPress={() => openAttachForScript(item.id)}
          style={[styles.btn, styles.btnPrimary, loading && styles.disabled]}
          disabled={loading}
        >
          <Text style={styles.btnText}>Attach to event</Text>
        </Pressable>

        <Pressable
          onPress={() => handleDeleteScript(item)}
          style={[styles.btn, styles.btnDanger, loading && styles.disabled]}
          disabled={loading}
        >
          <Text style={styles.btnText}>Delete</Text>
        </Pressable>
      </View>

      <Text style={styles.metaSmall}>ID: {item.id}</Text>
    </View>
  );

  const renderEventRow = ({ item }: { item: EventRow }) => {
    const isUsingSelected = !!attachScriptId && item.script_id === attachScriptId;

    const currentTitle =
      item.script_id ? scriptsById[item.script_id]?.title ?? item.script_id : "(none)";

    const attachLabel = isUsingSelected ? "Attached" : item.script_id ? "Replace" : "Attach";

    return (
      <View style={styles.eventCard}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {item.title}
        </Text>

        <Text style={styles.eventMeta} numberOfLines={1}>
          {new Date(item.start_time_utc).toLocaleString()} ({item.timezone ?? "UTC"})
        </Text>

        <Text style={styles.eventMeta} numberOfLines={1}>
          Current: <Text style={{ color: "white", fontWeight: "800" }}>{currentTitle}</Text>
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
            style={[styles.btn, styles.btnDanger, (loading || !item.script_id) && styles.disabled]}
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
        refreshing={loading}
        onRefresh={refreshAll}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <View style={styles.headerRow}>
              <Text style={styles.h1}>Scripts</Text>

              <Pressable onPress={goProfile} style={styles.headerBtn}>
                <Text style={styles.headerBtnText}>Profile</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Create Script</Text>

              <Text style={styles.label}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                style={styles.input}
                placeholder="Script title"
                placeholderTextColor="#6B7BB2"
                maxLength={SCRIPT_TITLE_MAX}
              />
              <Text style={styles.meta}>{title.trim().length}/{SCRIPT_TITLE_MAX}</Text>

              <Text style={styles.label}>Intention</Text>
              <TextInput
                value={intention}
                onChangeText={setIntention}
                style={[styles.input, styles.multi]}
                multiline
                placeholder="What is this script for?"
                placeholderTextColor="#6B7BB2"
                maxLength={SCRIPT_INTENTION_MAX}
              />
              <Text style={styles.meta}>{intention.trim().length}/{SCRIPT_INTENTION_MAX}</Text>

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
                    maxLength={3}
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
                    maxLength={SCRIPT_TONE_MAX}
                  />
                </View>
              </View>

              <View style={styles.row}>
                <Pressable
                  onPress={handleCreateScript}
                  style={[styles.btn, styles.btnPrimary, loading && styles.disabled]}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>{loading ? "Working..." : "Create script"}</Text>
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
                Tap "Attach to event" on a script, then choose one of your hosted events.
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
              placeholder="Search your events (title, description, current script)"
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

      <Modal
        visible={editOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Script</Text>
              <Pressable onPress={() => setEditOpen(false)} style={styles.modalClose} disabled={loading}>
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>Title</Text>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              style={styles.input}
              placeholder="Script title"
              placeholderTextColor="#6B7BB2"
              maxLength={SCRIPT_TITLE_MAX}
            />
            <Text style={styles.meta}>{editTitle.trim().length}/{SCRIPT_TITLE_MAX}</Text>

            <Text style={styles.label}>Intention</Text>
            <TextInput
              value={editIntention}
              onChangeText={setEditIntention}
              style={[styles.input, styles.multi]}
              multiline
              placeholder="What is this script for?"
              placeholderTextColor="#6B7BB2"
              maxLength={SCRIPT_INTENTION_MAX}
            />
            <Text style={styles.meta}>{editIntention.trim().length}/{SCRIPT_INTENTION_MAX}</Text>

            <View style={styles.row}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Text style={styles.label}>Duration (minutes)</Text>
                <TextInput
                  value={editDurationMinutes}
                  onChangeText={setEditDurationMinutes}
                  keyboardType="numeric"
                  style={styles.input}
                  placeholder="20"
                  placeholderTextColor="#6B7BB2"
                  maxLength={3}
                />
              </View>

              <View style={{ flex: 1, minWidth: 140 }}>
                <Text style={styles.label}>Tone</Text>
                <TextInput
                  value={editTone}
                  onChangeText={setEditTone}
                  style={styles.input}
                  placeholder="calm"
                  placeholderTextColor="#6B7BB2"
                  maxLength={SCRIPT_TONE_MAX}
                />
              </View>
            </View>

            <View style={styles.row}>
              <Pressable
                onPress={saveScriptEdit}
                style={[styles.btn, styles.btnPrimary, loading && styles.disabled]}
                disabled={loading || !editingScript}
              >
                <Text style={styles.btnText}>{loading ? "Working..." : "Save changes"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    gap: 12,
  },
  h1: { color: "white", fontSize: 28, fontWeight: "800" },

  headerBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3E4C78",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  headerBtnText: { color: "#C8D3FF", fontWeight: "900" },

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

