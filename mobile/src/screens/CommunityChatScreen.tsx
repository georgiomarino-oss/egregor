import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useAppState } from "../state";
import { getScreenColors } from "../theme/appearance";
import {
  listConversationPreviews,
  subscribeDirectMessages,
  type ConversationPreview,
} from "../features/community/communityRepo";

export default function CommunityChatScreen() {
  const navigation = useNavigation<any>();
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getScreenColors(theme, highContrast, "home"), [theme, highContrast]);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listConversationPreviews();
      setConversations(rows);
    } catch (error: any) {
      Alert.alert("Community chat unavailable", String(error?.message ?? "Could not load conversations."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const sub = subscribeDirectMessages(() => void load());
    return () => sub.unsubscribe();
  }, [load]);

  const openConversation = useCallback(
    (row: ConversationPreview) => {
      navigation.navigate("DirectChat", {
        peerUserId: row.peerUserId,
        peerDisplayName: row.peerName,
      });
    },
    [navigation]
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.primary} />}
      >
        <View style={[styles.heroCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.kicker, { color: c.textMuted }]}>COMMUNITY CHAT</Text>
          <Text style={[styles.title, { color: c.text }]}>Conversations with your circle</Text>
          <Text style={[styles.subtitle, { color: c.textMuted }]}>
            Discuss upcoming intentions, event outcomes, and shared progress with your Egregor Circle.
          </Text>
          <Pressable
            style={[styles.ctaBtn, { backgroundColor: c.primary }]}
            onPress={() => navigation.navigate("EgregorCircle")}
          >
            <Text style={styles.ctaBtnText}>Open Egregor Circle</Text>
          </Pressable>
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Recent conversations</Text>
          {loading && !conversations.length ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator />
            </View>
          ) : !conversations.length ? (
            <Text style={[styles.emptyText, { color: c.textMuted }]}>
              No chats yet. Open Egregor Circle and send a request-to-chat.
            </Text>
          ) : (
            conversations.map((row) => (
              <Pressable
                key={row.peerUserId}
                onPress={() => openConversation(row)}
                style={[styles.rowCard, { borderColor: c.border, backgroundColor: c.cardAlt }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
                    {row.peerName}
                  </Text>
                  <Text style={[styles.rowBody, { color: c.textMuted }]} numberOfLines={1}>
                    {row.lastMessageBody}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={[styles.rowTime, { color: c.textMuted }]}>
                    {row.lastMessageAt ? new Date(row.lastMessageAt).toLocaleTimeString() : ""}
                  </Text>
                  {row.unreadCount > 0 ? (
                    <View style={[styles.badge, { backgroundColor: c.primary }]}>
                      <Text style={styles.badgeText}>{row.unreadCount}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 36, gap: 12 },
  heroCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "900" },
  subtitle: { fontSize: 13, lineHeight: 18 },
  ctaBtn: {
    marginTop: 2,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  ctaBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  section: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900" },
  loadingRow: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 13 },
  rowCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowTitle: { fontSize: 14, fontWeight: "800" },
  rowBody: { marginTop: 2, fontSize: 12 },
  rowRight: { alignItems: "flex-end", gap: 6 },
  rowTime: { fontSize: 10, fontWeight: "700" },
  badge: { minWidth: 20, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, alignItems: "center" },
  badgeText: { color: "#fff", fontWeight: "900", fontSize: 11 },
});

