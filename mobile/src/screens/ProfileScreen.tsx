// mobile/src/screens/ProfileScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase/client";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";

const KEY_AUTO_JOIN_GLOBAL = "prefs:autoJoinLive";

export default function ProfileScreen() {
  const { theme, setTheme } = useAppState();
  const c = useMemo(() => getAppColors(theme), [theme]);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

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

  const handleSaveProfile = useCallback(async () => {
    if (!userId) {
      Alert.alert("Not signed in", "Sign in again and retry.");
      return;
    }

    const nextDisplayName = displayName.trim();
    if (nextDisplayName.length > 80) {
      Alert.alert("Validation", "Display name must be 80 characters or fewer.");
      return;
    }

    const nextAvatarUrl = avatarUrl.trim();
    if (nextAvatarUrl) {
      let validUrl = false;
      try {
        const parsed = new URL(nextAvatarUrl);
        validUrl = parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        validUrl = false;
      }
      if (!validUrl) {
        Alert.alert("Validation", "Avatar URL must be a valid http(s) URL.");
        return;
      }
    }

    setSavingProfile(true);
    try {
      const payload = {
        id: userId,
        display_name: nextDisplayName || null,
        avatar_url: nextAvatarUrl || null,
      };

      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
      if (error) {
        Alert.alert("Save failed", error.message);
        return;
      }

      Alert.alert("Saved", "Profile updated.");
      await load();
    } finally {
      setSavingProfile(false);
    }
  }, [avatarUrl, displayName, load, userId]);

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
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <View style={styles.wrap}>
        <Text style={[styles.h1, { color: c.text }]}>Profile</Text>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatar}
              onError={() => {
                setAvatarUrl("");
              }}
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: c.cardAlt, borderColor: c.primary }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: c.text }]}>{displayName?.trim() ? displayName.trim() : "Unnamed user"}</Text>

            {!!email && <Text style={[styles.meta, { color: c.textMuted }]}>{email}</Text>}

            {!!userId && (
              <Text style={[styles.meta, { color: c.textMuted }]}>
                User ID: <Text style={{ color: c.text }}>{userId.slice(0, 8)}...{userId.slice(-6)}</Text>
              </Text>
            )}

            {!!avatarUrl && <Text style={[styles.meta, { color: c.textMuted }]}>Avatar: set</Text>}
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Appearance</Text>

          <View style={styles.themeRow}>
            <Pressable
              style={[
                styles.themeBtn,
                { borderColor: c.border, backgroundColor: c.cardAlt },
                theme === "light" && [styles.themeBtnActive, { backgroundColor: c.primary, borderColor: c.primary }],
              ]}
              onPress={() => setTheme("light")}
            >
              <Text style={[styles.themeBtnText, { color: c.textMuted }, theme === "light" && styles.themeBtnTextActive]}>Light</Text>
            </Pressable>
            <Pressable
              style={[
                styles.themeBtn,
                { borderColor: c.border, backgroundColor: c.cardAlt },
                theme === "dark" && [styles.themeBtnActive, { backgroundColor: c.primary, borderColor: c.primary }],
              ]}
              onPress={() => setTheme("dark")}
            >
              <Text style={[styles.themeBtnText, { color: c.textMuted }, theme === "dark" && styles.themeBtnTextActive]}>Dark</Text>
            </Pressable>
            <Pressable
              style={[
                styles.themeBtn,
                { borderColor: c.border, backgroundColor: c.cardAlt },
                theme === "cosmic" && [styles.themeBtnActive, { backgroundColor: c.primary, borderColor: c.primary }],
              ]}
              onPress={() => setTheme("cosmic")}
            >
              <Text style={[styles.themeBtnText, { color: c.textMuted }, theme === "cosmic" && styles.themeBtnTextActive]}>Cosmic</Text>
            </Pressable>
          </View>

          <Text style={[styles.tip, { color: c.textMuted }]}>Theme applies to navigation chrome and core surfaces.</Text>
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Account</Text>

          <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Display name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your display name"
            placeholderTextColor={c.textMuted}
            editable={!loading && !savingProfile}
          />

          <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Avatar URL</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={avatarUrl}
            onChangeText={setAvatarUrl}
            placeholder="https://..."
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading && !savingProfile}
          />

          <Pressable
            style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, (loading || savingProfile) && styles.disabled]}
            onPress={handleSaveProfile}
            disabled={loading || savingProfile}
          >
            <Text style={styles.btnText}>{savingProfile ? "Saving..." : "Save profile"}</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={load} disabled={loading}>
            <Text style={[styles.btnGhostText, { color: c.text }]}>{loading ? "Refreshing..." : "Refresh profile"}</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={clearAutoJoinPrefs}>
            <Text style={[styles.btnGhostText, { color: c.text }]}>Reset auto-join remembers</Text>
          </Pressable>

          <Pressable
            style={[styles.btn, styles.btnDanger, (signingOut || loading) && styles.disabled]}
            onPress={handleSignOut}
            disabled={signingOut || loading}
          >
            <Text style={styles.btnText}>{signingOut ? "Signing out..." : "Sign out"}</Text>
          </Pressable>

          <Text style={[styles.tip, { color: c.textMuted }]}>
            Tip: if you ever get stuck signed in, use Sign out here and relaunch the app.
          </Text>

          {loading ? <ActivityIndicator /> : null}
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
  themeRow: { flexDirection: "row", gap: 8 },
  themeBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3E4C78",
    backgroundColor: "#0E1428",
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  themeBtnActive: {
    backgroundColor: "#5B8CFF",
    borderColor: "#6EA1FF",
  },
  themeBtnText: { color: "#C8D3FF", fontWeight: "800" },
  themeBtnTextActive: { color: "white" },
  fieldLabel: { color: "#B9C3E6", fontSize: 12, marginBottom: 4, marginTop: 2 },

  input: {
    backgroundColor: "#0E1428",
    borderColor: "#2A365E",
    borderWidth: 1,
    color: "white",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

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
  btnPrimary: { backgroundColor: "#5B8CFF" },
  btnDanger: { backgroundColor: "#FB7185" },

  btnText: { color: "white", fontWeight: "800" },
  btnGhostText: { color: "#C8D3FF", fontWeight: "800" },

  disabled: { opacity: 0.45 },

  tip: { color: "#93A3D9", fontSize: 12, marginTop: 2, lineHeight: 16 },
});
