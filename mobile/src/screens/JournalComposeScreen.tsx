import React, { useMemo, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppState } from "../state";
import { getScreenColors } from "../theme/appearance";
import { supabase } from "../supabase/client";
import type { RootStackParamList } from "../types";

type JournalVisibility = "private" | "shared_anonymous";
type JournalEntry = {
  id: string;
  createdAt: string;
  text: string;
  visibility: JournalVisibility;
};

const KEY_JOURNAL = "journal:entries";
const MAX_CHARS = 600;

export default function JournalComposeScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "JournalCompose">>();
  const navigation = useNavigation<any>();
  const { theme, highContrast, user } = useAppState();
  const c = useMemo(() => getScreenColors(theme, highContrast, "profile"), [highContrast, theme]);

  const suggestedEvent = useMemo(() => {
    const raw = route.params?.suggestedEvent;
    const title = String(raw?.title ?? "").trim() || "Group Prayer Circle";
    const intention = String(raw?.intention ?? "").trim() || "peace and healing";
    const description =
      String(raw?.description ?? "").trim() ||
      "Join me for a guided group prayer inside Egregor.";
    const minutesRaw = Number(raw?.minutes ?? 5);
    const minutes = Number.isFinite(minutesRaw)
      ? Math.max(3, Math.min(120, Math.round(minutesRaw)))
      : 5;

    return { title, intention, description, minutes };
  }, [route.params?.suggestedEvent]);

  const [text, setText] = useState(String(route.params?.prefill ?? "").slice(0, MAX_CHARS));
  const [shareAnonymously, setShareAnonymously] = useState(false);
  const [saving, setSaving] = useState(false);
  const remaining = MAX_CHARS - text.trim().length;

  const openSuggestedGroupEvent = () => {
    navigation.navigate("RootTabs", {
      screen: "Events",
      params: {
        openCreate: true,
        prefillTitle: suggestedEvent.title,
        prefillIntention: suggestedEvent.intention,
        prefillDescription: suggestedEvent.description,
        prefillMinutes: suggestedEvent.minutes,
      },
    });
  };

  const saveLocalEntry = async (entry: JournalEntry) => {
    const raw = await AsyncStorage.getItem(KEY_JOURNAL);
    let existing: JournalEntry[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          existing = parsed
            .map((item) => {
              const entryText = String((item as any)?.text ?? "").trim();
              if (!entryText) return null;
              return {
                id: String((item as any)?.id ?? `${Date.now()}-${Math.random()}`),
                createdAt: String((item as any)?.createdAt ?? new Date().toISOString()),
                text: entryText,
                visibility:
                  String((item as any)?.visibility ?? "").trim().toLowerCase() === "shared_anonymous"
                    ? "shared_anonymous"
                    : "private",
              } satisfies JournalEntry;
            })
            .filter((item): item is JournalEntry => !!item);
        }
      } catch {
        existing = [];
      }
    }

    const next = [entry, ...existing].slice(0, 200);
    await AsyncStorage.setItem(KEY_JOURNAL, JSON.stringify(next));
  };

  const handleSave = async () => {
    if (saving) return;
    const trimmed = text.trim();
    if (!trimmed) {
      Alert.alert("Add a reflection", "Write at least one line before saving.");
      return;
    }
    if (trimmed.length > MAX_CHARS) {
      Alert.alert("Validation", `Journal entry must be ${MAX_CHARS} characters or fewer.`);
      return;
    }

    setSaving(true);
    const visibility: JournalVisibility = shareAnonymously ? "shared_anonymous" : "private";
    try {
      if (user?.id) {
        const { error } = await supabase.from("manifestation_journal_entries").insert({
          user_id: user.id,
          body: trimmed,
          visibility,
        });
        if (error) {
          throw new Error(error.message || "Could not save entry.");
        }
      } else {
        await saveLocalEntry({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          text: trimmed,
          visibility,
        });
      }

      Alert.alert(
        "Saved",
        "Your journal entry has been saved. Want to carry this intention into a group event?",
        [
          {
            text: "Done",
            style: "cancel",
            onPress: () => navigation.goBack(),
          },
          {
            text: "Open profile",
            onPress: () => {
              navigation.navigate("RootTabs", { screen: "Profile" });
            },
          },
          {
            text: "Create group event",
            onPress: openSuggestedGroupEvent,
          },
        ]
      );
    } catch {
      Alert.alert("Save failed", "Could not save your journal entry right now. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.card, { borderColor: c.border, backgroundColor: c.card }]}>
              <Text style={[styles.title, { color: c.text }]}>Journal this moment</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                Capture what you felt so you can return to it later.
              </Text>

              <TextInput
                value={text}
                onChangeText={(next) => setText(next.slice(0, MAX_CHARS))}
                placeholder="What came up during your prayer?"
                placeholderTextColor={c.textMuted}
                multiline
                autoFocus
                style={[
                  styles.input,
                  { borderColor: c.border, backgroundColor: c.cardAlt, color: c.text },
                ]}
              />

              <View style={styles.row}>
                <Text style={[styles.meta, { color: c.textMuted }]}>Share anonymously to inspire others</Text>
                <Switch value={shareAnonymously} onValueChange={setShareAnonymously} />
              </View>

              <View style={styles.row}>
                <Text style={[styles.meta, { color: c.textMuted }]}>
                  {Math.max(0, remaining)} characters remaining
                </Text>
                <Pressable
                  style={[styles.hideKeyboardBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                  onPress={Keyboard.dismiss}
                >
                  <Text style={[styles.hideKeyboardBtnText, { color: c.text }]}>Hide keyboard</Text>
                </Pressable>
              </View>

              <View style={[styles.suggestionCard, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
                <Text style={[styles.suggestionTitle, { color: c.text }]}>Suggested next step</Text>
                <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={2}>
                  {suggestedEvent.title} - {suggestedEvent.minutes} min
                </Text>
                <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={2}>
                  Intention: {suggestedEvent.intention}
                </Text>
                <Pressable
                  style={[styles.suggestBtn, { borderColor: c.border, backgroundColor: c.card }]}
                  onPress={openSuggestedGroupEvent}
                >
                  <Text style={[styles.suggestBtnText, { color: c.text }]}>Create this group event</Text>
                </Pressable>
              </View>

              <Pressable
                style={[
                  styles.saveBtn,
                  { backgroundColor: c.primary },
                  saving && { opacity: 0.7 },
                ]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save journal entry"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 28,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
  },
  meta: {
    fontSize: 12,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 220,
    textAlignVertical: "top",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 22,
  },
  row: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  hideKeyboardBtn: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  hideKeyboardBtnText: {
    fontSize: 11,
    fontWeight: "800",
  },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  saveBtnText: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
  suggestionCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  suggestionTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  suggestBtn: {
    marginTop: 2,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestBtnText: {
    fontSize: 12,
    fontWeight: "800",
  },
});
