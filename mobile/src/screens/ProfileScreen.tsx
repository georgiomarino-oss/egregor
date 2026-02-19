// mobile/src/screens/ProfileScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../supabase/client";

type ProfileRow = {
  id: string;
  display_name: string | null;
  updated_at?: string | null;
};

type Props = {
  navigation: any;
};

export default function ProfileScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [email, setEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [initialDisplayName, setInitialDisplayName] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");

  const dirty = useMemo(
    () => displayName.trim() !== initialDisplayName.trim(),
    [displayName, initialDisplayName]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const user = auth.user;
      if (!user) {
        // If user is gone, just bounce to Auth via parent stack.
        navigation.getParent?.()?.reset?.({ index: 0, routes: [{ name: "Auth" }] });
        return;
      }

      setEmail(user.email ?? "");
      setUserId(user.id);

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, display_name, updated_at")
        .eq("id", user.id)
        .maybeSingle<ProfileRow>();

      if (error) throw error;

      const current = (profile?.display_name ?? "").trim();
      setInitialDisplayName(current);
      setDisplayName(current);
    } catch (e: any) {
      console.warn("Profile load error", e);
      Alert.alert("Couldn’t load profile", e?.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    const unsub = navigation.addListener?.("focus", () => load());
    load();
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [load, navigation]);

  const onSave = useCallback(async () => {
    const next = displayName.trim();
    if (!userId) return;

    if (next.length < 2) {
      Alert.alert("Display name too short", "Please enter at least 2 characters.");
      return;
    }
    if (next.length > 32) {
      Alert.alert("Display name too long", "Please keep it under 32 characters.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert(
          { id: userId, display_name: next, updated_at: new Date().toISOString() },
          { onConflict: "id" }
        );

      if (error) throw error;

      setInitialDisplayName(next);
      setDisplayName(next);
      Alert.alert("Saved", "Your display name was updated.");
    } catch (e: any) {
      console.warn("Profile save error", e);
      Alert.alert("Couldn’t save", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [displayName, userId]);

  const onSignOut = useCallback(async () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;

            // Reset the parent stack (RootNav) back to Auth.
            navigation.getParent?.()?.reset?.({ index: 0, routes: [{ name: "Auth" }] });
          } catch (e: any) {
            console.warn("Sign out error", e);
            Alert.alert("Couldn’t sign out", e?.message ?? "Please try again.");
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }, [navigation]);

  const onDone = useCallback(() => {
    // Since Profile is a hidden tab route, go back to Scripts explicitly.
    navigation.navigate("Scripts");
  }, [navigation]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Profile</Text>
            <Pressable onPress={onDone} style={styles.headerBtn}>
              <Text style={styles.headerBtnText}>Done</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{email || "—"}</Text>

            <View style={styles.divider} />

            <Text style={styles.label}>Display name</Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor="#6B7BB2"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              maxLength={32}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (!saving && dirty) onSave();
              }}
            />

            <Pressable
              disabled={!dirty || saving}
              onPress={onSave}
              style={[styles.btn, styles.btnPrimary, (!dirty || saving) && styles.disabled]}
            >
              <Text style={styles.btnText}>{saving ? "Saving…" : "Save"}</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Pressable
              disabled={signingOut}
              onPress={onSignOut}
              style={[styles.btn, styles.btnDanger, signingOut && styles.disabled]}
            >
              <Text style={styles.btnText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Your presence display name will update after you re-join an event room (or on the next
            presence refresh depending on your subscription).
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  flex: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 12 },

  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8 },
  muted: { color: "#93A3D9" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { color: "white", fontSize: 28, fontWeight: "900" },
  headerBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3E4C78",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  headerBtnText: { color: "#C8D3FF", fontWeight: "900" },

  card: {
    backgroundColor: "#121A31",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27345C",
    padding: 12,
    gap: 10,
  },

  label: { color: "#B9C3E6", fontSize: 12, marginTop: 2 },
  value: { color: "white", fontSize: 16, fontWeight: "700" },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#27345C", marginVertical: 6 },

  input: {
    backgroundColor: "#0E1428",
    borderColor: "#2A365E",
    borderWidth: 1,
    color: "white",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },

  btn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: "#5B8CFF" },
  btnDanger: { backgroundColor: "#FB7185" },
  btnText: { color: "white", fontWeight: "900" },
  disabled: { opacity: 0.45 },

  hint: { color: "#93A3D9", fontSize: 12, lineHeight: 16, marginTop: 2 },
});
