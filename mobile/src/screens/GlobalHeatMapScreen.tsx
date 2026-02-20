import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { supabase } from "../supabase/client";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";
import type { Database } from "../types/db";
import type { RootStackParamList } from "../types";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type PresenceRow = Database["public"]["Tables"]["event_presence"]["Row"];
type EventMessageRow = Database["public"]["Tables"]["event_messages"]["Row"];
type ManifestationItem = {
  id: string;
  eventId: string;
  body: string;
  createdAt: string;
  eventTitle: string;
};

type RegionKey = "Americas" | "Europe" | "Asia" | "Africa" | "Oceania" | "Global";
type HeatWindow = "90s" | "24h" | "7d";

const KEY_LOCATION_OPT_IN = "prefs:locationOptIn";
const ACTIVE_WINDOW_MS = 90_000;
const HEATMAP_RESYNC_MS = 30_000;

const REGIONS: { key: RegionKey; label: string }[] = [
  { key: "Americas", label: "Americas" },
  { key: "Europe", label: "Europe" },
  { key: "Asia", label: "Asia" },
  { key: "Africa", label: "Africa" },
  { key: "Oceania", label: "Oceania" },
  { key: "Global", label: "Global / UTC" },
];

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function regionFromTimezone(tzRaw: string | null | undefined): RegionKey {
  const tz = String(tzRaw ?? "").toLowerCase();
  if (tz.startsWith("america/")) return "Americas";
  if (tz.startsWith("europe/")) return "Europe";
  if (tz.startsWith("asia/")) return "Asia";
  if (tz.startsWith("africa/")) return "Africa";
  if (tz.startsWith("australia/") || tz.startsWith("pacific/")) return "Oceania";
  return "Global";
}

function windowMs(window: HeatWindow) {
  if (window === "24h") return 24 * 60 * 60 * 1000;
  if (window === "7d") return 7 * 24 * 60 * 60 * 1000;
  return ACTIVE_WINDOW_MS;
}

export default function GlobalHeatMapScreen() {
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(false);
  const [locationOptIn, setLocationOptIn] = useState(false);
  const [activeByRegion, setActiveByRegion] = useState<Record<RegionKey, number>>({
    Americas: 0,
    Europe: 0,
    Asia: 0,
    Africa: 0,
    Oceania: 0,
    Global: 0,
  });
  const [liveEventsByRegion, setLiveEventsByRegion] = useState<Record<RegionKey, EventRow[]>>({
    Americas: [],
    Europe: [],
    Asia: [],
    Africa: [],
    Oceania: [],
    Global: [],
  });
  const [selectedRegion, setSelectedRegion] = useState<RegionKey>("Americas");
  const [heatWindow, setHeatWindow] = useState<HeatWindow>("90s");
  const [manifestationsByRegion, setManifestationsByRegion] = useState<Record<RegionKey, ManifestationItem[]>>({
    Americas: [],
    Europe: [],
    Asia: [],
    Africa: [],
    Oceania: [],
    Global: [],
  });
  const heatLoadInFlightRef = useRef(false);
  const queuedHeatLoadRef = useRef(false);

  const openEventRoom = useCallback(
    (eventId: string) => {
      if (!isLikelyUuid(eventId)) {
        Alert.alert("Invalid event", "Could not open this event.");
        return;
      }
      const navToUse = navigation.getParent?.() ?? navigation;
      (navToUse as any).navigate("EventRoom" as keyof RootStackParamList, { eventId });
    },
    [navigation]
  );

  const loadHeatData = useCallback(async () => {
    if (heatLoadInFlightRef.current) {
      queuedHeatLoadRef.current = true;
      return;
    }

    heatLoadInFlightRef.current = true;
    setLoading(true);
    try {
      const now = Date.now();
      const selectedWindowMs = windowMs(heatWindow);
      const cutoffIso = new Date(now - selectedWindowMs).toISOString();
      const [{ data: presenceRows }, { data: eventRows }, { data: messageRows }] = await Promise.all([
        supabase
          .from("event_presence")
          .select("event_id,user_id,last_seen_at")
          .gte("last_seen_at", cutoffIso)
          .limit(5000),
        supabase
          .from("events")
          .select("id,title,start_time_utc,end_time_utc,timezone,intention_statement")
          .order("start_time_utc", { ascending: false })
          .limit(500),
        supabase
          .from("event_messages")
          .select("id,event_id,body,created_at")
          .gte("created_at", cutoffIso)
          .order("created_at", { ascending: false })
          .limit(300),
      ]);

      const events = (eventRows ?? []) as EventRow[];
      const presence = (presenceRows ?? []) as Pick<PresenceRow, "event_id" | "user_id" | "last_seen_at">[];
      const eventById: Record<string, EventRow> = {};
      for (const e of events) eventById[e.id] = e;

      const activeCounts: Record<RegionKey, number> = {
        Americas: 0,
        Europe: 0,
        Asia: 0,
        Africa: 0,
        Oceania: 0,
        Global: 0,
      };
      for (const p of presence) {
        if (safeTimeMs((p as any).last_seen_at) < now - selectedWindowMs) continue;
        const event = eventById[String((p as any).event_id ?? "")];
        const region = regionFromTimezone((event as any)?.timezone ?? "");
        activeCounts[region] += 1;
      }
      setActiveByRegion(activeCounts);

      const liveByRegion: Record<RegionKey, EventRow[]> = {
        Americas: [],
        Europe: [],
        Asia: [],
        Africa: [],
        Oceania: [],
        Global: [],
      };
      for (const e of events) {
        const start = safeTimeMs((e as any).start_time_utc);
        const end = safeTimeMs((e as any).end_time_utc);
        if (!start) continue;
        const live = start <= now && (end <= 0 || now <= end);
        const recent = start >= now - selectedWindowMs && start <= now;
        if (heatWindow === "90s") {
          if (!live) continue;
        } else if (!recent) {
          continue;
        }
        const region = regionFromTimezone((e as any).timezone ?? "");
        liveByRegion[region].push(e);
      }
      setLiveEventsByRegion(liveByRegion);

      const messages = (messageRows ?? []) as Pick<EventMessageRow, "id" | "event_id" | "body" | "created_at">[];
      const manifests: Record<RegionKey, ManifestationItem[]> = {
        Americas: [],
        Europe: [],
        Asia: [],
        Africa: [],
        Oceania: [],
        Global: [],
      };
      for (const m of messages) {
        const eventId = String((m as any).event_id ?? "");
        const event = eventById[eventId];
        const region = regionFromTimezone((event as any)?.timezone ?? "");
        const body = String((m as any).body ?? "").trim();
        if (!body) continue;
        manifests[region].push({
          id: String((m as any).id ?? ""),
          eventId,
          body,
          createdAt: String((m as any).created_at ?? ""),
          eventTitle: String((event as any)?.title ?? "Live circle"),
        });
      }
      for (const key of Object.keys(manifests) as RegionKey[]) {
        manifests[key] = manifests[key].slice(0, 6);
      }
      setManifestationsByRegion(manifests);
    } finally {
      setLoading(false);
      heatLoadInFlightRef.current = false;
      if (queuedHeatLoadRef.current) {
        queuedHeatLoadRef.current = false;
        void loadHeatData();
      }
    }
  }, [heatWindow]);

  useFocusEffect(
    useCallback(() => {
      let disposed = false;
      let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
      const scheduleRefresh = () => {
        if (disposed || refreshTimeout) return;
        refreshTimeout = setTimeout(() => {
          refreshTimeout = null;
          if (disposed) return;
          void loadHeatData();
        }, 1200);
      };
      const run = async () => {
        if (disposed) return;
        const raw = await AsyncStorage.getItem(KEY_LOCATION_OPT_IN);
        if (!disposed) setLocationOptIn(raw === "1");
        if (!disposed) await loadHeatData();
      };
      void run();
      const id = setInterval(() => {
        void loadHeatData();
      }, HEATMAP_RESYNC_MS);

      const realtime = supabase
        .channel("heatmap:global")
        .on("postgres_changes", { event: "*", schema: "public", table: "event_presence" }, scheduleRefresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "events" }, scheduleRefresh)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "event_messages" }, scheduleRefresh)
        .subscribe();

      return () => {
        disposed = true;
        clearInterval(id);
        if (refreshTimeout) clearTimeout(refreshTimeout);
        supabase.removeChannel(realtime);
      };
    }, [loadHeatData])
  );

  const maxRegionValue = useMemo(
    () => Math.max(1, ...REGIONS.map((r) => activeByRegion[r.key] ?? 0)),
    [activeByRegion]
  );

  const totalActive = useMemo(
    () => REGIONS.reduce((sum, r) => sum + (activeByRegion[r.key] ?? 0), 0),
    [activeByRegion]
  );

  const selectedEvents = liveEventsByRegion[selectedRegion] ?? [];
  const selectedManifestations = manifestationsByRegion[selectedRegion] ?? [];

  const onToggleLocation = useCallback(async (next: boolean) => {
    setLocationOptIn(next);
    await AsyncStorage.setItem(KEY_LOCATION_OPT_IN, next ? "1" : "0");
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <FlatList
        data={selectedEvents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshing={loading}
        onRefresh={loadHeatData}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Text style={[styles.h1, { color: c.text }]}>Global Heat Map</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>
              Collective intensity by world region.
            </Text>
            <View style={styles.row}>
              {(["90s", "24h", "7d"] as HeatWindow[]).map((w) => {
                const on = w === heatWindow;
                return (
                  <Pressable
                    key={w}
                    onPress={() => setHeatWindow(w)}
                    style={[
                      styles.windowChip,
                      { borderColor: c.border, backgroundColor: on ? c.cardAlt : c.background },
                      on && { borderColor: c.primary },
                    ]}
                  >
                    <Text style={[styles.meta, { color: c.text }]}>{w === "90s" ? "Live 90s" : w}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.row}>
                <Text style={[styles.sectionTitle, { color: c.text }]}>Share anonymous location intensity</Text>
                <Switch value={locationOptIn} onValueChange={onToggleLocation} />
              </View>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                Privacy-first opt-in. Your identity is never shown on the map.
              </Text>
              <Text style={[styles.metric, { color: c.text }]}>Active globally: {totalActive}</Text>
            </View>

            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Regional Intensity</Text>
              {REGIONS.map((region) => {
                const value = activeByRegion[region.key] ?? 0;
                const pct = Math.max(0, Math.min(100, Math.round((value / maxRegionValue) * 100)));
                const selected = selectedRegion === region.key;
                return (
                  <Pressable
                    key={region.key}
                    style={[
                      styles.regionRow,
                      { borderColor: c.border, backgroundColor: selected ? c.cardAlt : c.background },
                    ]}
                    onPress={() => setSelectedRegion(region.key)}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.row}>
                        <Text style={[styles.regionTitle, { color: c.text }]}>{region.label}</Text>
                        <Text style={[styles.meta, { color: c.textMuted }]}>{value}</Text>
                      </View>
                      <View style={[styles.track, { backgroundColor: c.background, borderColor: c.border }]}>
                        <View style={[styles.fill, { backgroundColor: c.primary, width: `${pct}%` }]} />
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Live Events in {selectedRegion}</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                {heatWindow === "90s"
                  ? "Tap any live event to enter the synchronized room."
                  : `Events started in the selected ${heatWindow} window.`}
              </Text>
            </View>

            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Recent Manifestations</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                Shared intentions from {selectedRegion} in the selected window.
              </Text>
              {selectedManifestations.length === 0 ? (
                <Text style={[styles.meta, { color: c.textMuted }]}>No recent manifestations yet.</Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {selectedManifestations.map((m) => (
                    <Pressable
                      key={m.id}
                      style={[styles.manifestCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}
                      onPress={() => openEventRoom(m.eventId)}
                    >
                      <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={1}>
                        {m.eventTitle} • {new Date(m.createdAt).toLocaleTimeString()}
                      </Text>
                      <Text style={[styles.meta, { color: c.text }]} numberOfLines={2}>
                        {m.body}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.eventCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}
            onPress={() => openEventRoom(item.id)}
          >
            <Text style={[styles.eventTitle, { color: c.text }]}>{String((item as any).title ?? "Untitled")}</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>
              {new Date((item as any).start_time_utc).toLocaleString()} ({String((item as any).timezone ?? "UTC")})
            </Text>
            <Text style={[styles.meta, { color: c.text }]} numberOfLines={2}>
              {String((item as any).intention_statement ?? "Live collective intention.")}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? <ActivityIndicator /> : <Text style={{ color: c.textMuted }}>No live events in this region.</Text>}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 42, gap: 10 },
  h1: { fontSize: 28, fontWeight: "800" },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", flex: 1 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  meta: { fontSize: 12 },
  metric: { fontSize: 20, fontWeight: "900", marginTop: 4 },
  regionRow: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
  regionTitle: { fontSize: 14, fontWeight: "800" },
  windowChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  track: {
    marginTop: 6,
    height: 8,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 999 },
  manifestCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  eventCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  eventTitle: { fontSize: 16, fontWeight: "800", marginBottom: 3 },
  empty: { paddingVertical: 24, alignItems: "center", justifyContent: "center" },
});

