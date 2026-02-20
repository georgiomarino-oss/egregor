import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";

type Props = {
  onComplete: (intention: string) => void;
};

export default function OnboardingScreen({ onComplete }: Props) {
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const pulse = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    const scaleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowScale, {
          toValue: 1.08,
          duration: 2400,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(glowScale, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();
    scaleLoop.start();
    return () => {
      pulseLoop.stop();
      scaleLoop.stop();
    };
  }, [glowScale, pulse]);

  const orbOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.9],
  });
  const [intention, setIntention] = React.useState("peace and clarity");

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top", "bottom"]}>
      <View style={styles.wrap}>
        <Animated.View
          style={[
            styles.glow,
            {
              backgroundColor: c.glowA,
              opacity: orbOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.glowSecondary,
            {
              backgroundColor: c.glowB,
              opacity: orbOpacity,
              transform: [{ scale: glowScale }],
            },
          ]}
        />

        <Text style={[styles.kicker, { color: c.textMuted }]}>WELCOME TO EGREGOR</Text>
        <Text style={[styles.title, { color: c.text }]}>What is your intention today?</Text>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          Join live circles, focus your breath, and align your energy with people around the world.
        </Text>

        <TextInput
          value={intention}
          onChangeText={setIntention}
          placeholder="Type your intention..."
          placeholderTextColor={c.textMuted}
          style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
        />
        <View style={styles.chipsRow}>
          {["Healing", "Abundance", "Peace", "Love"].map((chip) => (
            <Pressable
              key={chip}
              onPress={() => setIntention(chip)}
              style={[styles.chip, { borderColor: c.border, backgroundColor: c.cardAlt }]}
            >
              <Text style={[styles.chipText, { color: c.text }]}>{chip}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.cardTitle, { color: c.text }]}>How it works</Text>
          <Text style={[styles.cardBody, { color: c.textMuted }]}>
            1. Enter a live room and join presence.
          </Text>
          <Text style={[styles.cardBody, { color: c.textMuted }]}>
            2. Follow the synchronized script in real time.
          </Text>
          <Text style={[styles.cardBody, { color: c.textMuted }]}>
            3. Share intentions and send energy to the circle.
          </Text>
        </View>

        <Pressable
          style={[styles.cta, { backgroundColor: c.primary }]}
          onPress={() => onComplete(intention.trim() || "peace and clarity")}
        >
          <Text style={styles.ctaText}>Enter the temple</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  wrap: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    gap: 14,
  },
  glow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 999,
    top: 120,
    right: -80,
  },
  glowSecondary: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 999,
    bottom: 120,
    left: -80,
  },
  kicker: { fontSize: 11, fontWeight: "900", letterSpacing: 1.7 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: "900" },
  subtitle: { fontSize: 14, lineHeight: 21, maxWidth: 420 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 6,
    marginTop: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", marginBottom: 2 },
  cardBody: { fontSize: 13, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 2,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { fontSize: 11, fontWeight: "800" },
  cta: {
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
});
