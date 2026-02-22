import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { supabase } from "../supabase/client";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";
import type { Database } from "../types/db";
import type { RootStackParamList } from "../types";

type HeatSnapshotRow = Database["public"]["Functions"]["get_global_heatmap_snapshot"]["Returns"][number];

type RegionKey = "Americas" | "Europe" | "Asia" | "Africa" | "Oceania" | "Global";
type HeatWindow = "90s" | "24h" | "7d";
type MapTier = "World" | "Continent" | "Country" | "City";
type HeatEventItem = {
  id: string;
  title: string;
  start_time_utc: string;
  end_time_utc: string | null;
  timezone: string | null;
  intention_statement: string | null;
  region: RegionKey;
};
type ManifestationItem = {
  id: string;
  eventId: string;
  body: string;
  createdAt: string;
  eventTitle: string;
  region: RegionKey;
};
type HotspotPoint = {
  id: string;
  region: RegionKey;
  xPct: number;
  yPct: number;
  intensity: number;
  size: number;
};

const KEY_LOCATION_OPT_IN = "prefs:locationOptIn";
const HEATMAP_RESYNC_MS = 30_000;
const LOCATION_HEARTBEAT_MS = 60_000;

const REGIONS: { key: RegionKey; label: string }[] = [
  { key: "Americas", label: "Americas" },
  { key: "Europe", label: "Europe" },
  { key: "Asia", label: "Asia" },
  { key: "Africa", label: "Africa" },
  { key: "Oceania", label: "Oceania" },
  { key: "Global", label: "Global / UTC" },
];

const REGION_PLOT: Record<RegionKey, { xPct: number; yPct: number }> = {
  Americas: { xPct: 20, yPct: 40 },
  Europe: { xPct: 48, yPct: 29 },
  Asia: { xPct: 70, yPct: 40 },
  Africa: { xPct: 50, yPct: 53 },
  Oceania: { xPct: 83, yPct: 68 },
  Global: { xPct: 50, yPct: 17 },
};
const MAP_GRID_LINES = [8, 18, 28, 38, 48, 58, 68, 78, 88];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function clampPct(n: number) {
  return clamp(n, 4, 96);
}

function hashSeed(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function resolveMapTier(scale: number): MapTier {
  if (scale >= 2.25) return "City";
  if (scale >= 1.7) return "Country";
  if (scale >= 1.3) return "Continent";
  return "World";
}

function spreadForTier(tier: MapTier) {
  if (tier === "City") return 6;
  if (tier === "Country") return 9;
  if (tier === "Continent") return 13;
  return 17;
}

function heatColorForIntensity(intensity: number) {
  if (intensity > 0.78) return "#FF9A3C";
  if (intensity > 0.56) return "#F4C35F";
  if (intensity > 0.32) return "#69B3FF";
  return "#6CE3D9";
}

function buildHotspots(args: {
  activeByRegion: Record<RegionKey, number>;
  maxRegionValue: number;
  selectedRegion: RegionKey;
  tier: MapTier;
  heatWindow: HeatWindow;
}) {
  const points: HotspotPoint[] = [];
  const spreadBase = spreadForTier(args.tier);

  for (const region of REGIONS) {
    const value = Math.max(0, args.activeByRegion[region.key] ?? 0);
    if (value <= 0) continue;

    const center = REGION_PLOT[region.key];
    const normalized = value / Math.max(1, args.maxRegionValue);
    const weighted = Math.sqrt(value);
    const clusterCount = Math.max(1, Math.min(14, Math.round(weighted * 2.2)));
    const seed = hashSeed(`${region.key}:${args.heatWindow}:${value}:${args.tier}`);
    const rand = createSeeded(seed);
    const focusFactor = args.selectedRegion === region.key ? 0.7 : 1;

    for (let i = 0; i < clusterCount; i += 1) {
      const angle = rand() * Math.PI * 2;
      const distance = (0.2 + rand() * 0.85) * spreadBase * focusFactor;
      const xPct = clampPct(center.xPct + Math.cos(angle) * distance);
      const yPct = clampPct(center.yPct + Math.sin(angle) * distance);
      const size = 10 + normalized * 34 * (0.55 + rand() * 0.95);
      const intensity = clamp(normalized * (0.75 + rand() * 0.55), 0.1, 1);

      points.push({
        id: `${region.key}-${i}`,
        region: region.key,
        xPct,
        yPct,
        intensity,
        size,
      });
    }
  }

  return points;
}

function touchDistance(
  t0: { pageX: number; pageY: number },
  t1: { pageX: number; pageY: number }
) {
  const dx = t1.pageX - t0.pageX;
  const dy = t1.pageY - t0.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeRegionKey(raw: unknown): RegionKey {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "americas") return "Americas";
  if (v === "europe") return "Europe";
  if (v === "asia") return "Asia";
  if (v === "africa") return "Africa";
  if (v === "oceania") return "Oceania";
  return "Global";
}

function cloneActiveByRegion(): Record<RegionKey, number> {
  return {
    Americas: 0,
    Europe: 0,
    Asia: 0,
    Africa: 0,
    Oceania: 0,
    Global: 0,
  };
}

function cloneEventsByRegion(): Record<RegionKey, HeatEventItem[]> {
  return {
    Americas: [],
    Europe: [],
    Asia: [],
    Africa: [],
    Oceania: [],
    Global: [],
  };
}

function cloneManifestationsByRegion(): Record<RegionKey, ManifestationItem[]> {
  return {
    Americas: [],
    Europe: [],
    Asia: [],
    Africa: [],
    Oceania: [],
    Global: [],
  };
}

function parseActiveByRegion(raw: unknown): Record<RegionKey, number> {
  const next = cloneActiveByRegion();
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!obj) return next;

  for (const region of REGIONS) {
    const n = Number(obj[region.key]);
    next[region.key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return next;
}

function parseLiveEvents(raw: unknown): Record<RegionKey, HeatEventItem[]> {
  const next = cloneEventsByRegion();
  if (!Array.isArray(raw)) return next;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    if (!id) continue;

    const region = normalizeRegionKey(row.region);
    next[region].push({
      id,
      title: String(row.title ?? "Untitled"),
      start_time_utc: String(row.start_time_utc ?? ""),
      end_time_utc: row.end_time_utc ? String(row.end_time_utc) : null,
      timezone: row.timezone ? String(row.timezone) : null,
      intention_statement: row.intention_statement ? String(row.intention_statement) : null,
      region,
    });
  }

  return next;
}

function parseManifestations(raw: unknown): Record<RegionKey, ManifestationItem[]> {
  const next = cloneManifestationsByRegion();
  if (!Array.isArray(raw)) return next;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const eventId = String(row.event_id ?? "").trim();
    const body = String(row.body ?? "").trim();
    if (!id || !eventId || !body) continue;

    const region = normalizeRegionKey(row.region);
    next[region].push({
      id,
      eventId,
      body,
      createdAt: String(row.created_at ?? ""),
      eventTitle: String(row.event_title ?? "Live circle"),
      region,
    });
  }

  for (const region of REGIONS) {
    next[region.key] = next[region.key].slice(0, 6);
  }

  return next;
}

function formatLocalDateTime(iso: string | null | undefined) {
  const t = new Date(String(iso ?? "")).getTime();
  if (!Number.isFinite(t)) return "Unknown time";
  return new Date(t).toLocaleString();
}

function formatLocalTime(iso: string | null | undefined) {
  const t = new Date(String(iso ?? "")).getTime();
  if (!Number.isFinite(t)) return "Unknown";
  return new Date(t).toLocaleTimeString();
}

function regionFromCoordinates(latitude: number, longitude: number): RegionKey {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "Global";
  if (lon >= -170 && lon <= -30) return "Americas";
  if (lon > -30 && lon <= 60 && lat >= 34) return "Europe";
  if (lon > -20 && lon <= 55 && lat < 34) return "Africa";
  if (lon > 55 && lon <= 180) return "Asia";
  if (lon > 110 && lat < -10) return "Oceania";
  if (lon < -170 || lon > 170) return "Oceania";
  return "Global";
}

export default function GlobalHeatMapScreen() {
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(false);
  const [locationOptIn, setLocationOptIn] = useState(false);
  const [activeByRegion, setActiveByRegion] = useState<Record<RegionKey, number>>(cloneActiveByRegion);
  const [liveEventsByRegion, setLiveEventsByRegion] = useState<Record<RegionKey, HeatEventItem[]>>(
    cloneEventsByRegion
  );
  const [selectedRegion, setSelectedRegion] = useState<RegionKey>("Americas");
  const [heatWindow, setHeatWindow] = useState<HeatWindow>("90s");
  const [manifestationsByRegion, setManifestationsByRegion] =
    useState<Record<RegionKey, ManifestationItem[]>>(cloneManifestationsByRegion);
  const [locationSyncState, setLocationSyncState] = useState<
    "idle" | "syncing" | "enabled" | "permission_denied" | "error"
  >("idle");
  const [detectedRegion, setDetectedRegion] = useState<RegionKey | null>(null);
  const [mapZoomTier, setMapZoomTier] = useState<MapTier>("World");
  const mapScale = useRef(new Animated.Value(1)).current;
  const mapTranslateX = useRef(new Animated.Value(0)).current;
  const mapTranslateY = useRef(new Animated.Value(0)).current;
  const mapScaleValueRef = useRef(1);
  const mapScaleBaseRef = useRef(1);
  const mapPanValueRef = useRef({ x: 0, y: 0 });
  const mapPanBaseRef = useRef({ x: 0, y: 0 });
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pulseValuesRef = useRef<Record<RegionKey, Animated.Value>>({
    Americas: new Animated.Value(0),
    Europe: new Animated.Value(0),
    Asia: new Animated.Value(0),
    Africa: new Animated.Value(0),
    Oceania: new Animated.Value(0),
    Global: new Animated.Value(0),
  });
  const pulseLoopsRef = useRef<Animated.CompositeAnimation[]>([]);
  const heatLoadInFlightRef = useRef(false);
  const queuedHeatLoadRef = useRef(false);

  const setMapZoomLevel = useCallback(
    (next: number) => {
      const clamped = clamp(next, 1, 3);
      mapScaleValueRef.current = clamped;
      mapScale.setValue(clamped);
      setMapZoomTier(resolveMapTier(clamped));
    },
    [mapScale]
  );

  const resetMapTransform = useCallback(() => {
    mapPanValueRef.current = { x: 0, y: 0 };
    mapPanBaseRef.current = { x: 0, y: 0 };
    mapTranslateX.setValue(0);
    mapTranslateY.setValue(0);
    mapScaleBaseRef.current = 1;
    setMapZoomLevel(1);
  }, [mapTranslateX, mapTranslateY, setMapZoomLevel]);

  useEffect(() => {
    if (pulseLoopsRef.current.length > 0) return;

    const loops: Animated.CompositeAnimation[] = [];
    for (const region of REGIONS) {
      const value = pulseValuesRef.current[region.key];
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      );
      loops.push(loop);
      loop.start();
    }
    pulseLoopsRef.current = loops;
    return () => {
      for (const loop of loops) loop.stop();
      pulseLoopsRef.current = [];
    };
  }, []);

  const mapPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const touches = evt.nativeEvent.touches;
          mapPanBaseRef.current = { ...mapPanValueRef.current };
          if (touches.length >= 2) {
            pinchStartDistanceRef.current = touchDistance(touches[0], touches[1]);
            mapScaleBaseRef.current = mapScaleValueRef.current;
          } else {
            pinchStartDistanceRef.current = null;
          }
        },
        onPanResponderMove: (evt, gesture) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            const currentDistance = touchDistance(touches[0], touches[1]);
            const baseDistance = pinchStartDistanceRef.current ?? currentDistance;
            if (!pinchStartDistanceRef.current) pinchStartDistanceRef.current = currentDistance;
            const ratio = baseDistance > 0 ? currentDistance / baseDistance : 1;
            setMapZoomLevel(mapScaleBaseRef.current * ratio);
            return;
          }

          const nextX = mapPanBaseRef.current.x + gesture.dx;
          const nextY = mapPanBaseRef.current.y + gesture.dy;
          mapPanValueRef.current = { x: nextX, y: nextY };
          mapTranslateX.setValue(nextX);
          mapTranslateY.setValue(nextY);
        },
        onPanResponderRelease: () => {
          pinchStartDistanceRef.current = null;
          mapPanBaseRef.current = { ...mapPanValueRef.current };
          mapScaleBaseRef.current = mapScaleValueRef.current;
        },
        onPanResponderTerminate: () => {
          pinchStartDistanceRef.current = null;
          mapPanBaseRef.current = { ...mapPanValueRef.current };
          mapScaleBaseRef.current = mapScaleValueRef.current;
        },
      }),
    [mapTranslateX, mapTranslateY, setMapZoomLevel]
  );

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
      const { data, error } = await supabase.rpc("get_global_heatmap_snapshot", {
        p_window: heatWindow,
        p_max_events: 500,
        p_max_manifestations: 300,
      });

      if (error) {
        console.log("[heatmap] snapshot rpc failed", error.message);
        return;
      }

      const rows = (data ?? []) as HeatSnapshotRow[];
      const row = rows[0] ?? null;

      if (!row) {
        setActiveByRegion(cloneActiveByRegion());
        setLiveEventsByRegion(cloneEventsByRegion());
        setManifestationsByRegion(cloneManifestationsByRegion());
        return;
      }

      setActiveByRegion(parseActiveByRegion((row as any).active_by_region));
      setLiveEventsByRegion(parseLiveEvents((row as any).live_events));
      setManifestationsByRegion(parseManifestations((row as any).manifestations));
    } finally {
      setLoading(false);
      heatLoadInFlightRef.current = false;
      if (queuedHeatLoadRef.current) {
        queuedHeatLoadRef.current = false;
        void loadHeatData();
      }
    }
  }, [heatWindow]);

  const syncLocationContribution = useCallback(
    async (opts?: { requestPermission?: boolean; showErrorAlert?: boolean }) => {
      const requestPermission = !!opts?.requestPermission;
      const showErrorAlert = !!opts?.showErrorAlert;
      try {
        setLocationSyncState("syncing");
        const permission = requestPermission
          ? await Location.requestForegroundPermissionsAsync()
          : await Location.getForegroundPermissionsAsync();

        if (!permission.granted) {
          setLocationSyncState("permission_denied");
          if (showErrorAlert) {
            Alert.alert(
              "Location permission required",
              "Enable location permission to contribute anonymous regional intensity."
            );
          }
          return false;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const region = regionFromCoordinates(position.coords.latitude, position.coords.longitude);
        setDetectedRegion(region);
        const { error } = await supabase.rpc("contribute_heatmap_region", { p_region: region });
        if (error) {
          setLocationSyncState("error");
          if (showErrorAlert) {
            Alert.alert(
              "Location sync failed",
              "We couldn't update your anonymous region right now. Please try again."
            );
          }
          return false;
        }
        setLocationSyncState("enabled");
        return true;
      } catch {
        setLocationSyncState("error");
        if (showErrorAlert) {
          Alert.alert(
            "Location sync failed",
            "We couldn't update your anonymous region right now. Please try again."
          );
        }
        return false;
      }
    },
    []
  );

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
        const optIn = raw === "1";
        if (!disposed) setLocationOptIn(optIn);
        if (!disposed) {
          if (optIn) {
            void syncLocationContribution({ requestPermission: false, showErrorAlert: false });
          } else {
            setLocationSyncState("idle");
            setDetectedRegion(null);
          }
        }
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
    }, [loadHeatData, syncLocationContribution])
  );

  useEffect(() => {
    if (!locationOptIn) return;
    let cancelled = false;

    const beat = async () => {
      if (cancelled) return;
      await syncLocationContribution({ requestPermission: false, showErrorAlert: false });
    };

    void beat();
    const intervalId = setInterval(() => {
      void beat();
    }, LOCATION_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [locationOptIn, syncLocationContribution]);

  const maxRegionValue = useMemo(
    () => Math.max(1, ...REGIONS.map((r) => activeByRegion[r.key] ?? 0)),
    [activeByRegion]
  );

  const totalActive = useMemo(
    () => REGIONS.reduce((sum, r) => sum + (activeByRegion[r.key] ?? 0), 0),
    [activeByRegion]
  );
  const hotspotPoints = useMemo(
    () =>
      buildHotspots({
        activeByRegion,
        maxRegionValue,
        selectedRegion,
        tier: mapZoomTier,
        heatWindow,
      }),
    [activeByRegion, heatWindow, mapZoomTier, maxRegionValue, selectedRegion]
  );
  const selectedRegionActive = activeByRegion[selectedRegion] ?? 0;
  const selectedRegionSharePct = useMemo(() => {
    if (totalActive <= 0) return 0;
    return Math.round((selectedRegionActive / totalActive) * 100);
  }, [selectedRegionActive, totalActive]);

  const selectedEvents = liveEventsByRegion[selectedRegion] ?? [];
  const selectedManifestations = manifestationsByRegion[selectedRegion] ?? [];

  const locationStatusLabel = useMemo(() => {
    if (!locationOptIn) return "Location sharing is off.";
    if (locationSyncState === "syncing") return "Syncing your anonymous region...";
    if (locationSyncState === "permission_denied") return "Location permission denied.";
    if (locationSyncState === "error") return "Could not sync anonymous region.";
    if (detectedRegion) return `Anonymous region active: ${detectedRegion}.`;
    return "Waiting for location sync...";
  }, [detectedRegion, locationOptIn, locationSyncState]);

  const onToggleLocation = useCallback(async (next: boolean) => {
    if (!next) {
      setLocationOptIn(false);
      setLocationSyncState("idle");
      setDetectedRegion(null);
      await AsyncStorage.setItem(KEY_LOCATION_OPT_IN, "0");
      return;
    }

    const synced = await syncLocationContribution({
      requestPermission: true,
      showErrorAlert: true,
    });
    if (!synced) {
      setLocationOptIn(false);
      await AsyncStorage.setItem(KEY_LOCATION_OPT_IN, "0");
      return;
    }

    setLocationOptIn(next);
    await AsyncStorage.setItem(KEY_LOCATION_OPT_IN, next ? "1" : "0");
  }, [syncLocationContribution]);

  const zoomIn = useCallback(() => {
    setMapZoomLevel(mapScaleValueRef.current * 1.25);
  }, [setMapZoomLevel]);

  const zoomOut = useCallback(() => {
    setMapZoomLevel(mapScaleValueRef.current / 1.25);
  }, [setMapZoomLevel]);

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
            <Text style={[styles.h1, { color: c.text }]}>Global Pulse Map</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>
              Real-time collective intention pulses across world regions. Zoom from world to city detail.
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
              <Text style={[styles.meta, { color: c.textMuted }]}>{locationStatusLabel}</Text>
              <Text style={[styles.metric, { color: c.text }]}>Active globally: {totalActive}</Text>
            </View>

            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Live Global Pulse</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                Pinch or drag to explore. Tap a pulse to focus a region.
              </Text>
              <View style={styles.row}>
                <Text style={[styles.meta, { color: c.textMuted }]}>Focused region: {selectedRegion}</Text>
                <Text style={[styles.meta, { color: c.text }]}>
                  {selectedRegionActive} active ({selectedRegionSharePct}%)
                </Text>
              </View>

              <View
                style={[styles.mapViewport, { borderColor: c.border, backgroundColor: c.background }]}
                {...mapPanResponder.panHandlers}
              >
                <Animated.View
                  style={[
                    styles.mapCanvas,
                    {
                      transform: [
                        { translateX: mapTranslateX },
                        { translateY: mapTranslateY },
                        { scale: mapScale },
                      ],
                    },
                  ]}
                >
                  <View style={[styles.continentBlob, styles.continentAmericas, { backgroundColor: c.cardAlt }]} />
                  <View style={[styles.continentBlob, styles.continentEurope, { backgroundColor: c.cardAlt }]} />
                  <View style={[styles.continentBlob, styles.continentAfrica, { backgroundColor: c.cardAlt }]} />
                  <View style={[styles.continentBlob, styles.continentAsia, { backgroundColor: c.cardAlt }]} />
                  <View style={[styles.continentBlob, styles.continentOceania, { backgroundColor: c.cardAlt }]} />
                  {MAP_GRID_LINES.map((pct) => (
                    <View key={`v-${pct}`} style={[styles.mapGridLineV, { left: `${pct}%`, borderColor: c.border }]} />
                  ))}
                  {MAP_GRID_LINES.map((pct) => (
                    <View key={`h-${pct}`} style={[styles.mapGridLineH, { top: `${pct}%`, borderColor: c.border }]} />
                  ))}

                  {hotspotPoints.map((spot) => {
                    const selected = selectedRegion === spot.region;
                    const pulse = pulseValuesRef.current[spot.region];
                    const color = heatColorForIntensity(spot.intensity);
                    const ringSize = Math.max(14, spot.size * (selected ? 1.16 : 1));
                    const coreSize = Math.max(4, ringSize * 0.24);
                    return (
                      <Pressable
                        key={spot.id}
                        style={[
                          styles.hotspotAnchor,
                          {
                            left: `${spot.xPct}%`,
                            top: `${spot.yPct}%`,
                          },
                        ]}
                        onPress={() => setSelectedRegion(spot.region)}
                      >
                        <Animated.View
                          style={[
                            styles.hotspotRing,
                            {
                              width: ringSize,
                              height: ringSize,
                              marginLeft: -ringSize / 2,
                              marginTop: -ringSize / 2,
                              borderColor: color,
                              opacity: pulse.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.18, 0.52],
                              }),
                              transform: [
                                {
                                  scale: pulse.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.88, 1.3],
                                  }),
                                },
                              ],
                            },
                          ]}
                        />
                        <View
                          style={[
                            styles.hotspotCore,
                            {
                              width: coreSize,
                              height: coreSize,
                              marginLeft: -coreSize / 2,
                              marginTop: -coreSize / 2,
                              backgroundColor: color,
                              borderColor: selected ? c.primary : c.background,
                            },
                          ]}
                        />
                      </Pressable>
                    );
                  })}

                  {REGIONS.map((region) => {
                    const value = activeByRegion[region.key] ?? 0;
                    const selected = selectedRegion === region.key;
                    const hasData = value > 0;

                    return (
                      <Pressable
                        key={region.key}
                        style={[
                          styles.pulseAnchor,
                          {
                            left: `${REGION_PLOT[region.key].xPct}%`,
                            top: `${REGION_PLOT[region.key].yPct}%`,
                          },
                        ]}
                        onPress={() => setSelectedRegion(region.key)}
                      >
                        <View
                          style={[
                            styles.regionPin,
                            {
                              borderColor: selected ? c.primary : c.border,
                              backgroundColor: selected ? c.cardAlt : c.card,
                            },
                          ]}
                        >
                          <View
                            style={[
                              hasData ? styles.pulseCore : styles.pulseCoreIdle,
                              hasData
                                ? {
                                    backgroundColor: selected ? c.primary : c.text,
                                    borderColor: c.background,
                                  }
                                : {
                                    borderColor: c.border,
                                    backgroundColor: c.card,
                                  },
                            ]}
                          />
                          <Text style={[styles.pulseCount, { color: c.text }]}>{value}</Text>
                        </View>
                        <Text style={[styles.pulseLabel, { color: selected ? c.text : c.textMuted }]}>
                          {region.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </Animated.View>
              </View>

              <View style={styles.zoomRow}>
                <Pressable
                  onPress={zoomOut}
                  style={[styles.zoomBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                >
                  <Text style={[styles.zoomBtnText, { color: c.text }]}>-</Text>
                </Pressable>
                <Pressable
                  onPress={zoomIn}
                  style={[styles.zoomBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                >
                  <Text style={[styles.zoomBtnText, { color: c.text }]}>+</Text>
                </Pressable>
                <Pressable
                  onPress={resetMapTransform}
                  style={[styles.zoomBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                >
                  <Text style={[styles.zoomBtnText, { color: c.text }]}>Reset</Text>
                </Pressable>
                <Text style={[styles.meta, { color: c.textMuted }]}>Zoom: {mapZoomTier}</Text>
              </View>
              <View style={styles.zoomTierRow}>
                {(["World", "Continent", "Country", "City"] as MapTier[]).map((tier) => {
                  const on = tier === mapZoomTier;
                  return (
                    <View
                      key={tier}
                      style={[
                        styles.zoomTierChip,
                        {
                          borderColor: on ? c.primary : c.border,
                          backgroundColor: on ? c.cardAlt : c.background,
                        },
                      ]}
                    >
                      <Text style={[styles.meta, { color: on ? c.text : c.textMuted }]}>{tier}</Text>
                    </View>
                  );
                })}
              </View>
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
                        {m.eventTitle} - {formatLocalTime(m.createdAt)}
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
            <Text style={[styles.eventTitle, { color: c.text }]}>{item.title || "Untitled"}</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>
              {formatLocalDateTime(item.start_time_utc)} ({String(item.timezone ?? "UTC")})
            </Text>
            <Text style={[styles.meta, { color: c.text }]} numberOfLines={2}>
              {String(item.intention_statement ?? "Live collective intention.")}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? <ActivityIndicator /> : <Text style={{ color: c.textMuted }}>No events in this window.</Text>}
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
  windowChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  mapViewport: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    height: 260,
  },
  mapCanvas: {
    width: "100%",
    height: "100%",
    backgroundColor: "#0D1328",
  },
  mapGridLineV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderLeftWidth: 1,
    opacity: 0.22,
  },
  mapGridLineH: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    opacity: 0.22,
  },
  continentBlob: {
    position: "absolute",
    borderRadius: 40,
    opacity: 0.82,
  },
  continentAmericas: {
    left: "10%",
    top: "22%",
    width: 80,
    height: 120,
  },
  continentEurope: {
    left: "43%",
    top: "20%",
    width: 50,
    height: 48,
  },
  continentAfrica: {
    left: "46%",
    top: "38%",
    width: 56,
    height: 78,
  },
  continentAsia: {
    left: "58%",
    top: "24%",
    width: 95,
    height: 95,
  },
  continentOceania: {
    left: "78%",
    top: "58%",
    width: 44,
    height: 36,
  },
  pulseAnchor: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    width: 120,
    marginLeft: -60,
    marginTop: -26,
    zIndex: 3,
  },
  hotspotAnchor: {
    position: "absolute",
    width: 14,
    height: 14,
    marginLeft: -7,
    marginTop: -7,
    zIndex: 2,
  },
  hotspotRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 1,
  },
  hotspotCore: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 1.5,
  },
  regionPin: {
    minWidth: 34,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  pulseCore: {
    width: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 2,
  },
  pulseCoreIdle: {
    width: 9,
    height: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  pulseLabel: {
    fontSize: 11,
    marginTop: 6,
    fontWeight: "700",
  },
  pulseCount: {
    fontSize: 12,
    fontWeight: "900",
  },
  zoomRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  zoomTierRow: {
    marginTop: 4,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  zoomTierChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  zoomBtn: {
    borderWidth: 1,
    borderRadius: 999,
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomBtnText: {
    fontSize: 12,
    fontWeight: "900",
  },
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
