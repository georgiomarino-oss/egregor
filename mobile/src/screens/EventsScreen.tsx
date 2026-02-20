// mobile/src/screens/EventsScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  FlatList,
  Modal,
  Pressable,
  Share,
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
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type ScriptRow = Database["public"]["Tables"]["scripts"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileMini = Pick<ProfileRow, "id" | "display_name" | "avatar_url">;

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

function isoToLocalInput(iso: string | null | undefined) {
  if (!iso) return plusMinutesToLocalInput(10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return plusMinutesToLocalInput(10);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
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

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function defaultTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.trim() ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

function isValidTimezone(value: string) {
  const tz = value.trim();
  if (!tz) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function upsertEventRow(rows: EventRow[], next: EventRow): EventRow[] {
  const idx = rows.findIndex((r) => r.id === next.id);
  if (idx < 0) return [...rows, next];
  const copy = [...rows];
  copy[idx] = next;
  return copy;
}

function removeEventRow(rows: EventRow[], eventId: string): EventRow[] {
  if (!eventId) return rows;
  return rows.filter((r) => r.id !== eventId);
}

const EVENTS_RESYNC_MS = 60_000;
const EVENT_TITLE_MAX = 120;
const EVENT_INTENTION_MAX = 2000;
const EVENT_DESCRIPTION_MAX = 4000;
const EVENT_CATEGORIES = ["All", "Healing", "Abundance", "Peace", "Love", "Protection"] as const;
type EventCategory = (typeof EVENT_CATEGORIES)[number];
const CATEGORY_KEYWORDS: Record<Exclude<EventCategory, "All">, string[]> = {
  Healing: ["heal", "healing", "recover", "recovery", "health", "restoration", "strength"],
  Abundance: ["abundance", "prosper", "prosperity", "wealth", "success", "career", "opportunity"],
  Peace: ["peace", "calm", "stillness", "harmony", "resolution", "unity", "ceasefire"],
  Love: ["love", "compassion", "kindness", "heart", "forgiveness", "connection", "relationship"],
  Protection: ["protection", "safety", "shield", "secure", "resilience", "courage", "guard"],
};

function formatWhenLabel(event: EventRow, nowMs: number) {
  const startMs = safeTimeMs((event as any).start_time_utc);
  const endMs = safeTimeMs((event as any).end_time_utc);

  if (!startMs) return { text: "Unknown time", kind: "neutral" as const };

  const isLive = startMs <= nowMs && (!!endMs ? nowMs <= endMs : true);
  if (isLive) return { text: "LIVE", kind: "live" as const };

  const minsToStart = Math.round((startMs - nowMs) / 60_000);

  if (minsToStart <= 5 && minsToStart >= -5) return { text: "Starting now", kind: "soon" as const };
  if (minsToStart <= 30 && minsToStart > 5) return { text: "Soon", kind: "soon" as const };

  const dStart = new Date(startMs);
  const dNow = new Date(nowMs);
  const isSameDay =
    dStart.getFullYear() === dNow.getFullYear() &&
    dStart.getMonth() === dNow.getMonth() &&
    dStart.getDate() === dNow.getDate();

  const endOrStart = endMs || startMs;
  if (endOrStart && endOrStart < nowMs) return { text: "Past", kind: "past" as const };

  if (isSameDay) return { text: "Today", kind: "today" as const };

  return { text: "Upcoming", kind: "upcoming" as const };
}

export default function EventsScreen() {
  // IMPORTANT:
  // EventsScreen is inside Tabs. We must navigate to EventRoom using the PARENT Stack navigator,
  // otherwise params can be missing and EventRoom shows "missing or invalid event id".
  const navigation = useNavigation<any>();
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);

  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);

  const [myUserId, setMyUserId] = useState<string>("");

  // Scripts for display (id -> title) + picker list
  const [scriptsById, setScriptsById] = useState<Record<string, ScriptRow>>({});
  const [myScripts, setMyScripts] = useState<ScriptRow[]>([]);

  // Profiles cache for host display names
  const [profilesById, setProfilesById] = useState<Record<string, ProfileMini>>({});
  const profilesByIdRef = React.useRef<Record<string, ProfileMini>>({});
  useEffect(() => {
    profilesByIdRef.current = profilesById;
  }, [profilesById]);

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
  const [timezone, setTimezone] = useState(defaultTimezone());

  // Presence (quick join from list header)
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [isJoined, setIsJoined] = useState(false);
  const [joinedEventId, setJoinedEventId] = useState<string>("");
  const [presenceStatus, setPresenceStatus] = useState("");
  const [presenceError, setPresenceError] = useState("");
  const [energyStatus, setEnergyStatus] = useState("");
  const [energyError, setEnergyError] = useState("");
  const [sendingEnergy, setSendingEnergy] = useState<number | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  // Filters
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [hostedOnly, setHostedOnly] = useState(false);
  const [eventQuery, setEventQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<EventCategory>("All");

  // Attach modal state
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachEventId, setAttachEventId] = useState<string>("");
  const [scriptQuery, setScriptQuery] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editEventId, setEditEventId] = useState<string>("");
  const [editTitle, setEditTitle] = useState("");
  const [editIntention, setEditIntention] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartLocal, setEditStartLocal] = useState("");
  const [editEndLocal, setEditEndLocal] = useState("");
  const [editTimezone, setEditTimezone] = useState(defaultTimezone());

  // Ticker: refresh LIVE/Soon/Today labels + sorting while screen is open
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Header button: Profile
  useEffect(() => {
    navigation.setOptions?.({
      headerRight: () => (
        <Pressable
          onPress={() => {
            // Profile is a hidden tab route; we can navigate to it reliably
            navigation.navigate("Profile");
          }}
          style={[styles.headerBtn, { borderColor: c.border }]}
        >
          <Text style={[styles.headerBtnText, { color: c.text }]}>Profile</Text>
        </Pressable>
      ),
    });
  }, [navigation, c.border, c.text]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );
  const joinedEvent = useMemo(
    () => (joinedEventId ? events.find((e) => e.id === joinedEventId) ?? null : null),
    [events, joinedEventId]
  );

  const attachEvent = useMemo(
    () => events.find((e) => e.id === attachEventId) ?? null,
    [events, attachEventId]
  );
  const editEvent = useMemo(
    () => events.find((e) => e.id === editEventId) ?? null,
    [events, editEventId]
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

  const loadProfiles = useCallback(async (ids: string[]) => {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (uniq.length === 0) return;

    // Use functional update safety: read current state once
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

  const displayNameForUserId = useCallback(
    (id: string) => {
      if (!id) return "";
      if (id === myUserId) return "You";
      const p = profilesById[id];
      const name = (p?.display_name ?? "").trim();
      return name.length > 0 ? name : shortId(id);
    },
    [myUserId, profilesById]
  );

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

    // Fetch host profiles for display
    void loadProfiles(rows.map((r) => (r as any).host_user_id as string));
  }, [loadProfiles]);

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

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppState(next);
    });
    return () => {
      sub.remove();
    };
  }, []);

  const [lastSelectedEventId, setLastSelectedEventId] = useState<string>("");
  useEffect(() => {
    if (!lastSelectedEventId) {
      setLastSelectedEventId(selectedEventId);
      return;
    }
    if (selectedEventId !== lastSelectedEventId) {
      if (joinedEventId && myUserId && lastSelectedEventId && joinedEventId === lastSelectedEventId) {
        void supabase
          .from("event_presence")
          .delete()
          .eq("event_id", lastSelectedEventId)
          .eq("user_id", myUserId);
        setPresenceStatus("Left previous live event after selection change.");
        setJoinedEventId("");
      }
      setIsJoined(false);
      setPresenceError("");
      setLastSelectedEventId(selectedEventId);
    }
  }, [selectedEventId, lastSelectedEventId, joinedEventId, myUserId]);

  useEffect(() => {
    if (!selectedEventId && events.length > 0) {
      setSelectedEventId(events[0].id);
      return;
    }
    if (selectedEventId && !events.some((r) => r.id === selectedEventId)) {
      setSelectedEventId(events[0]?.id ?? "");
      setIsJoined(false);
      if (joinedEventId === selectedEventId) setJoinedEventId("");
    }
    if (attachOpen && attachEventId && !events.some((r) => r.id === attachEventId)) {
      setAttachOpen(false);
      setAttachEventId("");
    }
    if (editOpen && editEventId && !events.some((r) => r.id === editEventId)) {
      setEditOpen(false);
      setEditEventId("");
    }
  }, [events, selectedEventId, attachOpen, attachEventId, editOpen, editEventId, joinedEventId]);

  useEffect(() => {
    if (!selectedEventId || !myUserId) {
      setIsJoined(false);
      return;
    }

    let cancelled = false;

    const loadSelectedJoinState = async () => {
      const { data, error } = await supabase
        .from("event_presence")
        .select("event_id,user_id")
        .eq("event_id", selectedEventId)
        .eq("user_id", myUserId)
        .maybeSingle();

      if (cancelled || error) return;
      const joined = !!data;
      setIsJoined(joined);
      if (joined) setJoinedEventId(selectedEventId);
      else if (joinedEventId === selectedEventId) setJoinedEventId("");
    };

    void loadSelectedJoinState();

    const channel = supabase
      .channel(`events:selected-presence:${selectedEventId}:${myUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_presence",
          filter: `event_id=eq.${selectedEventId}`,
        },
        (payload) => {
          const eventType = String((payload as any).eventType ?? "");
          const next = (payload as any).new ?? null;
          const prev = (payload as any).old ?? null;
          const rowUserId = String((next as any)?.user_id ?? (prev as any)?.user_id ?? "");
          if (rowUserId !== myUserId) return;

          if (eventType === "DELETE") {
            setIsJoined(false);
            if (joinedEventId === selectedEventId) setJoinedEventId("");
            return;
          }
          setIsJoined(true);
          setJoinedEventId(selectedEventId);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [selectedEventId, myUserId, joinedEventId]);

  // Realtime updates from events table
  useEffect(() => {
    let disposed = false;
    const resync = () => {
      if (disposed) return;
      void loadEvents();
    };

    resync();
    const intervalId = setInterval(resync, EVENTS_RESYNC_MS);

    const channel = supabase
      .channel("events:list")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, (payload) => {
        const eventType = String((payload as any).eventType ?? "");
        const next = ((payload as any).new ?? null) as EventRow | null;
        const prev = ((payload as any).old ?? null) as EventRow | null;

        setEvents((rows) => {
          if (eventType === "DELETE") {
            const eventId = String((prev as any)?.id ?? "");
            return removeEventRow(rows, eventId);
          }
          if (!next) return rows;
          return upsertEventRow(rows, next);
        });

        const hostUserId = String((next as any)?.host_user_id ?? (prev as any)?.host_user_id ?? "");
        if (hostUserId) void loadProfiles([hostUserId]);
      })
      .subscribe();

    return () => {
      disposed = true;
      clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [loadEvents, loadProfiles]);

  // Presence upsert (heartbeat-safe): NEVER send created_at from the client
  const upsertPresence = useCallback(async (eventId: string) => {
    let uid = myUserId;
    if (!uid) {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr || !user) throw new Error("Not signed in.");
      uid = user.id;
      setMyUserId(uid);
    }

    const now = new Date().toISOString();

    const { error } = await supabase.from("event_presence").upsert(
      {
        event_id: eventId,
        user_id: uid,
        last_seen_at: now,
      },
      { onConflict: "event_id,user_id" }
    );

    if (error) throw error;
  }, [myUserId]);

  // Heartbeat while joined (presence only)
  useEffect(() => {
    if (!isJoined || !joinedEventId) return;
    if (appState !== "active") return;

    const id = setInterval(async () => {
      try {
        await upsertPresence(joinedEventId);
      } catch {
        // best-effort
      }
    }, 10_000);

    return () => clearInterval(id);
  }, [isJoined, joinedEventId, upsertPresence, appState]);

  const handleCreateEvent = useCallback(async () => {
    try {
      const titleText = title.trim();
      const intentionText = intention.trim();
      const descriptionText = description.trim();

      if (!titleText) {
        Alert.alert("Validation", "Title is required.");
        return;
      }
      if (titleText.length > EVENT_TITLE_MAX) {
        Alert.alert("Validation", `Title must be ${EVENT_TITLE_MAX} characters or fewer.`);
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

      const normalizedTz = timezone.trim() || defaultTimezone();
      if (!isValidTimezone(normalizedTz)) {
        Alert.alert("Validation", "Timezone must be a valid IANA name (for example: America/New_York).");
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

      if (!intentionText) {
        Alert.alert("Validation", "Intention is required.");
        return;
      }
      if (intentionText.length > EVENT_INTENTION_MAX) {
        Alert.alert("Validation", `Intention must be ${EVENT_INTENTION_MAX} characters or fewer.`);
        return;
      }
      if (descriptionText.length > EVENT_DESCRIPTION_MAX) {
        Alert.alert("Validation", `Description must be ${EVENT_DESCRIPTION_MAX} characters or fewer.`);
        return;
      }

      setLoading(true);

      const payload: Database["public"]["Tables"]["events"]["Insert"] = {
        title: titleText,
        description: descriptionText || null,

        intention: intentionText,
        intention_statement: intentionText,

        starts_at: startIso,
        start_time_utc: startIso,
        end_time_utc: endIso,
        duration_minutes: mins,

        timezone: normalizedTz,

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

      if (joinedEventId && joinedEventId !== selectedEventId && myUserId) {
        await supabase.from("event_presence").delete().eq("event_id", joinedEventId).eq("user_id", myUserId);
      }
      await upsertPresence(selectedEventId);

      setIsJoined(true);
      setJoinedEventId(selectedEventId);
      setPresenceStatus("Joined live.");
    } catch (e: any) {
      setPresenceError(e?.message ?? "Failed to join");
    }
  }, [selectedEventId, upsertPresence, joinedEventId, myUserId]);

  const handleLeave = useCallback(async () => {
    try {
      setPresenceError("");
      setPresenceStatus("");

      const targetEventId = joinedEventId || selectedEventId;
      if (!targetEventId) return;

      const { data } = await supabase.auth.getUser();
      const user = data.user;

      if (!user) {
        setPresenceError("Not signed in.");
        return;
      }

      const { error } = await supabase
        .from("event_presence")
        .delete()
        .eq("event_id", targetEventId)
        .eq("user_id", user.id);

      if (error) {
        setPresenceError(error.message);
        return;
      }

      setIsJoined(false);
      if (joinedEventId === targetEventId) setJoinedEventId("");
      setPresenceStatus("Left live.");
    } catch (e: any) {
      setPresenceError(e?.message ?? "Failed to leave");
    }
  }, [selectedEventId, joinedEventId]);

  const handleSendEnergy = useCallback(async (amount: number) => {
    setEnergyError("");
    setEnergyStatus("");

    if (!selectedEventId) {
      Alert.alert("Select event", "Please select an event first.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) return;

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      setEnergyError("Not signed in.");
      return;
    }

    setSendingEnergy(amount);
    try {
      const payload: Database["public"]["Tables"]["event_messages"]["Insert"] = {
        event_id: selectedEventId,
        user_id: user.id,
        body: `Sent ${amount} energy to this circle.`,
      };

      const { error } = await supabase.from("event_messages").insert(payload);
      if (error) {
        setEnergyError(error.message);
        return;
      }

      setEnergyStatus(`Sent +${amount} energy.`);
    } finally {
      setSendingEnergy(null);
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

  const shareEvent = useCallback(async (event: EventRow) => {
    const title = String((event as any).title ?? "Egregor Event");
    const intentionText = String((event as any).intention_statement ?? (event as any).intention ?? "").trim();
    const startLabel = (event as any).start_time_utc
      ? new Date((event as any).start_time_utc).toLocaleString()
      : "Unknown time";
    const tz = String((event as any).timezone ?? "UTC");
    const eventId = String((event as any).id ?? "");

    const lines = [
      `Join me on Egregor: ${title}`,
      intentionText ? `Intention: ${intentionText}` : "",
      `Start: ${startLabel} (${tz})`,
      eventId ? `Event ID: ${eventId}` : "",
    ].filter(Boolean);

    try {
      await Share.share({
        message: lines.join("\n"),
      });
    } catch (e: any) {
      Alert.alert("Share failed", e?.message ?? "Could not open share sheet.");
    }
  }, []);

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
        Alert.alert("Not allowed", "Only the host can change this event's script.");
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

  const openEditForEvent = useCallback((event: EventRow) => {
    setEditEventId(event.id);
    setEditTitle(String(event.title ?? ""));
    setEditIntention(String((event as any).intention_statement ?? (event as any).intention ?? ""));
    setEditDescription(String(event.description ?? ""));
    setEditStartLocal(isoToLocalInput((event as any).start_time_utc));
    setEditEndLocal(isoToLocalInput((event as any).end_time_utc));
    setEditTimezone(String((event as any).timezone ?? defaultTimezone()));
    setEditOpen(true);
  }, []);

  const saveEventEdits = useCallback(async () => {
    if (!editEvent) return;

    const titleText = editTitle.trim();
    const intentionText = editIntention.trim();
    const descriptionText = editDescription.trim();
    const startIso = localInputToIso(editStartLocal);
    const endIso = localInputToIso(editEndLocal);
    const normalizedTz = editTimezone.trim() || defaultTimezone();

    if (!titleText) {
      Alert.alert("Validation", "Title is required.");
      return;
    }
    if (titleText.length > EVENT_TITLE_MAX) {
      Alert.alert("Validation", `Title must be ${EVENT_TITLE_MAX} characters or fewer.`);
      return;
    }
    if (!intentionText) {
      Alert.alert("Validation", "Intention is required.");
      return;
    }
    if (intentionText.length > EVENT_INTENTION_MAX) {
      Alert.alert("Validation", `Intention must be ${EVENT_INTENTION_MAX} characters or fewer.`);
      return;
    }
    if (descriptionText.length > EVENT_DESCRIPTION_MAX) {
      Alert.alert("Validation", `Description must be ${EVENT_DESCRIPTION_MAX} characters or fewer.`);
      return;
    }
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
    if (!isValidTimezone(normalizedTz)) {
      Alert.alert("Validation", "Timezone must be a valid IANA name (for example: America/New_York).");
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
    if (editEvent.host_user_id !== user.id) {
      Alert.alert("Not allowed", "Only the host can edit this event.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        title: titleText,
        description: descriptionText || null,
        intention: intentionText,
        intention_statement: intentionText,
        starts_at: startIso,
        start_time_utc: startIso,
        end_time_utc: endIso,
        duration_minutes: mins,
        timezone: normalizedTz,
      };

      const { error } = await supabase.from("events").update(payload).eq("id", editEvent.id);
      if (error) {
        Alert.alert("Update failed", error.message);
        return;
      }

      setEditOpen(false);
      setEditEventId("");
      await loadEvents();
      Alert.alert("Updated", "Event saved.");
    } finally {
      setLoading(false);
    }
  }, [
    editDescription,
    editEndLocal,
    editEvent,
    editIntention,
    editStartLocal,
    editTimezone,
    editTitle,
    loadEvents,
  ]);

  const deleteEvent = useCallback(
    async (event: EventRow) => {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }
      if (event.host_user_id !== user.id) {
        Alert.alert("Not allowed", "Only the host can delete this event.");
        return;
      }

      Alert.alert("Delete event?", `Delete "${event.title}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.from("events").delete().eq("id", event.id);
              if (error) {
                Alert.alert("Delete failed", error.message);
                return;
              }
              if (selectedEventId === event.id) {
                setSelectedEventId("");
                setIsJoined(false);
                setPresenceStatus("");
                setPresenceError("");
              }
              await loadEvents();
              Alert.alert("Deleted", "Event removed.");
            } finally {
              setLoading(false);
            }
          },
        },
      ]);
    },
    [loadEvents, selectedEventId]
  );

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

  // ---- Filtering + sorting ----
  const visibleEvents = useMemo(() => {
    void nowTick;
    const now = Date.now();
    const query = eventQuery.trim().toLowerCase();

    let rows = [...events];

    if (hostedOnly && myUserId) {
      rows = rows.filter((e) => (e as any).host_user_id === myUserId);
    } else if (hostedOnly && !myUserId) {
      rows = [];
    }

    const isPast = (e: EventRow) => {
      const endMs = safeTimeMs((e as any).end_time_utc);
      const startMs = safeTimeMs((e as any).start_time_utc);
      const t = endMs || startMs;
      return t > 0 ? t < now : false;
    };

    const isLive = (e: EventRow) => {
      const startMs = safeTimeMs((e as any).start_time_utc);
      const endMs = safeTimeMs((e as any).end_time_utc);
      if (!startMs) return false;
      if (!endMs) return startMs <= now;
      return startMs <= now && now <= endMs;
    };

    if (upcomingOnly) {
      rows = rows.filter((e) => !isPast(e) || isLive(e));
    }

    if (selectedCategory !== "All") {
      const keywords = CATEGORY_KEYWORDS[selectedCategory];
      rows = rows.filter((e) => {
        const hay = [
          String((e as any).title ?? ""),
          String((e as any).intention_statement ?? ""),
          String((e as any).intention ?? ""),
          String((e as any).description ?? ""),
        ]
          .join(" ")
          .toLowerCase();
        return keywords.some((k) => hay.includes(k));
      });
    }

    if (query) {
      rows = rows.filter((e) => {
        const titleText = String((e as any).title ?? "").toLowerCase();
        const intentionText = String((e as any).intention_statement ?? (e as any).intention ?? "").toLowerCase();
        const descriptionText = String((e as any).description ?? "").toLowerCase();
        const hostText = displayNameForUserId(String((e as any).host_user_id ?? "")).toLowerCase();
        const scriptId = String((e as any).script_id ?? "");
        const scriptText = scriptId ? String(scriptsById[scriptId]?.title ?? scriptId).toLowerCase() : "(none)";
        return (
          titleText.includes(query) ||
          intentionText.includes(query) ||
          descriptionText.includes(query) ||
          hostText.includes(query) ||
          scriptText.includes(query)
        );
      });
    }

    rows.sort((a, b) => {
      const aLive = isLive(a) ? 1 : 0;
      const bLive = isLive(b) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;

      const aPast = isPast(a) ? 1 : 0;
      const bPast = isPast(b) ? 1 : 0;
      if (aPast !== bPast) return aPast - bPast;

      const aStart = safeTimeMs((a as any).start_time_utc);
      const bStart = safeTimeMs((b as any).start_time_utc);

      if (aPast && bPast) return bStart - aStart;
      return aStart - bStart;
    });

    return rows;
  }, [events, hostedOnly, myUserId, upcomingOnly, nowTick, eventQuery, displayNameForUserId, scriptsById, selectedCategory]);

  const renderEvent = ({ item }: { item: EventRow }) => {
    void nowTick;
    const nowMs = Date.now();

    const isHost = !!myUserId && item.host_user_id === myUserId;
    const isNewsEvent = String((item as any).source ?? "").trim().toLowerCase() === "news";
    const hostLabel = displayNameForUserId((item as any).host_user_id as string);

    const when = formatWhenLabel(item, nowMs);

    return (
      <Pressable
        onPress={() => setSelectedEventId(item.id)}
        style={[
          styles.card,
          { backgroundColor: c.cardAlt, borderColor: c.border },
          item.id === selectedEventId ? styles.cardSelected : undefined,
          item.id === selectedEventId ? { borderColor: c.primary, backgroundColor: c.card } : undefined,
        ]}
      >
        <View style={styles.cardTopRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                {item.title}
              </Text>

              {isHost ? (
                <View style={styles.chip}>
                  <Text style={styles.chipText}>HOST</Text>
                </View>
              ) : null}

              <View
                style={[
                  styles.whenPill,
                  when.kind === "live"
                    ? styles.whenLive
                    : when.kind === "soon"
                    ? styles.whenSoon
                    : when.kind === "today"
                    ? styles.whenToday
                    : when.kind === "past"
                    ? styles.whenPast
                    : styles.whenUpcoming,
                ]}
              >
                <Text style={styles.whenText}>{when.text}</Text>
              </View>

              {isNewsEvent ? (
                <View style={[styles.whenPill, styles.whenNews]}>
                  <Text style={styles.whenText}>Crisis response</Text>
                </View>
              ) : null}
            </View>

            <Text style={[styles.meta, { color: c.textMuted }]}>
              Hosted by: <Text style={{ color: c.text, fontWeight: "800" }}>{hostLabel}</Text>
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => openRoom(item.id)}
              style={[styles.smallBtn, styles.smallBtnPrimary, { backgroundColor: c.primary }]}
            >
              <Text style={styles.smallBtnText}>Open</Text>
            </Pressable>

            <Pressable
              onPress={() => shareEvent(item)}
              style={[styles.smallBtn, styles.smallBtnGhost]}
            >
              <Text style={styles.smallBtnGhostText}>Share</Text>
            </Pressable>

            {isHost ? (
              <Pressable
                onPress={() => openEditForEvent(item)}
                style={[styles.smallBtn, styles.smallBtnGhost, loading && styles.disabled]}
                disabled={loading}
              >
                <Text style={styles.smallBtnGhostText}>Edit</Text>
              </Pressable>
            ) : null}

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

            {isHost ? (
              <Pressable
                onPress={() => deleteEvent(item)}
                style={[styles.smallBtn, styles.smallBtnDanger, loading && styles.disabled]}
                disabled={loading}
              >
                <Text style={styles.smallBtnText}>Delete</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {!!item.description && <Text style={[styles.cardText, { color: c.text }]}>{item.description}</Text>}

        <Text style={[styles.cardText, { color: c.text }]}>Intention: {item.intention_statement}</Text>

        <Text style={[styles.meta, { color: c.textMuted }]}>{new Date(item.start_time_utc).toLocaleString()} {"->"} {new Date(item.end_time_utc).toLocaleString()} ({item.timezone ?? "UTC"})</Text>

        <Text style={[styles.meta, { color: c.textMuted }]}>Duration: {item.duration_minutes ?? 0} min</Text>

        <Text style={[styles.meta, { color: c.textMuted }]}>Active snapshot: {item.active_count_snapshot ?? 0} | Total joined: {" "}{item.total_join_count ?? 0}</Text>

        <Text style={[styles.meta, { color: c.textMuted }]}>Script: {getScriptLabel(item.script_id)}</Text>
        <Text style={[styles.meta, { color: c.textMuted }]}>ID: {item.id}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <FlatList
        data={visibleEvents}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        contentContainerStyle={styles.content}
        refreshing={loading}
        onRefresh={refreshAll}
        ListHeaderComponent={
          <View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Create Event</Text>

              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                maxLength={EVENT_TITLE_MAX}
              />
              <Text style={styles.meta}>{title.trim().length}/{EVENT_TITLE_MAX}</Text>

              <Text style={styles.label}>Intention</Text>
              <TextInput
                style={[styles.input, styles.multi]}
                value={intention}
                onChangeText={setIntention}
                multiline
                maxLength={EVENT_INTENTION_MAX}
              />
              <Text style={styles.meta}>{intention.trim().length}/{EVENT_INTENTION_MAX}</Text>

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.multi]}
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={EVENT_DESCRIPTION_MAX}
              />
              <Text style={styles.meta}>{description.trim().length}/{EVENT_DESCRIPTION_MAX}</Text>

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
              <Text style={styles.sectionTitle}>Filters</Text>

              <TextInput
                style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
                value={eventQuery}
                onChangeText={setEventQuery}
                placeholder="Search events, hosts, intention, script..."
                placeholderTextColor={c.textMuted}
              />

              <View style={styles.filterRow}>
                <Pressable
                  onPress={() => setUpcomingOnly((v) => !v)}
                  style={[
                    styles.filterPill,
                    upcomingOnly ? styles.filterPillOn : styles.filterPillOff,
                  ]}
                >
                  <Text style={upcomingOnly ? styles.filterTextOn : styles.filterTextOff}>
                    Upcoming only
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setHostedOnly((v) => !v)}
                  style={[
                    styles.filterPill,
                    hostedOnly ? styles.filterPillOn : styles.filterPillOff,
                  ]}
                >
                  <Text style={hostedOnly ? styles.filterTextOn : styles.filterTextOff}>
                    Hosted by me
                  </Text>
                </Pressable>
              </View>

              <View style={styles.categoryRow}>
                {EVENT_CATEGORIES.map((cat) => {
                  const on = selectedCategory === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setSelectedCategory(cat)}
                      style={[
                        styles.filterPill,
                        on ? styles.filterPillOn : styles.filterPillOff,
                      ]}
                    >
                      <Text style={on ? styles.filterTextOn : styles.filterTextOff}>{cat}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.meta}>
                Showing{" "}
                <Text style={{ color: "white", fontWeight: "900" }}>{visibleEvents.length}</Text>{" "}
                event{visibleEvents.length === 1 ? "" : "s"}
              </Text>
            </View>

            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Live Presence</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                Selected: {selectedEvent ? selectedEvent.title : "(none)"}
              </Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                Joined:{" "}
                <Text style={{ color: c.text, fontWeight: "800" }}>
                  {joinedEvent ? joinedEvent.title : "(not joined)"}
                </Text>
              </Text>

              <View style={styles.row}>
                <Pressable
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    { backgroundColor: c.primary },
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
                    { borderColor: c.border },
                    (!selectedEventId || !isJoined) && styles.disabled,
                  ]}
                  onPress={handleLeave}
                  disabled={!selectedEventId || !isJoined}
                >
                  <Text style={[styles.btnGhostText, { color: c.text }]}>Leave live</Text>
                </Pressable>

                <Pressable
                  style={[styles.btn, styles.btnGhost, { borderColor: c.border }, !selectedEventId && styles.disabled]}
                  onPress={() => {
                    if (!selectedEventId) {
                      Alert.alert("Select event", "Please select an event first.");
                      return;
                    }
                    openRoom(selectedEventId);
                  }}
                  disabled={!selectedEventId}
                >
                  <Text style={[styles.btnGhostText, { color: c.text }]}>Open room</Text>
                </Pressable>
              </View>

              <View style={styles.row}>
                {[1, 3, 7].map((amount) => (
                  <Pressable
                    key={amount}
                    style={[
                      styles.btn,
                      styles.btnGhost,
                      { borderColor: c.border },
                      (!selectedEventId || !!sendingEnergy) && styles.disabled,
                    ]}
                    onPress={() => void handleSendEnergy(amount)}
                    disabled={!selectedEventId || !!sendingEnergy}
                  >
                    <Text style={[styles.btnGhostText, { color: c.text }]}>
                      {sendingEnergy === amount ? "Sending..." : `+${amount} energy`}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {!!presenceStatus && <Text style={styles.ok}>{presenceStatus}</Text>}
              {!!presenceError && <Text style={styles.err}>{presenceError}</Text>}
              {!!energyStatus && <Text style={styles.ok}>{energyStatus}</Text>}
              {!!energyError && <Text style={styles.err}>{energyError}</Text>}
            </View>

            <Text style={[styles.sectionTitle, { color: c.text }]}>All Events</Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: c.textMuted }]}>{loading ? "Loading..." : "No events yet."}</Text>
        }
      />

      {/* Edit Event Modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.text }]}>Edit Event</Text>
              <Pressable onPress={() => setEditOpen(false)} style={styles.modalClose} disabled={loading}>
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>

            <Text style={[styles.label, { color: c.textMuted }]}>Title</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              value={editTitle}
              onChangeText={setEditTitle}
              maxLength={EVENT_TITLE_MAX}
              placeholder="Event title"
              placeholderTextColor={c.textMuted}
            />
            <Text style={[styles.meta, { color: c.textMuted }]}>{editTitle.trim().length}/{EVENT_TITLE_MAX}</Text>

            <Text style={[styles.label, { color: c.textMuted }]}>Intention</Text>
            <TextInput
              style={[styles.input, styles.multi, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              value={editIntention}
              onChangeText={setEditIntention}
              multiline
              maxLength={EVENT_INTENTION_MAX}
              placeholder="Intention statement"
              placeholderTextColor={c.textMuted}
            />
            <Text style={[styles.meta, { color: c.textMuted }]}>{editIntention.trim().length}/{EVENT_INTENTION_MAX}</Text>

            <Text style={[styles.label, { color: c.textMuted }]}>Description</Text>
            <TextInput
              style={[styles.input, styles.multi, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              value={editDescription}
              onChangeText={setEditDescription}
              multiline
              maxLength={EVENT_DESCRIPTION_MAX}
              placeholder="Description"
              placeholderTextColor={c.textMuted}
            />
            <Text style={[styles.meta, { color: c.textMuted }]}>{editDescription.trim().length}/{EVENT_DESCRIPTION_MAX}</Text>

            <Text style={[styles.label, { color: c.textMuted }]}>Start local (YYYY-MM-DDTHH:mm)</Text>
            <TextInput style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]} value={editStartLocal} onChangeText={setEditStartLocal} placeholderTextColor={c.textMuted} />

            <Text style={[styles.label, { color: c.textMuted }]}>End local (YYYY-MM-DDTHH:mm)</Text>
            <TextInput style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]} value={editEndLocal} onChangeText={setEditEndLocal} placeholderTextColor={c.textMuted} />

            <Text style={[styles.label, { color: c.textMuted }]}>Timezone</Text>
            <TextInput style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]} value={editTimezone} onChangeText={setEditTimezone} placeholderTextColor={c.textMuted} />

            <View style={styles.row}>
              <Pressable
                style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, loading && styles.disabled]}
                onPress={saveEventEdits}
                disabled={loading || !editEvent}
              >
                <Text style={styles.btnText}>{loading ? "Working..." : "Save changes"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Attach Script Modal */}
      <Modal
        visible={attachOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.text }]}>Event Script</Text>
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
                  <Text style={{ fontWeight: "900", color: c.text }}>{attachEvent.title}</Text>
                </Text>

                <Text style={styles.modalMeta}>
                  Current:{" "}
                  <Text style={{ fontWeight: "900", color: c.text }}>
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
                    style={[styles.btn, styles.btnGhost, { borderColor: c.border }, loading && styles.disabled]}
                    disabled={loading}
                  >
                    <Text style={[styles.btnGhostText, { color: c.text }]}>Refresh scripts</Text>
                  </Pressable>
                </View>

                <TextInput
                  value={scriptQuery}
                  onChangeText={setScriptQuery}
                  style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
                  placeholder="Search your scripts..."
                  placeholderTextColor={c.textMuted}
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

  headerBtn: {
    marginRight: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3E4C78",
    backgroundColor: "transparent",
  },
  headerBtnText: { color: "#C8D3FF", fontWeight: "800" },

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

  filterRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  categoryRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 },
  filterPill: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  filterPillOn: { backgroundColor: "#0F1C44", borderColor: "#2E5BFF" },
  filterPillOff: { backgroundColor: "transparent", borderColor: "#3E4C78" },
  filterTextOn: { color: "#DCE4FF", fontWeight: "900" },
  filterTextOff: { color: "#C8D3FF", fontWeight: "800" },

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
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  cardTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
    maxWidth: 220,
  },
  cardText: { color: "#C6D0F5", marginBottom: 6 },
  meta: { color: "#93A3D9", fontSize: 12, marginTop: 4 },

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
  smallBtnDanger: { backgroundColor: "#FB7185" },
  smallBtnText: { color: "white", fontWeight: "800" },
  smallBtnGhostText: { color: "#C8D3FF", fontWeight: "800" },

  chip: {
    borderWidth: 1,
    borderColor: "#6EA1FF",
    backgroundColor: "#0F1C44",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { color: "#DCE4FF", fontWeight: "900", fontSize: 12 },

  whenPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  whenText: { fontWeight: "900", fontSize: 12, color: "white" },
  whenLive: { borderColor: "#10B981", backgroundColor: "#052A1F" },
  whenSoon: { borderColor: "#F59E0B", backgroundColor: "#2A1A05" },
  whenToday: { borderColor: "#5B8CFF", backgroundColor: "#0F1C44" },
  whenNews: { borderColor: "#FBBF24", backgroundColor: "#2D2107" },
  whenUpcoming: { borderColor: "#3E4C78", backgroundColor: "#0E1428" },
  whenPast: { borderColor: "#FB7185", backgroundColor: "#2A1220" },

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


