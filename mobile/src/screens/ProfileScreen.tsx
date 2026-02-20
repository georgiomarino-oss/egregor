// mobile/src/screens/ProfileScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase/client";

const KEY_AUTO_JOIN_GLOBAL = "prefs:autoJoinLive";

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");

  const [displayName, setDisplayName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        setUserId("");
        setEmail("");
        setDisplayName("");
        setAvatarUrl("");
        return;
      }

      setUserId(user.id);
      setEmail(user.email ?? "");

      // Try to fetch profile row (safe if profiles table exists + RLS select enabled)
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("display_name,avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (!profErr && prof) {
        setDisplayName(String((prof as any).display_name ?? ""));
        setAvatarUrl(String((prof as any).avatar_url ?? ""));
      } else {
        setDisplayName("");
        setAvatarUrl("");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const initials = useMemo(() => {
    const name = (displayName || email || "").trim();
    if (!name) return "?";
    const parts = name.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "?";
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (a + b).toUpperCase();
  }, [displayName, email]);

  const clearAutoJoinPrefs = useCallback(async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const toRemove = keys.filter((k) => k === KEY_AUTO_JOIN_GLOBAL || k.startsWith("joined:event:"));
      if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
      Alert.alert("Cleared", "Auto-join preferences have been reset.");
    } catch (e: any) {
      Alert.alert("Failed", e?.message ?? "Could not clear preferences.");
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            const { error } = await supabase.auth.signOut();
            if (error) {
              Alert.alert("Sign out failed", error.message);
              return;
            }
            // Your app should route back to AuthScreen based on session state
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.wrap}>
        <Text style={styles.h1}>Profile</Text>

        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {displayName?.trim() ? displayName.trim() : "Unnamed user"}
            </Text>

            {!!email && <Text style={styles.meta}>{email}</Text>}

            {!!userId && (
              <Text style={styles.meta}>
                User ID: <Text style={{ color: "#C8D3FF" }}>{userId.slice(0, 8)}…{userId.slice(-6)}</Text>
              </Text>
            )}

            {!!avatarUrl && <Text style={styles.meta}>Avatar: set</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <Pressable style={[styles.btn, styles.btnGhost]} onPress={load} disabled={loading}>
            <Text style={styles.btnGhostText}>{loading ? "Refreshing…" : "Refresh profile"}</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost]} onPress={clearAutoJoinPrefs}>
            <Text style={styles.btnGhostText}>Reset auto-join remembers</Text>
          </Pressable>

          <Pressable
            style={[styles.btn, styles.btnDanger, (signingOut || loading) && styles.disabled]}
            onPress={handleSignOut}
            disabled={signingOut || loading}
          >
            <Text style={styles.btnText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
          </Pressable>

          <Text style={styles.tip}>
            Tip: if you ever get “stuck signed in”, use Sign out here and relaunch the app.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  wrap: { flex: 1, padding: 16 },

  h1: { color: "white", fontSize: 28, fontWeight: "800", marginBottom: 12 },

  card: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
  },

  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1A2C5F",
    borderWidth: 1,
    borderColor: "#6EA1FF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "white", fontWeight: "900", fontSize: 18 },

  name: { color: "white", fontSize: 16, fontWeight: "800", marginBottom: 2 },
  meta: { color: "#93A3D9", fontSize: 12 },

  section: {
    marginTop: 14,
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
    gap: 10,
  },
  sectionTitle: { color: "#DCE4FF", fontSize: 16, fontWeight: "700" },

  btn: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3E4C78",
  },
  btnDanger: { backgroundColor: "#FB7185" },

  btnText: { color: "white", fontWeight: "800" },
  btnGhostText: { color: "#C8D3FF", fontWeight: "800" },

  disabled: { opacity: 0.45 },

  tip: { color: "#93A3D9", fontSize: 12, marginTop: 2, lineHeight: 16 },
});
