import React, { useContext } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  ScrollView
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppStateContext } from "../state";
import type { RootStackParamList, ScriptListItem } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Scripts">;

const TONES: Array<"calm" | "uplifting" | "focused"> = [
  "calm",
  "uplifting",
  "focused"
];

export default function ScriptsScreen({ navigation }: Props) {
  const s = useContext(AppStateContext);
  if (!s) return null;

  const selectedScript =
    s.scripts.find((sc) => sc.id === s.selectedScriptId) ?? null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* 4) AI Script Generator */}
      <View style={styles.section}>
        <Text style={styles.title}>4) AI Script Generator</Text>

        <TextInput
          style={[styles.input, styles.multi]}
          value={s.scriptIntention}
          onChangeText={s.setScriptIntention}
          placeholder="Intention"
          multiline
        />

        <TextInput
          style={styles.input}
          value={s.scriptDuration}
          onChangeText={s.setScriptDuration}
          placeholder="Duration minutes (3-60)"
          keyboardType="numeric"
        />

        <Text style={styles.label}>Tone</Text>
        <View style={styles.toneRow}>
          {TONES.map((tone) => {
            const active = s.scriptTone === tone;
            return (
              <View key={tone} style={styles.toneBtnWrap}>
                <Button
                  title={tone}
                  onPress={() => s.setScriptTone(tone)}
                  disabled={active}
                />
              </View>
            );
          })}
        </View>

        <Button
          title={s.scriptLoading ? "Generating..." : "Generate AI script"}
          onPress={s.handleGenerateScript}
          disabled={s.scriptLoading || !s.token}
        />

        {!!s.scriptError && <Text style={styles.error}>{s.scriptError}</Text>}

        {!!s.generatedScript && (
          <View style={styles.generatedBox}>
            <Text style={styles.generatedTitle}>{s.generatedScript.title}</Text>
            <Text>
              {s.generatedScript.durationMinutes} min | {s.generatedScript.tone}
            </Text>
            <Text style={{ marginTop: 6 }}>
              Sections: {s.generatedScript.sections?.length || 0}
            </Text>
            {!!s.generatedScriptId && <Text>Saved ID: {s.generatedScriptId}</Text>}
          </View>
        )}
      </View>

      {/* 5) Attach Script to Event */}
      <View style={styles.section}>
        <Text style={styles.title}>5) Attach Script to Event</Text>

        <Button title="Refresh scripts" onPress={s.loadScripts} disabled={!s.token} />
        {!!s.scriptsError && <Text style={styles.error}>{s.scriptsError}</Text>}

        <Text style={styles.label}>Choose script:</Text>

        {s.scripts.length === 0 ? (
          <Text style={styles.empty}>No scripts yet.</Text>
        ) : (
          <View style={{ marginTop: 4 }}>
            {s.scripts.map((sc: ScriptListItem) => {
              const isSelected = sc.id === s.selectedScriptId;
              return (
                <View
                  key={sc.id}
                  style={[
                    styles.scriptCard,
                    isSelected ? styles.scriptCardSelected : null
                  ]}
                >
                  <Text style={styles.scriptTitle}>{sc.title}</Text>
                  <Text>Intention: {sc.intention}</Text>
                  <Text>
                    {sc.durationMinutes} min | {sc.tone}
                  </Text>
                  <Text>{new Date(sc.createdAt).toLocaleString()}</Text>
                  <Text selectable>ID: {sc.id}</Text>

                  <View style={{ height: 8 }} />
                  <Button
                    title={isSelected ? "Selected" : "Select this script"}
                    onPress={() => s.setSelectedScriptId(sc.id)}
                    disabled={isSelected}
                  />
                </View>
              );
            })}
          </View>
        )}

        {selectedScript ? (
          <Text style={styles.selectedText}>Selected script: {selectedScript.title}</Text>
        ) : (
          <Text style={styles.selectedText}>No script selected.</Text>
        )}

        <Button
          title="Attach selected script to selected event"
          onPress={s.handleAttachScript}
          disabled={!s.token || !s.selectedEventId || !s.selectedScriptId}
        />

        {!!s.attachStatus && (
          <Text style={s.attachStatus.startsWith("❌") ? styles.error : styles.ok}>
            {s.attachStatus}
          </Text>
        )}

        <View style={{ height: 8 }} />
        <Button title="Back to Events" onPress={() => navigation.navigate("Events")} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 30 },
  section: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14
  },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  label: { marginTop: 8, marginBottom: 4, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8
  },
  multi: { minHeight: 72, textAlignVertical: "top" },
  toneRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10
  },
  toneBtnWrap: {
    flex: 1
  },
  generatedBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    padding: 10
  },
  generatedTitle: { fontWeight: "700", fontSize: 16 },
  scriptCard: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10
  },
  scriptCardSelected: {
    borderColor: "#4a90e2",
    borderWidth: 2
  },
  scriptTitle: { fontSize: 17, fontWeight: "700" },
  selectedText: { marginTop: 8, marginBottom: 8, fontWeight: "600" },
  empty: { marginTop: 8, color: "#666" },
  ok: { color: "green", marginTop: 8 },
  error: { color: "crimson", marginTop: 8 }
});
