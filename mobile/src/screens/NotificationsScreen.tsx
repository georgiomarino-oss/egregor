import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase/client";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";
import type { Database } from "../types/db";
import type { RootStackParamList } from "../types";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type PresenceRow = Database["public"]["Tables"]["event_presence"]["Row"];
type EventMessageRow = Database["public"]["Tables"]["event_messages"]["Row"];

type NotificationItem = {
  id: string;
  kind: "live" | "soon" | "streak" | "community" | "news" | "invite";
  title: string;
  body: string;
  atIso: string;
  eventId?: string;
};

type ProfilePrefs = {
  notifyLiveStart: boolean;
  notifyNewsEvents: boolean;
  notifyFriendInvites: boolean;
  notifyStreakReminders: boolean;
};

const KEY_PROFILE_PREFS = "profile:prefs:v1";
const DEFAULT_PREFS: ProfilePrefs = {
  notifyLiveStart: true,
  notifyNewsEvents: true,
  notifyFriendInvites: true,
  notifyStreakReminders: true,
};

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function timeAgo(iso: string) {
  const ts = safeTimeMs(iso);
  if (!ts) return "now";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function normalizePrefs(raw: any): ProfilePrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  return {
    notifyLiveStart: !!raw.notifyLiveStart,
    notifyNewsEvents: !!raw.notifyNewsEvents,
    notifyFriendInvites: !!raw.notifyFriendInvites,
    notifyStreakReminders: !!raw.notifyStreakReminders,
  };
}

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);

  const openEvent = useCallback(
    (eventId: string) => {
      if (!eventId || !isLikelyUuid(eventId)) return;
      const parent = navigation.getParent?.() ?? navigation;
      (parent as any).navigate("EventRoom" as keyof RootStackParamList, { eventId });
    },
    [navigation]
  );

  const shareInvite = useCallback(async () => {
    try {
      await Share.share({
        message:
          "Join me on Egregor for synchronized global intention circles. Create or join a live event and practice together.",
      });
    } catch {
      // ignore
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prefsRaw = await AsyncStorage.getItem(KEY_PROFILE_PREFS);
      const prefs = normalizePrefs(prefsRaw ? JSON.parse(prefsRaw) : null);
      const nowMs = Date.now();
      const soonWindowMs = 60 * 60 * 1000;
      const crisisKeywords = ["earthquake", "flood", "wildfire", "hurricane", "war", "crisis"];

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id ?? "";

      const [{ data: eventsRows }, { data: latestMessages }, { data: myPresenceRows }] = await Promise.all([
        supabase
          .from("events")
          .select("id,title,intention_statement,start_time_utc,end_time_utc,timezone")
          .order("start_time_utc", { ascending: true })
          .limit(120),
        supabase
          .from("event_messages")
          .select("id,event_id,body,created_at")
          .order("created_at", { ascending: false })
          .limit(25),
        uid
          ? supabase
              .from("event_presence")
              .select("last_seen_at")
              .eq("user_id", uid)
              .order("last_seen_at", { ascending: false })
              .limit(50)
          : Promise.resolve({ data: [] as Pick<PresenceRow, "last_seen_at">[] }),
      ]);

      const events = (eventsRows ?? []) as Pick<
        EventRow,
        "id" | "title" | "intention_statement" | "start_time_utc" | "end_time_utc" | "timezone"
      >[];
      const msgs = (latestMessages ?? []) as Pick<EventMessageRow, "id" | "event_id" | "body" | "created_at">[];
      const myPresence = (myPresenceRows ?? []) as Pick<PresenceRow, "last_seen_at">[];

      const next: NotificationItem[] = [];

      if (prefs.notifyLiveStart) {
        for (const e of events) {
          const startMs = safeTimeMs((e as any).start_time_utc);
          const endMs = safeTimeMs((e as any).end_time_utc);
          if (!startMs) continue;

          const isLive = startMs <= nowMs && (endMs <= 0 || nowMs <= endMs);
          if (isLive) {
            next.push({
              id: `live:${e.id}`,
              kind: "live",
              title: `${String((e as any).title ?? "Event")} is live now`,
              body: "Join now to sync with the active circle.",
              atIso: String((e as any).start_time_utc ?? new Date().toISOString()),
              eventId: String((e as any).id ?? ""),
            });
            continue;
          }

          const msUntil = startMs - nowMs;
          if (msUntil > 0 && msUntil <= soonWindowMs) {
            const mins = Math.max(1, Math.round(msUntil / 60_000));
            next.push({
              id: `soon:${e.id}`,
              kind: "soon",
              title: `${String((e as any).title ?? "Event")} starts in ${mins}m`,
              body: "Tap to open the room before the session begins.",
              atIso: String((e as any).start_time_utc ?? new Date().toISOString()),
              eventId: String((e as any).id ?? ""),
            });
          }
        }
      }

      if (prefs.notifyNewsEvents) {
        for (const e of events) {
          const title = String((e as any).title ?? "").toLowerCase();
          const intention = String((e as any).intention_statement ?? "").toLowerCase();
          const looksLikeCrisis = crisisKeywords.some(
            (kw) => title.includes(kw) || intention.includes(kw)
          );
          if (!looksLikeCrisis) continue;
          next.push({
            id: `news:${e.id}`,
            kind: "news",
            title: "Compassion alert event available",
            body: String((e as any).title ?? "Crisis support circle"),
            atIso: String((e as any).start_time_utc ?? new Date().toISOString()),
            eventId: String((e as any).id ?? ""),
          });
        }
      }

      if (prefs.notifyStreakReminders && uid) {
        const hasPresenceToday = myPresence.some((r) => {
          const t = safeTimeMs((r as any).last_seen_at);
          if (!t) return false;
          const d = new Date(t);
          const now = new Date();
          return (
            d.getUTCFullYear() === now.getUTCFullYear() &&
            d.getUTCMonth() === now.getUTCMonth() &&
            d.getUTCDate() === now.getUTCDate()
          );
        });
        if (!hasPresenceToday) {
          next.push({
            id: "streak:today",
            kind: "streak",
            title: "Keep your streak alive",
            body: "Join one live circle today to keep your momentum.",
            atIso: new Date().toISOString(),
          });
        }
      }

      const community = msgs
        .filter((m) => String((m as any).body ?? "").trim().length > 0)
        .slice(0, 4);
      for (const m of community) {
        next.push({
          id: `community:${String((m as any).id ?? "")}`,
          kind: "community",
          title: "New community intention shared",
          body: String((m as any).body ?? ""),
          atIso: String((m as any).created_at ?? new Date().toISOString()),
          eventId: String((m as any).event_id ?? ""),
        });
      }

      if (prefs.notifyFriendInvites) {
        next.push({
          id: "invite:share",
          kind: "invite",
          title: "Invite friends to your circle",
          body: "Share Egregor and build your own intention group.",
          atIso: new Date().toISOString(),
        });
      }

      next.sort((a, b) => safeTimeMs(b.atIso) - safeTimeMs(a.atIso));
      setItems(next.slice(0, 40));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <Text style={[styles.h1, { color: c.text }]}>Notifications</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>
              Live circles, reminders, and community updates.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.title, { color: c.text }]}>{item.title}</Text>
            <Text style={[styles.body, { color: c.textMuted }]}>{item.body}</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>{timeAgo(item.atIso)}</Text>

            <View style={styles.row}>
              {item.eventId && isLikelyUuid(item.eventId) ? (
                <Pressable
                  style={[styles.btn, { backgroundColor: c.primary }]}
                  onPress={() => openEvent(item.eventId!)}
                >
                  <Text style={styles.btnText}>Open event</Text>
                </Pressable>
              ) : null}
              {item.kind === "invite" ? (
                <Pressable
                  style={[styles.btnGhost, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                  onPress={shareInvite}
                >
                  <Text style={[styles.btnGhostText, { color: c.text }]}>Share invite</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.meta, { color: c.textMuted }]}>No notifications right now.</Text>
            </View>
          )
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerWrap: { marginBottom: 10, gap: 6 },
  h1: { fontSize: 28, fontWeight: "900" },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    gap: 4,
  },
  title: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 13, lineHeight: 18 },
  meta: { fontSize: 12 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 6 },
  btn: {
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#FFFFFF", fontWeight: "800" },
  btnGhost: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: { fontWeight: "800" },
  empty: { paddingVertical: 24, alignItems: "center", justifyContent: "center" },
});
