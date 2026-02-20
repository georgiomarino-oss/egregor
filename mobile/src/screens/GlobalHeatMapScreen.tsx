import React, { useCallback, useMemo, useState } from "react";
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

type RegionKey = "Americas" | "Europe" | "Asia" | "Africa" | "Oceania" | "Global";

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

export default function GlobalHeatMapScreen() {
  const { theme } = useAppState();
  const c = useMemo(() => getAppColors(theme), [theme]);
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
    setLoading(true);
    try {
      const cutoffIso = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
      const [{ data: presenceRows }, { data: eventRows }] = await Promise.all([
        supabase
          .from("event_presence")
          .select("event_id,user_id,last_seen_at")
          .gte("last_seen_at", cutoffIso)
          .limit(5000),
        supabase
          .from("events")
          .select("id,title,start_time_utc,end_time_utc,timezone,intention_statement")
          .order("start_time_utc", { ascending: true })
          .limit(200),
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
        if (safeTimeMs((p as any).last_seen_at) < Date.now() - ACTIVE_WINDOW_MS) continue;
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
      const now = Date.now();
      for (const e of events) {
        const start = safeTimeMs((e as any).start_time_utc);
        const end = safeTimeMs((e as any).end_time_utc);
        const live = start > 0 && start <= now && (end <= 0 || now <= end);
        if (!live) continue;
        const region = regionFromTimezone((e as any).timezone ?? "");
        liveByRegion[region].push(e);
      }
      setLiveEventsByRegion(liveByRegion);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let disposed = false;
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
      return () => {
        disposed = true;
        clearInterval(id);
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
              Real-time collective intensity by world region (last 90 seconds).
            </Text>

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
                Tap any event to enter the synchronized room.
              </Text>
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
  track: {
    marginTop: 6,
    height: 8,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 999 },
  eventCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  eventTitle: { fontSize: 16, fontWeight: "800", marginBottom: 3 },
  empty: { paddingVertical: 24, alignItems: "center", justifyContent: "center" },
});
