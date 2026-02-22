import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { supabase } from "../supabase/client";
import { useAppState } from "../state";
import { getScreenColors } from "../theme/appearance";
import type { RootStackParamList } from "../types";
import {
  listConversationMessages,
  markConversationRead,
  sendDirectMessage,
  subscribeDirectMessages,
  type DirectMessageRow,
} from "../features/community/communityRepo";

type DirectChatRoute = RouteProp<RootStackParamList, "DirectChat">;

function timeLabel(iso: string) {
  const value = String(iso ?? "").trim();
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DirectChatScreen() {
  const route = useRoute<DirectChatRoute>();
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getScreenColors(theme, highContrast, "home"), [theme, highContrast]);
  const peerUserId = String(route.params?.peerUserId ?? "").trim();
  const peerDisplayName = String(route.params?.peerDisplayName ?? "").trim() || "Egregor Member";
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [myUserId, setMyUserId] = useState("");
  const [messages, setMessages] = useState<DirectMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    if (!peerUserId) return;
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = String(user?.id ?? "");
      setMyUserId(uid);
      const rows = await listConversationMessages(peerUserId);
      setMessages(rows);
      await markConversationRead(peerUserId);
    } catch (error: any) {
      Alert.alert("Chat unavailable", String(error?.message ?? "Could not load this conversation."));
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    }
  }, [peerUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sub = subscribeDirectMessages((row) => {
      const sender = String(row.sender_user_id ?? "");
      const recipient = String(row.recipient_user_id ?? "");
      const me = String(myUserId ?? "");
      const peer = peerUserId;
      const belongs =
        (sender === me && recipient === peer) ||
        (sender === peer && recipient === me);
      if (!belongs) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === row.id)) return prev;
        return [...prev, row];
      });
      if (recipient === me) {
        void markConversationRead(peerUserId);
      }
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 20);
    });
    return () => sub.unsubscribe();
  }, [myUserId, peerUserId]);

  const onSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || !peerUserId) return;
    setSending(true);
    try {
      await sendDirectMessage(peerUserId, body);
      setDraft("");
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 20);
    } catch (error: any) {
      Alert.alert("Message failed", String(error?.message ?? "Could not send this message."));
    } finally {
      setSending(false);
    }
  }, [draft, peerUserId]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 72 : 14}
      >
        <View style={[styles.header, { borderBottomColor: c.border, backgroundColor: c.card }]}>
          <Text style={[styles.headerKicker, { color: c.textMuted }]}>DIRECT CHAT</Text>
          <Text style={[styles.headerTitle, { color: c.text }]} numberOfLines={1}>
            {peerDisplayName}
          </Text>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.messagesContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator />
            </View>
          ) : !messages.length ? (
            <View style={[styles.emptyCard, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
              <Text style={[styles.emptyTitle, { color: c.text }]}>No messages yet</Text>
              <Text style={[styles.emptyMeta, { color: c.textMuted }]}>
                Start with a kind intention and begin your first conversation.
              </Text>
            </View>
          ) : (
            messages.map((message) => {
              const mine = String(message.sender_user_id ?? "") === myUserId;
              return (
                <View
                  key={message.id}
                  style={[
                    styles.bubbleWrap,
                    mine ? styles.bubbleWrapMine : styles.bubbleWrapOther,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      {
                        backgroundColor: mine ? c.primary : c.card,
                        borderColor: mine ? c.primary : c.border,
                      },
                    ]}
                  >
                    <Text style={[styles.bubbleText, { color: mine ? "#fff" : c.text }]}>{message.body}</Text>
                    <Text style={[styles.bubbleMeta, { color: mine ? "#EAF1FF" : c.textMuted }]}>
                      {timeLabel(message.created_at)}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        <View style={[styles.composer, { borderTopColor: c.border, backgroundColor: c.card }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Send a message..."
            placeholderTextColor={c.textMuted}
            style={[styles.input, { borderColor: c.border, backgroundColor: c.cardAlt, color: c.text }]}
            multiline
            maxLength={2000}
            returnKeyType="send"
            onSubmitEditing={() => {
              if (Platform.OS !== "ios") void onSend();
            }}
          />
          <Pressable
            disabled={sending || !draft.trim()}
            onPress={() => void onSend()}
            style={[
              styles.sendBtn,
              { backgroundColor: c.primary, opacity: sending || !draft.trim() ? 0.55 : 1 },
            ]}
          >
            <Text style={styles.sendBtnText}>{sending ? "..." : "Send"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerKicker: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  headerTitle: { marginTop: 4, fontSize: 18, fontWeight: "900" },
  messagesContent: { padding: 12, gap: 8, paddingBottom: 16 },
  loadingRow: { minHeight: 120, alignItems: "center", justifyContent: "center" },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: "900" },
  emptyMeta: { marginTop: 6, fontSize: 13, lineHeight: 18 },
  bubbleWrap: { width: "100%", flexDirection: "row" },
  bubbleWrapMine: { justifyContent: "flex-end" },
  bubbleWrapOther: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "82%",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 11,
    gap: 5,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleMeta: { fontSize: 10, fontWeight: "700", textAlign: "right" },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
});

