import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useAppState } from "../state";
import { getScreenColors } from "../theme/appearance";
import {
  filterSoloPresets,
  SOLO_PRESET_CATALOG,
  SOLO_PRESET_CATEGORIES,
  type SoloPresetFilterCategory,
  type SoloPreset,
} from "../features/solo/soloCatalog";

export default function SoloScreen() {
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getScreenColors(theme, highContrast, "solo"), [theme, highContrast]);
  const navigation = useNavigation<any>();
  const [category, setCategory] = useState<SoloPresetFilterCategory>("All");
  const [selectedId, setSelectedId] = useState(SOLO_PRESET_CATALOG[0]?.id ?? "");
  const [showFullCatalog, setShowFullCatalog] = useState(false);

  const visible = useMemo(() => filterSoloPresets(category), [category]);
  const visibleCatalog = useMemo(
    () => (showFullCatalog ? visible : visible.slice(0, 8)),
    [showFullCatalog, visible]
  );

  const selected = useMemo(
    () => visible.find((preset) => preset.id === selectedId) ?? visible[0] ?? SOLO_PRESET_CATALOG[0],
    [selectedId, visible]
  );

  const openPresetSession = (preset: SoloPreset) => {
    const navToUse = navigation.getParent?.() ?? navigation;
    (navToUse as any).navigate("SoloSession", {
      title: preset.title,
      intention: preset.intention,
      lines: preset.lines,
      category: preset.category,
      minutes: preset.minutes,
    });
  };

  const startGuided = () => {
    if (!selected) return;
    openPresetSession(selected);
  };

  const inviteFriends = () => {
    const navToUse = navigation.getParent?.() ?? navigation;
    const seed = selected ?? SOLO_PRESET_CATALOG[0];
    (navToUse as any).navigate("RootTabs", {
      screen: "Events",
      params: {
        openCreate: true,
        prefillTitle: `Group ${seed.title}`,
        prefillIntention: seed.intention,
        prefillDescription: `Join me for a ${seed.minutes}-minute ${seed.title.toLowerCase()} session in Egregor.`,
        prefillMinutes: seed.minutes,
      },
    });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.kicker, { color: c.textMuted }]}>SOLO PRAYER</Text>
          <Text style={[styles.phaseMeta, { color: c.textMuted }]}>
            {c.dayPeriod === "day" ? "Day Flow - Solo" : "Evening Flow - Solo"}
          </Text>
          <Text style={[styles.h1, { color: c.text }]}>Your intention creates ripple effects.</Text>
          <Text style={[styles.sub, { color: c.textMuted }]}>
            Choose a guided preset, then enter a focused solo session with calm pacing and spiritually grounded guidance.
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {SOLO_PRESET_CATEGORIES.map((item) => {
            const on = category === item;
            return (
              <Pressable
                key={item}
                onPress={() => setCategory(item)}
                style={[
                  styles.chip,
                  { borderColor: c.border, backgroundColor: on ? c.cardAlt : c.card },
                  on && { borderColor: c.primary },
                ]}
              >
                <Text style={[styles.chipText, { color: on ? c.text : c.textMuted }]}>{item}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.cardGrid}>
          {visibleCatalog.map((preset) => {
            const on = preset.id === (selected?.id ?? "");
            return (
              <Pressable
                key={preset.id}
                onPress={() => {
                  setSelectedId(preset.id);
                  openPresetSession(preset);
                }}
                style={[
                  styles.presetCard,
                  { backgroundColor: c.card, borderColor: c.border },
                  on && { borderColor: c.primary, backgroundColor: c.cardAlt },
                ]}
              >
                <Text style={[styles.presetTitle, { color: c.text }]}>{preset.title}</Text>
                <Text style={[styles.presetMeta, { color: c.textMuted }]}>{preset.subtitle}</Text>
                <Text style={[styles.presetTag, { color: c.primary }]}>
                  {preset.minutes} min - {preset.category}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {visible.length > 8 ? (
          <Pressable
            style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
            onPress={() => setShowFullCatalog((v) => !v)}
          >
            <Text style={[styles.secondaryBtnText, { color: c.text }]}>
              {showFullCatalog ? "Show fewer prayers" : `Show all ${visible.length} prayers`}
            </Text>
          </Pressable>
        ) : null}

        {selected ? (
          <View style={[styles.previewCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
            <Text style={[styles.previewTitle, { color: c.text }]}>{selected.title}</Text>
            <Text style={[styles.previewMeta, { color: c.textMuted }]}>
              {selected.minutes} min - {selected.category}
            </Text>
            <Text style={[styles.previewLine, { color: c.text }]}>
              {selected.subtitle}
            </Text>
            <Pressable style={[styles.primaryBtn, { backgroundColor: c.primary }]} onPress={startGuided}>
              <Text style={styles.primaryBtnText}>Start selected prayer</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.dualRow}>
          <Pressable
            style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.card }]}
            onPress={inviteFriends}
          >
            <Text style={[styles.secondaryBtnText, { color: c.text }]}>Invite friends & family</Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.card }]}
            onPress={() => navigation.navigate("Global")}
          >
            <Text style={[styles.secondaryBtnText, { color: c.text }]}>View global pulse</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 36, gap: 12 },
  heroCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  phaseMeta: { marginTop: 4, fontSize: 11, fontWeight: "700" },
  h1: { marginTop: 6, fontSize: 26, lineHeight: 31, fontWeight: "900" },
  sub: { marginTop: 8, fontSize: 13, lineHeight: 19 },
  chipsRow: { gap: 8, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipText: { fontSize: 12, fontWeight: "800" },
  cardGrid: { gap: 8 },
  presetCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  presetTitle: { fontSize: 16, fontWeight: "800" },
  presetMeta: { fontSize: 12, lineHeight: 17 },
  presetTag: { marginTop: 4, fontSize: 12, fontWeight: "800" },
  previewCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  previewTitle: { fontSize: 16, fontWeight: "900" },
  previewMeta: { fontSize: 12 },
  previewLine: { fontSize: 13, lineHeight: 20 },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  primaryBtnText: { color: "white", fontWeight: "900", fontSize: 14 },
  dualRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  secondaryBtn: {
    flex: 1,
    minWidth: 150,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontWeight: "800", fontSize: 12 },
});
