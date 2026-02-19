// mobile/src/screens/AuthScreen.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../supabase/client";

export default function AuthScreen() {
  const [loading, setLoading] = useState(false);

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isSignedIn = useMemo(() => !!sessionUserId, [sessionUserId]);

  useEffect(() => {
    let mounted = true;

    // initial session
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        // non-fatal; just show logged out
        setSessionUserId(null);
        return;
      }
      setSessionUserId(data.session?.user?.id ?? null);
    });

    // realtime updates
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSessionUserId(nextSession?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Missing details", "Please enter email and password.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (error) {
      Alert.alert("Sign in failed", error.message);
      return;
    }
    // ✅ NO navigation here — App.tsx should switch screens based on session.
  };

  const signUp = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Missing details", "Please enter email and password.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (error) {
      Alert.alert("Sign up failed", error.message);
      return;
    }

    Alert.alert(
      "Account created",
      "If email confirmations are enabled in Supabase, check your inbox. Otherwise you should be signed in."
    );
    // ✅ NO navigation here either.
  };

  const signOut = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signOut();
    setLoading(false);

    if (error) {
      Alert.alert("Sign out failed", error.message);
      return;
    }
    // ✅ App.tsx should react to session becoming null.
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>
        <Text style={styles.h1}>Account</Text>

        <View style={styles.card}>
          <Text style={styles.meta}>
            Status:{" "}
            <Text style={isSignedIn ? styles.ok : styles.warn}>
              {isSignedIn ? "Signed in" : "Signed out"}
            </Text>
          </Text>

          {isSignedIn ? (
            <>
              <Text style={styles.meta}>User ID: {sessionUserId}</Text>

              <Pressable
                style={[styles.btn, styles.btnDanger, loading && styles.disabled]}
                onPress={signOut}
                disabled={loading}
              >
                <Text style={styles.btnText}>{loading ? "Working..." : "Sign out"}</Text>
              </Pressable>

              <Text style={styles.hint}>
                Tip: If you want a “Sign out” button inside the app screens too (Events/Scripts),
                tell me and I’ll add it there as well.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#6F7AA8"
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="#6F7AA8"
              />

              <View style={styles.row}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, loading && styles.disabled]}
                  onPress={signIn}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>{loading ? "Working..." : "Sign in"}</Text>
                </Pressable>

                <Pressable
                  style={[styles.btn, styles.btnGhost, loading && styles.disabled]}
                  onPress={signUp}
                  disabled={loading}
                >
                  <Text style={styles.btnGhostText}>Sign up</Text>
                </Pressable>
              </View>

              <Text style={styles.hint}>
                If you disabled email confirmation in Supabase, sign-up should immediately create
                a session. Otherwise you may need to confirm via email.
              </Text>
            </>
          )}
        </View>

        <Text style={styles.footer}>
          This screen does not navigate anywhere. App.tsx should decide what to show based on the
          Supabase session.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  container: { flex: 1, padding: 16, gap: 12 },
  h1: { color: "white", fontSize: 28, fontWeight: "800" },

  card: {
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
    gap: 10,
  },

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

  row: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 6 },

  btn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 120,
  },
  btnPrimary: { backgroundColor: "#5B8CFF" },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#3E4C78" },
  btnDanger: { backgroundColor: "#FB7185" },

  btnText: { color: "white", fontWeight: "800" },
  btnGhostText: { color: "#C8D3FF", fontWeight: "800" },
  disabled: { opacity: 0.5 },

  hint: { color: "#93A3D9", fontSize: 12, marginTop: 6, lineHeight: 16 },
  footer: { color: "#93A3D9", fontSize: 12, lineHeight: 16, marginTop: 6 },
});
