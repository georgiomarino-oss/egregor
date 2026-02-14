import React, { useContext } from "react";
import { View, Text, TextInput, Button, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppStateContext } from "../state";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Auth">;

export default function AuthScreen({ navigation }: Props) {
  const s = useContext(AppStateContext);
  if (!s) return null;

  const isError = s.authStatus.startsWith("❌");

  return (
    <View style={styles.container}>
      <Text style={styles.title}>1) Sign up / Get token</Text>

      <TextInput
        style={styles.input}
        value={s.email}
        onChangeText={s.setEmail}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        value={s.displayName}
        onChangeText={s.setDisplayName}
        placeholder="Display name"
      />

      <View style={styles.row}>
        <Button title="Sign up" onPress={s.handleSignup} />
        <View style={styles.spacer} />
        <Button title="Log out" onPress={s.handleLogout} disabled={!s.token} />
      </View>

      {!!s.authStatus && (
        <Text style={[styles.status, isError ? styles.error : styles.ok]}>
          {s.authStatus}
        </Text>
      )}

      <Text style={styles.tokenLabel}>Token:</Text>
      <Text selectable style={styles.tokenValue}>
        {s.token || "(none yet)"}
      </Text>

      <View style={styles.bottomGap} />
      <Button title="Go to Events" onPress={() => navigation.navigate("Events")} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  row: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  spacer: { width: 10 },
  status: { marginTop: 6 },
  ok: { color: "green" },
  error: { color: "crimson" },
  tokenLabel: { marginTop: 8, fontWeight: "600" },
  tokenValue: { fontSize: 12 },
  bottomGap: { height: 16 }
});
