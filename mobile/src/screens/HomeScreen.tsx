import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { supabase } from "../supabase/client";
import type { Database } from "../types/db";
import type { RootStackParamList } from "../types";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";

type EventRow = Database["public"]["Tables"]["events"]["Row"];

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

export default function HomeScreen() {
  const { theme } = useAppState();
  const c = useMemo(() => getAppColors(theme), [theme]);
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [weeklyImpact, setWeeklyImpact] = useState(0);

  const liveEvents = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => {
      const start = safeTimeMs((e as any).start_time_utc);
      const end = safeTimeMs((e as any).end_time_utc);
      return start > 0 && start <= now && (end <= 0 || now <= end);
    });
  }, [events]);

  const recommendedEvents = useMemo(() => {
    const now = Date.now();
    return [...events]
      .filter((e) => safeTimeMs((e as any).end_time_utc) >= now)
      .sort((a, b) => safeTimeMs((a as any).start_time_utc) - safeTimeMs((b as any).start_time_utc))
      .slice(0, 6);
  }, [events]);

  const activeNow = useMemo(() => {
    return liveEvents.reduce((sum, e) => sum + Number((e as any).active_count_snapshot ?? 0), 0);
  }, [liveEvents]);

  const loadHome = useCallback(async () => {
    setLoading(true);
    try {
      const { data: eventRows } = await supabase
        .from("events")
        .select(
          "id,title,intention_statement,start_time_utc,end_time_utc,timezone,active_count_snapshot,total_join_count,host_user_id"
        )
        .order("start_time_utc", { ascending: true })
        .limit(80);

      setEvents((eventRows ?? []) as EventRow[]);

      const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("event_presence")
        .select("*", { count: "exact", head: true })
        .gte("last_seen_at", weekAgoIso);

      setWeeklyImpact(count ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadHome();
    }, [loadHome])
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

  const joinLiveNow = useCallback(() => {
    const live = liveEvents[0];
    if (!live) {
      Alert.alert("No live events", "There is no live event right now. Try one of the upcoming circles.");
      return;
    }
    openEventRoom(live.id);
  }, [liveEvents, openEventRoom]);

  const renderEvent = ({ item }: { item: EventRow }) => {
    const startMs = safeTimeMs((item as any).start_time_utc);
    const label = startMs ? new Date(startMs).toLocaleString() : "Unknown time";
    return (
      <Pressable style={[styles.eventCard, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => openEventRoom(item.id)}>
        <Text style={[styles.eventTitle, { color: c.text }]}>{String((item as any).title ?? "Untitled")}</Text>
        <Text style={[styles.eventMeta, { color: c.textMuted }]}>{label}</Text>
        <Text style={[styles.eventMeta, { color: c.text }]}>
          {(item as any).intention_statement
            ? String((item as any).intention_statement)
            : `Host ${shortId(String((item as any).host_user_id ?? ""))}`}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <View style={[styles.glow, { backgroundColor: c.glowA, top: -80, right: -40 }]} />
      <View style={[styles.glow, { backgroundColor: c.glowB, bottom: 140, left: -60 }]} />

      <FlatList
        data={recommendedEvents}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadHome} tintColor={c.primary} />}
        ListHeaderComponent={
          <View style={styles.content}>
            <Text style={[styles.kicker, { color: c.textMuted }]}>EGREGOR</Text>
            <Text style={[styles.hero, { color: c.text }]}>What is your intention today?</Text>
            <Text style={[styles.subtitle, { color: c.text }]}>
              Join a synchronized global circle or begin your own focused moment.
            </Text>

            <View style={styles.row}>
              <Pressable style={[styles.primaryBtn, { backgroundColor: c.primary }]} onPress={joinLiveNow}>
                <Text style={[styles.primaryBtnText, { color: "#FFFFFF" }]}>Join Live Now</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.card }]}
                onPress={() => navigation.navigate("Events")}
              >
                <Text style={[styles.secondaryBtnText, { color: c.text }]}>Browse Events</Text>
              </Pressable>
            </View>

            <View style={styles.metricsRow}>
              <View style={[styles.metricCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.metricValue, { color: c.text }]}>{liveEvents.length}</Text>
                <Text style={[styles.metricLabel, { color: c.textMuted }]}>Live circles</Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.metricValue, { color: c.text }]}>{activeNow}</Text>
                <Text style={[styles.metricLabel, { color: c.textMuted }]}>Active now</Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: c.card, borderColor: c.border }]}>
                <Text style={[styles.metricValue, { color: c.text }]}>{weeklyImpact}</Text>
                <Text style={[styles.metricLabel, { color: c.textMuted }]}>Prayers this week</Text>
              </View>
            </View>

            <View style={[styles.sectionCard, { backgroundColor: c.chip, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.chipText }]}>Recommended Events</Text>
              <Text style={[styles.sectionMeta, { color: c.textMuted }]}>
                Tap any event below to enter the live room in sync.
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={{ color: c.textMuted }}>No events available yet.</Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  glow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 999,
    opacity: 0.32,
  },
  content: {
    padding: 16,
    gap: 10,
  },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: "800" },
  hero: { fontSize: 30, fontWeight: "900", lineHeight: 36 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 6 },
  row: { flexDirection: "row", gap: 10 },
  primaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontWeight: "900" },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontWeight: "900" },
  metricsRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: { fontSize: 22, fontWeight: "900" },
  metricLabel: { fontSize: 12, fontWeight: "700" },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  sectionMeta: { fontSize: 12, marginTop: 4 },
  eventCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  eventTitle: { fontSize: 16, fontWeight: "800", marginBottom: 4 },
  eventMeta: { fontSize: 12, lineHeight: 17 },
  empty: {
    paddingVertical: 28,
    alignItems: "center",
    justifyContent: "center",
  },
});
