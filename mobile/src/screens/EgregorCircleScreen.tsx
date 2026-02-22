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
  cancelCircleRequest,
  listCircleMembers,
  listDiscoverProfiles,
  listIncomingCircleRequests,
  listOutgoingCircleRequests,
  respondToCircleRequest,
  sendCircleRequest,
  subscribeCircleMemberships,
  subscribeCircleRequests,
  type CircleMemberProfile,
  type CircleRequestRow,
} from "../features/community/communityRepo";
import { supabase } from "../supabase/client";

type RequestDisplay = CircleRequestRow & { peerName: string; peerId: string };

function compactName(raw: string) {
  const clean = String(raw ?? "").trim().replace(/\s+/g, " ");
  return clean || "Egregor Member";
}

export default function EgregorCircleScreen() {
  const navigation = useNavigation<any>();
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getScreenColors(theme, highContrast, "home"), [theme, highContrast]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<CircleMemberProfile[]>([]);
  const [discover, setDiscover] = useState<CircleMemberProfile[]>([]);
  const [incoming, setIncoming] = useState<RequestDisplay[]>([]);
  const [outgoing, setOutgoing] = useState<RequestDisplay[]>([]);
  const [busyId, setBusyId] = useState("");

  const hydrateRequestNames = useCallback(
    async (rows: CircleRequestRow[], source: "incoming" | "outgoing"): Promise<RequestDisplay[]> => {
      if (!rows.length) return [];
      const peerIds = rows
        .map((row) =>
          source === "incoming"
            ? String(row.requester_user_id ?? "")
            : String(row.target_user_id ?? "")
        )
        .filter(Boolean);

      if (!peerIds.length) {
        return rows.map((row) => ({
          ...row,
          peerId:
            source === "incoming"
              ? String(row.requester_user_id ?? "")
              : String(row.target_user_id ?? ""),
          peerName: "Egregor Member",
        }));
      }

      const { data: profiles } = await (supabase as any)
        .from("profiles")
        .select("id,display_name,first_name,last_name")
        .in("id", peerIds);

      const map = new Map<string, string>();
      for (const profile of profiles ?? []) {
        const p = profile as any;
        const first = String(p?.first_name ?? "").trim();
        const last = String(p?.last_name ?? "").trim();
        const display = String(p?.display_name ?? "").trim();
        const resolved = first ? [first, last].filter(Boolean).join(" ") : display || "Egregor Member";
        map.set(String(p?.id ?? ""), compactName(resolved));
      }

      return rows.map((row) => {
        const peerId =
          source === "incoming"
            ? String(row.requester_user_id ?? "")
            : String(row.target_user_id ?? "");
        return {
          ...row,
          peerId,
          peerName: map.get(peerId) ?? "Egregor Member",
        };
      });
    },
    []
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [memberRows, discoverRows, incomingRows, outgoingRows] = await Promise.all([
        listCircleMembers(),
        listDiscoverProfiles(80),
        listIncomingCircleRequests(),
        listOutgoingCircleRequests(),
      ]);
      const [incomingNamed, outgoingNamed] = await Promise.all([
        hydrateRequestNames(incomingRows, "incoming"),
        hydrateRequestNames(outgoingRows, "outgoing"),
      ]);
      setMembers(memberRows);
      setDiscover(discoverRows);
      setIncoming(incomingNamed);
      setOutgoing(outgoingNamed);
    } catch (error: any) {
      Alert.alert("Circle unavailable", String(error?.message ?? "Failed to load your Egregor Circle."));
    } finally {
      setLoading(false);
    }
  }, [hydrateRequestNames]);

  useEffect(() => {
    void loadAll();
    const reqSub = subscribeCircleRequests(() => void loadAll());
    const memSub = subscribeCircleMemberships(() => void loadAll());
    return () => {
      reqSub.unsubscribe();
      memSub.unsubscribe();
    };
  }, [loadAll]);

  const pendingOutgoingTargets = useMemo(() => {
    const set = new Set<string>();
    for (const request of outgoing) set.add(request.peerId);
    return set;
  }, [outgoing]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const sendRequest = useCallback(
    async (peer: CircleMemberProfile) => {
      setBusyId(peer.id);
      try {
        await sendCircleRequest(peer.id);
        await loadAll();
        Alert.alert("Request sent", `Chat request sent to ${peer.displayName}.`);
      } catch (error: any) {
        Alert.alert("Could not send request", String(error?.message ?? "Try again."));
      } finally {
        setBusyId("");
      }
    },
    [loadAll]
  );

  const acceptRequest = useCallback(
    async (request: RequestDisplay) => {
      setBusyId(request.id);
      try {
        await respondToCircleRequest(request.id, true);
        await loadAll();
      } catch (error: any) {
        Alert.alert("Could not accept request", String(error?.message ?? "Try again."));
      } finally {
        setBusyId("");
      }
    },
    [loadAll]
  );

  const declineRequest = useCallback(
    async (request: RequestDisplay) => {
      setBusyId(request.id);
      try {
        await respondToCircleRequest(request.id, false);
        await loadAll();
      } catch (error: any) {
        Alert.alert("Could not decline request", String(error?.message ?? "Try again."));
      } finally {
        setBusyId("");
      }
    },
    [loadAll]
  );

  const cancelRequest = useCallback(
    async (request: RequestDisplay) => {
      setBusyId(request.id);
      try {
        await cancelCircleRequest(request.id);
        await loadAll();
      } catch (error: any) {
        Alert.alert("Could not cancel request", String(error?.message ?? "Try again."));
      } finally {
        setBusyId("");
      }
    },
    [loadAll]
  );

  const openChat = useCallback(
    (peerId: string, peerName: string) => {
      navigation.navigate("DirectChat", {
        peerUserId: peerId,
        peerDisplayName: peerName,
      });
    },
    [navigation]
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={c.primary} />}
      >
        <View style={[styles.heroCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.kicker, { color: c.textMuted }]}>EGREGOR CIRCLE</Text>
          <Text style={[styles.title, { color: c.text }]}>Your Community Members</Text>
          <Text style={[styles.subtitle, { color: c.textMuted }]}>
            Build your trusted circle, approve chat requests, and connect one-to-one.
          </Text>
          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
              <Text style={[styles.metricValue, { color: c.text }]}>{members.length}</Text>
              <Text style={[styles.metricLabel, { color: c.textMuted }]}>Circle members</Text>
            </View>
            <View style={[styles.metricCard, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
              <Text style={[styles.metricValue, { color: c.text }]}>{incoming.length}</Text>
              <Text style={[styles.metricLabel, { color: c.textMuted }]}>Pending requests</Text>
            </View>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Incoming Request-to-Chat</Text>
          {!incoming.length ? (
            <Text style={[styles.emptyText, { color: c.textMuted }]}>No incoming requests right now.</Text>
          ) : (
            incoming.map((request) => (
              <View key={request.id} style={[styles.rowCard, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: c.text }]}>{request.peerName}</Text>
                  <Text style={[styles.rowMeta, { color: c.textMuted }]}>
                    Requested {new Date(request.created_at).toLocaleString()}
                  </Text>
                </View>
                <Pressable
                  disabled={busyId === request.id}
                  onPress={() => void acceptRequest(request)}
                  style={[styles.acceptBtn, { backgroundColor: c.primary }]}
                >
                  <Text style={styles.acceptBtnText}>{busyId === request.id ? "..." : "Accept"}</Text>
                </Pressable>
                <Pressable
                  disabled={busyId === request.id}
                  onPress={() => void declineRequest(request)}
                  style={[styles.declineBtn, { borderColor: c.border, backgroundColor: c.card }]}
                >
                  <Text style={[styles.declineBtnText, { color: c.text }]}>Decline</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Community Members</Text>
          {!members.length ? (
            <Text style={[styles.emptyText, { color: c.textMuted }]}>
              Your circle is empty. Send request-to-chat invites below.
            </Text>
          ) : (
            members.map((member) => (
              <View key={member.id} style={[styles.rowCard, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: c.text }]}>{member.displayName}</Text>
                </View>
                <Pressable onPress={() => openChat(member.id, member.displayName)} style={[styles.chatBtn, { backgroundColor: c.primary }]}>
                  <Text style={styles.chatBtnText}>Chat</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Discover Egregor Members</Text>
          {!discover.length ? (
            <View style={styles.emptyStateRow}>
              <ActivityIndicator />
            </View>
          ) : (
            discover.map((person) => {
              const isMember = memberIds.has(person.id);
              const isPending = pendingOutgoingTargets.has(person.id);
              return (
                <View key={person.id} style={[styles.rowCard, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: c.text }]}>{person.displayName}</Text>
                  </View>
                  {isMember ? (
                    <Pressable onPress={() => openChat(person.id, person.displayName)} style={[styles.chatBtn, { backgroundColor: c.primary }]}>
                      <Text style={styles.chatBtnText}>Chat</Text>
                    </Pressable>
                  ) : isPending ? (
                    <View style={[styles.pendingPill, { borderColor: c.border }]}>
                      <Text style={[styles.pendingText, { color: c.textMuted }]}>Pending</Text>
                    </View>
                  ) : (
                    <Pressable
                      disabled={busyId === person.id}
                      onPress={() => void sendRequest(person)}
                      style={[styles.requestBtn, { borderColor: c.border, backgroundColor: c.card }]}
                    >
                      <Text style={[styles.requestBtnText, { color: c.text }]}>
                        {busyId === person.id ? "Sending..." : "Request chat"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </View>

        {outgoing.length ? (
          <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Outgoing Requests</Text>
            {outgoing.map((request) => (
              <View key={request.id} style={[styles.rowCard, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: c.text }]}>{request.peerName}</Text>
                  <Text style={[styles.rowMeta, { color: c.textMuted }]}>
                    Sent {new Date(request.created_at).toLocaleString()}
                  </Text>
                </View>
                <Pressable
                  disabled={busyId === request.id}
                  onPress={() => void cancelRequest(request)}
                  style={[styles.declineBtn, { borderColor: c.border, backgroundColor: c.card }]}
                >
                  <Text style={[styles.declineBtnText, { color: c.text }]}>
                    {busyId === request.id ? "..." : "Cancel"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
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
  title: { fontSize: 24, lineHeight: 30, fontWeight: "900" },
  subtitle: { fontSize: 13, lineHeight: 18 },
  metricsRow: { flexDirection: "row", gap: 8 },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  metricValue: { fontSize: 22, fontWeight: "900" },
  metricLabel: { marginTop: 4, fontSize: 12, fontWeight: "700" },
  section: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900" },
  emptyText: { fontSize: 13 },
  emptyStateRow: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  rowCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowTitle: { fontSize: 14, fontWeight: "800" },
  rowMeta: { marginTop: 2, fontSize: 11 },
  acceptBtn: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  acceptBtnText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  declineBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  declineBtnText: { fontWeight: "800", fontSize: 12 },
  chatBtn: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chatBtnText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  requestBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  requestBtnText: { fontWeight: "800", fontSize: 12 },
  pendingPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  pendingText: { fontSize: 11, fontWeight: "800" },
});

