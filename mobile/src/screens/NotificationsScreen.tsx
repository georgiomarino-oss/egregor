import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";
import { supabase } from "../supabase/client";
import type { RootStackParamList } from "../types";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  readNotificationIds,
  type NotificationItem,
} from "../features/notifications/notificationsRepo";

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

export default function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const loadInFlightRef = useRef(false);
  const queuedLoadRef = useRef(false);

  const readSet = useMemo(() => new Set(readIds), [readIds]);
  const unreadCount = useMemo(
    () => items.reduce((sum, n) => sum + (readSet.has(n.id) ? 0 : 1), 0),
    [items, readSet]
  );

  const openEvent = useCallback(
    async (eventId: string, notificationId?: string) => {
      if (notificationId) {
        await markNotificationRead(notificationId);
        setReadIds((prev) => (prev.includes(notificationId) ? prev : [notificationId, ...prev]));
      }
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
    if (loadInFlightRef.current) {
      queuedLoadRef.current = true;
      return;
    }
    loadInFlightRef.current = true;
    setLoading(true);
    try {
      const [nextItems, nextRead] = await Promise.all([listNotifications(), readNotificationIds()]);
      setItems(nextItems);
      setReadIds(nextRead);
    } finally {
      setLoading(false);
      loadInFlightRef.current = false;
      if (queuedLoadRef.current) {
        queuedLoadRef.current = false;
        void load();
      }
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    const [nextRead, nextUnread] = await Promise.all([readNotificationIds(), getUnreadNotificationCount()]);
    setReadIds(nextRead);
    if (nextUnread === 0) return;
    await load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let disposed = false;
      let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
      const scheduleRefresh = () => {
        if (disposed || refreshTimeout) return;
        refreshTimeout = setTimeout(() => {
          refreshTimeout = null;
          if (disposed) return;
          void load();
        }, 1200);
      };

      void load();
      const intervalId = setInterval(() => {
        void load();
      }, 30_000);

      const realtime = supabase
        .channel("notifications:refresh")
        .on("postgres_changes", { event: "*", schema: "public", table: "events" }, scheduleRefresh)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "event_messages" },
          scheduleRefresh
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "event_presence" }, scheduleRefresh)
        .subscribe();

      return () => {
        disposed = true;
        clearInterval(intervalId);
        if (refreshTimeout) clearTimeout(refreshTimeout);
        supabase.removeChannel(realtime);
      };
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
            <View style={styles.headerRow}>
              <Text style={[styles.h1, { color: c.text }]}>Notifications</Text>
              <Pressable
                style={[styles.btnGhost, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                onPress={handleMarkAllRead}
                disabled={unreadCount === 0}
              >
                <Text style={[styles.btnGhostText, { color: c.text }, unreadCount === 0 && styles.dimmed]}>
                  Mark all read
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.meta, { color: c.textMuted }]}>
              {unreadCount} unread • live circles, reminders, and community updates.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isRead = readSet.has(item.id);
          return (
            <View
              style={[
                styles.card,
                { backgroundColor: c.card, borderColor: c.border },
                !isRead && { borderColor: c.primary },
              ]}
            >
              <View style={styles.headerRow}>
                <Text style={[styles.title, { color: c.text }]}>{item.title}</Text>
                {!isRead ? <View style={[styles.unreadDot, { backgroundColor: c.primary }]} /> : null}
              </View>
              <Text style={[styles.body, { color: c.textMuted }]}>{item.body}</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>{timeAgo(item.atIso)}</Text>

              <View style={styles.row}>
                {item.eventId && isLikelyUuid(item.eventId) ? (
                  <Pressable
                    style={[styles.btn, { backgroundColor: c.primary }]}
                    onPress={() => void openEvent(item.eventId!, item.id)}
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
                {!isRead ? (
                  <Pressable
                    style={[styles.btnGhost, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                    onPress={async () => {
                      await markNotificationRead(item.id);
                      setReadIds((prev) => (prev.includes(item.id) ? prev : [item.id, ...prev]));
                    }}
                  >
                    <Text style={[styles.btnGhostText, { color: c.text }]}>Mark read</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }}
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
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  h1: { fontSize: 28, fontWeight: "900" },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    gap: 4,
  },
  title: { fontSize: 15, fontWeight: "800", flex: 1 },
  body: { fontSize: 13, lineHeight: 18 },
  meta: { fontSize: 12 },
  unreadDot: { width: 9, height: 9, borderRadius: 999 },
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
  dimmed: { opacity: 0.5 },
  empty: { paddingVertical: 24, alignItems: "center", justifyContent: "center" },
});
