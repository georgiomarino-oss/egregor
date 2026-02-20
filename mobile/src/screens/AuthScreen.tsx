import React, { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../supabase/client";
import { useAppState } from "../state";

type Mode = "signin" | "signup";

export default function AuthScreen() {
  const { user, signOut } = useAppState();

  const [mode, setMode] = useState<Mode>("signin");
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const canSubmit = useMemo(() => {
    if (!email.trim()) return false;
    if (password.length < 6) return false;
    if (mode === "signup" && password !== confirmPassword) return false;
    return !loading;
  }, [email, password, confirmPassword, mode, loading]);

  const submit = async () => {
    const e = email.trim().toLowerCase();
    if (!e) return Alert.alert("Missing email", "Please enter your email.");
    if (password.length < 6) {
      return Alert.alert("Password too short", "Password must be at least 6 characters.");
    }
    if (mode === "signup" && password !== confirmPassword) {
      return Alert.alert("Password mismatch", "Password and confirmation must match.");
    }

    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password });
        if (error) {
          Alert.alert("Sign in failed", error.message);
          return;
        }
      } else {
        const { error } = await supabase.auth.signUp({ email: e, password });
        if (error) {
          Alert.alert("Sign up failed", error.message);
          return;
        }

        Alert.alert(
          "Account created",
          "If email confirmation is enabled in Supabase, check your inbox. If not, you should be signed in immediately."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const doSignOut = async () => {
    setLoading(true);
    try {
      await signOut();
    } catch (e: any) {
      Alert.alert("Sign out failed", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <Text style={styles.h1}>Egregor</Text>
        <Text style={styles.sub}>
          Sign in to create events, generate scripts, and join live presence.
        </Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account</Text>

          <Text style={styles.meta}>
            Status: <Text style={user ? styles.ok : styles.warn}>{user ? "Signed in" : "Signed out"}</Text>
          </Text>

          {user ? (
            <>
              <Text style={styles.meta}>Signed in as: {user.email ?? user.id}</Text>

              <Pressable
                style={[styles.btn, styles.btnDanger, loading && styles.disabled]}
                onPress={doSignOut}
                disabled={loading}
              >
                <Text style={styles.btnText}>{loading ? "Working..." : "Sign out"}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.row}>
                <Pressable
                  style={[styles.pill, mode === "signin" ? styles.pillActive : styles.pillInactive]}
                  onPress={() => {
                    setMode("signin");
                    setConfirmPassword("");
                  }}
                  disabled={loading}
                >
                  <Text style={styles.pillText}>Sign in</Text>
                </Pressable>

                <Pressable
                  style={[styles.pill, mode === "signup" ? styles.pillActive : styles.pillInactive]}
                  onPress={() => {
                    setMode("signup");
                    setConfirmPassword("");
                  }}
                  disabled={loading}
                >
                  <Text style={styles.pillText}>Sign up</Text>
                </Pressable>
              </View>

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor="#6F7FB2"
              />

              <Text style={styles.label}>Password (min 6 chars)</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="********"
                placeholderTextColor="#6F7FB2"
              />

              {mode === "signup" ? (
                <>
                  <Text style={styles.label}>Confirm password</Text>
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    placeholder="********"
                    placeholderTextColor="#6F7FB2"
                  />
                </>
              ) : null}

              <Pressable
                style={[styles.btn, styles.btnPrimary, !canSubmit && styles.disabled]}
                onPress={submit}
                disabled={!canSubmit}
              >
                <Text style={styles.btnText}>
                  {loading ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
                </Text>
              </Pressable>

              <Text style={styles.hint}>
                Tip: if you disabled email confirmation in Supabase, Sign up should immediately sign you in.
              </Text>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  container: { flex: 1, padding: 16, gap: 12 },
  h1: { color: "white", fontSize: 28, fontWeight: "800" },
  sub: { color: "#93A3D9", fontSize: 13, lineHeight: 18 },

  card: {
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
    gap: 10,
  },
  sectionTitle: { color: "#DCE4FF", fontSize: 16, fontWeight: "700" },
  meta: { color: "#B9C3E6", fontSize: 13 },
  ok: { color: "#6EE7B7", fontWeight: "800" },
  warn: { color: "#FBBF24", fontWeight: "800" },

  label: { color: "#B9C3E6", fontSize: 12, marginTop: 6 },
  input: {
    backgroundColor: "#0E1428",
    borderColor: "#2A365E",
    borderWidth: 1,
    color: "white",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  pillActive: { backgroundColor: "#233159", borderColor: "#5B8CFF" },
  pillInactive: { backgroundColor: "transparent", borderColor: "#3E4C78" },
  pillText: { color: "white", fontWeight: "700" },

  btn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 140,
    marginTop: 8,
  },
  btnPrimary: { backgroundColor: "#5B8CFF" },
  btnDanger: { backgroundColor: "#FB7185" },
  btnText: { color: "white", fontWeight: "800" },
  disabled: { opacity: 0.5 },

  hint: { color: "#93A3D9", fontSize: 12, marginTop: 6, lineHeight: 16 },
});
