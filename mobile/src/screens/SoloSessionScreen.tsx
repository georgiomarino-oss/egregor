import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Alert,
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { Audio } from "expo-av";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppState } from "../state";
import { getAppColors, getScreenColors } from "../theme/appearance";
import type { RootStackParamList } from "../types";
import { appendSoloHistory } from "../features/solo/soloHistoryRepo";
import { generateSoloVoiceAudio } from "../features/ai/aiScriptRepo";

type HomeLanguage = "English" | "Spanish" | "Portuguese" | "French";
type ProfileVoiceGender = "Female" | "Male";
type SoloDurationMin = 3 | 5 | 10;
type SoloSessionRoute = RouteProp<RootStackParamList, "SoloSession">;

type ExpoAvSound = {
  loadAsync: (source: { uri: string }, initialStatus?: { shouldPlay?: boolean }) => Promise<any>;
  playAsync: () => Promise<void>;
  pauseAsync: () => Promise<void>;
  unloadAsync: () => Promise<void>;
  stopAsync: () => Promise<void>;
  setIsMutedAsync: (isMuted: boolean) => Promise<void>;
  setOnPlaybackStatusUpdate: (cb: (status: any) => void) => void;
};
const KEY_PROFILE_PREFS = "profile:prefs:v1";

function normalizeLanguage(v: string): HomeLanguage {
  const raw = v.trim().toLowerCase();
  if (raw.startsWith("span")) return "Spanish";
  if (raw.startsWith("port")) return "Portuguese";
  if (raw.startsWith("fren")) return "French";
  return "English";
}

function speechLanguageCode(language: HomeLanguage) {
  if (language === "Spanish") return "es-ES";
  if (language === "Portuguese") return "pt-PT";
  if (language === "French") return "fr-FR";
  return "en-US";
}

function normalizeProfileVoiceGender(value: string): ProfileVoiceGender {
  const raw = value.trim().toLowerCase();
  return raw.startsWith("male") ? "Male" : "Female";
}

function wordCount(lines: string[]) {
  return lines
    .join(" ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => !!w).length;
}

function buildFallbackLines(intention: string, language: HomeLanguage) {
  const core = intention.trim() || "peace and healing";
  if (language === "Spanish") {
    return [
      `Inhala despacio y centra tu atencion en ${core}.`,
      "Exhala y suelta la tension de tu cuerpo.",
      `Invita calma y claridad a ${core}.`,
      "Cierra con gratitud por el cambio que ya comienza.",
    ];
  }
  if (language === "Portuguese") {
    return [
      `Inspire devagar e mantenha ${core} no seu foco.`,
      "Expire e solte a tensao do corpo.",
      `Convide calma e clareza para ${core}.`,
      "Feche em gratidao pelo que ja esta mudando.",
    ];
  }
  if (language === "French") {
    return [
      `Inspirez lentement et gardez ${core} dans votre attention.`,
      "Expirez et relachez la tension du corps.",
      `Invitez le calme et la clarte vers ${core}.`,
      "Cloturez avec gratitude pour le changement deja en cours.",
    ];
  }
  return [
    `Breathe slowly and hold ${core} in your awareness.`,
    "Breathe out tension and soften your body.",
    `Invite calm, clarity, and care into ${core}.`,
    "Close in gratitude for what is already shifting.",
  ];
}

function buildDurationPrayerLines(args: {
  lines: string[];
  intention: string;
  language: HomeLanguage;
  minutes: SoloDurationMin;
}) {
  const cleanSeed = args.lines
    .map((line) => String(line ?? "").trim())
    .filter((line) => !!line)
    .slice(0, 60);
  const seed = cleanSeed.length ? cleanSeed : buildFallbackLines(args.intention, args.language);
  const targetWords = Math.round(args.minutes * 78);
  const maxLines = args.minutes === 10 ? 120 : args.minutes === 5 ? 80 : 56;
  const intention = args.intention.trim() || "peace and healing";

  let opening: string[] = [];
  let reflections: string[] = [];
  let refrain = "";
  let closing: string[] = [];

  if (args.language === "Spanish") {
    opening = [
      `Amada Presencia, entro en quietud y entrego esta oracion por ${intention}.`,
      "Respiro profundo, suelto la prisa y abro mi corazon.",
      "Que cada inhalacion traiga paz y cada exhalacion disuelva el miedo.",
    ];
    reflections = [
      "Fortalece mi fe para sostener esta intencion con amor constante.",
      "Ensename a responder con bondad, paciencia y sabiduria.",
      "Que mi mente permanezca clara y mi corazon permanezca humilde.",
      "Que mis acciones diarias esten alineadas con esta oracion.",
    ];
    refrain = "Respiro en paz, exhalo temor, y permanezco en confianza.";
    closing = [
      `Recibo gratitud por la obra que ya comienza en ${intention}.`,
      "Entrego esta intencion al bien mayor, con serenidad y esperanza.",
      "Asi es. Asi sera.",
    ];
  } else if (args.language === "Portuguese") {
    opening = [
      `Presenca amada, entro em silencio e entrego esta oracao por ${intention}.`,
      "Respiro fundo, libero a pressa e abro o coracao.",
      "Que cada inspiracao traga paz e cada expiracao solte o medo.",
    ];
    reflections = [
      "Fortalece minha fe para sustentar esta intencao com amor.",
      "Ensina-me a agir com gentileza, paciencia e sabedoria.",
      "Que minha mente permaneca clara e meu coracao humilde.",
      "Que minhas acoes diarias fiquem alinhadas com esta oracao.",
    ];
    refrain = "Inspiro paz, expiro medo, e permaneco em confianca.";
    closing = [
      `Recebo com gratidao o que ja esta se movendo em ${intention}.`,
      "Entrego esta intencao ao bem maior, com serenidade e esperanca.",
      "Assim e. Assim sera.",
    ];
  } else if (args.language === "French") {
    opening = [
      `Presence bienveillante, j'entre dans le silence et je confie cette priere pour ${intention}.`,
      "Je respire profondement, je relache la hate et j'ouvre mon coeur.",
      "Que chaque inspiration apporte la paix et chaque expiration dissolve la peur.",
    ];
    reflections = [
      "Fortifie ma foi pour porter cette intention avec amour.",
      "Guide mes gestes vers la douceur, la patience et la sagesse.",
      "Que mon esprit reste clair et que mon coeur reste humble.",
      "Que mes actions quotidiennes honorent cette priere.",
    ];
    refrain = "J'inspire la paix, j'expire la peur, et je demeure en confiance.";
    closing = [
      `Je rends grace pour ce qui commence deja a guerir en ${intention}.`,
      "Je remets cette intention au plus grand bien, avec serenite et esperance.",
      "Ainsi soit-il.",
    ];
  } else {
    opening = [
      `Beloved Source, I enter stillness and place this prayer before you for ${intention}.`,
      "I breathe in slowly, releasing urgency and returning to peace.",
      "Let each inhale bring clarity and each exhale release fear.",
    ];
    reflections = [
      "Strengthen me to hold this intention with steady love.",
      "Guide my thoughts, words, and choices toward compassion and wisdom.",
      "Keep my mind clear, my heart humble, and my spirit grounded.",
      "Align my daily actions with this prayer in practical ways.",
    ];
    refrain = "I breathe in peace, I breathe out fear, and I remain in trust.";
    closing = [
      `With gratitude, I receive what is already shifting in ${intention}.`,
      "I release this prayer to the highest good with faith and calm.",
      "Amen.",
    ];
  }

  const built: string[] = [...opening];
  let seedIndex = 0;
  let reflectionIndex = 0;

  while (wordCount(built) < targetWords && built.length < maxLines) {
    built.push(seed[seedIndex % seed.length]);
    seedIndex += 1;
    if (seedIndex % 2 === 0) {
      built.push(reflections[reflectionIndex % reflections.length]);
      reflectionIndex += 1;
    }
    if (seedIndex % 3 === 0) built.push(refrain);
  }

  return [...built, ...closing];
}

function getCategoryPalette(category: string, colors: ReturnType<typeof getAppColors>) {
  const key = category.trim().toLowerCase();
  if (key === "relationships") {
    return { bg: "#081226", pulseA: "#30c6a8", pulseB: "#2f80ed", pulseC: "#f2994a", text: "#eef6ff" };
  }
  if (key === "wellbeing") {
    return { bg: "#071525", pulseA: "#00bfa6", pulseB: "#66d9ff", pulseC: "#3b82f6", text: "#eef6ff" };
  }
  if (key === "abundance") {
    return { bg: "#100f2b", pulseA: "#9b8cff", pulseB: "#30c6a8", pulseC: "#f5b14c", text: "#f6f3ff" };
  }
  if (key === "world") {
    return { bg: "#071528", pulseA: "#26b4ff", pulseB: "#30c6a8", pulseC: "#7da4ff", text: "#eef6ff" };
  }
  return {
    bg: "#081226",
    pulseA: colors.primary,
    pulseB: colors.glowA,
    pulseC: colors.glowB,
    text: "#eef6ff",
  };
}

export default function SoloSessionScreen() {
  const route = useRoute<SoloSessionRoute>();
  const navigation = useNavigation<any>();
  const { theme, highContrast } = useAppState();
  const c = useMemo(() => getScreenColors(theme, highContrast, "solo"), [theme, highContrast]);

  const requestedTitle = String(route.params?.title ?? "").trim() || "Solo Guided Prayer";
  const requestedIntention = String(route.params?.intention ?? "").trim() || "peace and healing";
  const requestedCategory = String(route.params?.category ?? "").trim();
  const requestedMinutes = Number(route.params?.minutes ?? 5);
  const minutes: SoloDurationMin = requestedMinutes === 3 || requestedMinutes === 10 ? requestedMinutes : 5;

  const [preferredLanguage, setPreferredLanguage] = useState<HomeLanguage>("English");
  const [preferredVoiceGender, setPreferredVoiceGender] = useState<ProfileVoiceGender>("Female");
  const [preferredSpeechRate, setPreferredSpeechRate] = useState(0.85);
  const [sessionTotalSeconds, setSessionTotalSeconds] = useState(minutes * 60);
  const [secondsLeft, setSecondsLeft] = useState(minutes * 60);
  const [running, setRunning] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [activeLineIdx, setActiveLineIdx] = useState(0);
  const [progressTrackWidth, setProgressTrackWidth] = useState(0);

  const pulseA = useRef(new Animated.Value(0)).current;
  const pulseB = useRef(new Animated.Value(0)).current;
  const pulseC = useRef(new Animated.Value(0)).current;
  const startCtaPulse = useRef(new Animated.Value(1)).current;
  const completionHandledRef = useRef(false);
  const soundRef = useRef<ExpoAvSound | null>(null);
  const voiceRequestIdRef = useRef(0);
  const scriptScrollRef = useRef<ScrollView | null>(null);
  const lineYRef = useRef<Record<number, number>>({});

  useEffect(() => {
    let cancelled = false;
    const loadPrefs = async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY_PROFILE_PREFS);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw);
        setPreferredLanguage(normalizeLanguage(String(parsed?.language ?? "English")));
        setPreferredVoiceGender(
          normalizeProfileVoiceGender(String(parsed?.voiceGender ?? "Female"))
        );
        setPreferredSpeechRate(parsed?.slowPrayerVoice === false ? 0.96 : 0.84);
      } catch {
        // ignore
      }
    };
    void loadPrefs();
    return () => {
      cancelled = true;
    };
  }, []);

  const lines = useMemo(() => {
    const raw = Array.isArray(route.params?.lines) ? route.params?.lines : [];
    const clean = raw
      .map((line) => String(line ?? "").trim())
      .filter((line) => !!line)
      .slice(0, 64);
    return buildDurationPrayerLines({
      lines: clean,
      intention: requestedIntention,
      language: preferredLanguage,
      minutes,
    });
  }, [minutes, preferredLanguage, requestedIntention, route.params?.lines]);

  const palette = useMemo(() => getCategoryPalette(requestedCategory, c), [c, requestedCategory]);
  const totalSeconds = sessionTotalSeconds;
  const elapsedSeconds = Math.max(0, totalSeconds - secondsLeft);
  const prayerProgress = Math.max(0, Math.min(1, elapsedSeconds / Math.max(1, totalSeconds)));
  const handsTravel = Math.max(0, progressTrackWidth - 26);
  const handsX = prayerProgress * handsTravel;
  const phaseText = useMemo(() => {
    if (secondsLeft <= 0) return "Prayer complete";
    if (!running && elapsedSeconds === 0) return "Ready to begin";
    if (!running) return "Paused in stillness";
    if (prayerProgress < 0.34) return "Arriving";
    if (prayerProgress < 0.67) return "Deepening";
    return "Integrating";
  }, [elapsedSeconds, prayerProgress, running, secondsLeft]);

  const stopVoice = useCallback(async () => {
    voiceRequestIdRef.current += 1;
    const sound = soundRef.current;
    soundRef.current = null;
    setVoiceLoading(false);
    if (!sound) {
      setVoicePlaying(false);
      return;
    }
    try {
      await sound.stopAsync();
    } catch {
      // ignore
    }
    try {
      await sound.unloadAsync();
    } catch {
      // ignore
    }
    setVoicePlaying(false);
  }, []);

  const pauseVoice = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) {
      setVoicePlaying(false);
      return;
    }
    try {
      await sound.pauseAsync();
    } catch {
      // ignore
    }
    setVoicePlaying(false);
  }, []);

  useEffect(() => {
    const animatePulse = (value: Animated.Value, delayMs: number) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(value, {
            toValue: 1,
            duration: 3600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 3600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return loop;
    };

    const a = animatePulse(pulseA, 0);
    const b = animatePulse(pulseB, 900);
    const cLoop = animatePulse(pulseC, 1700);
    return () => {
      a.stop();
      b.stop();
      cLoop.stop();
    };
  }, [pulseA, pulseB, pulseC]);

  useEffect(() => {
    if (!voiceLoading || running) {
      startCtaPulse.stopAnimation();
      startCtaPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(startCtaPulse, {
          toValue: 1.04,
          duration: 420,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(startCtaPulse, {
          toValue: 0.97,
          duration: 420,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      startCtaPulse.stopAnimation();
      startCtaPulse.setValue(1);
    };
  }, [running, startCtaPulse, voiceLoading]);

  useEffect(() => {
    if (!running || voicePlaying) return;
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, voicePlaying]);

  const syncSessionFromDurationMillis = useCallback((durationMillis: unknown) => {
    const ms = Number(durationMillis);
    if (!Number.isFinite(ms) || ms <= 0) return;
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    setSessionTotalSeconds(seconds);
    setSecondsLeft(seconds);
  }, []);

  const openSuggestedGroupEvent = useCallback(() => {
    const inviteDescription = `Join me for a ${minutes}-minute ${
      requestedTitle || "guided prayer"
    } inside Egregor.`;
    navigation.navigate("RootTabs", {
      screen: "Events",
      params: {
        openCreate: true,
        prefillTitle: `Group ${requestedTitle}`,
        prefillIntention: requestedIntention,
        prefillDescription: inviteDescription,
        prefillMinutes: minutes,
      },
    });
  }, [minutes, navigation, requestedIntention, requestedTitle]);

  const onComplete = useCallback(() => {
    if (completionHandledRef.current) return;
    completionHandledRef.current = true;
    setRunning(false);
    void stopVoice();

    void appendSoloHistory({
      completedAt: new Date().toISOString(),
      intent: requestedIntention,
      language: preferredLanguage,
      ambientPreset: "Silence",
      breathMode: "Calm",
      minutes,
    });

    const prefill = `Prayer: ${requestedTitle}\nIntention: ${requestedIntention}\n\nReflection:`;
    Alert.alert(
      "Session complete",
      "Beautiful focus. Capture what came up while it is fresh, then invite others into the same intention.",
      [
        { text: "Later", onPress: () => navigation.goBack() },
        {
          text: "Journal now",
          onPress: () =>
            navigation.navigate("JournalCompose", {
              source: "solo",
              prefill,
              suggestedEvent: {
                title: `Group ${requestedTitle}`,
                intention: requestedIntention,
                description: `Join me for a ${minutes}-minute ${requestedTitle.toLowerCase()} prayer inside Egregor.`,
                minutes,
              },
            }),
        },
        { text: "Invite group", onPress: openSuggestedGroupEvent },
      ]
    );
  }, [
    minutes,
    navigation,
    openSuggestedGroupEvent,
    preferredLanguage,
    requestedIntention,
    requestedTitle,
    stopVoice,
  ]);

  useEffect(() => {
    if (secondsLeft !== 0) return;
    onComplete();
  }, [onComplete, secondsLeft]);

  useEffect(() => {
    if (lines.length === 0) return;
    const idx = Math.min(
      lines.length - 1,
      Math.floor((elapsedSeconds / Math.max(1, totalSeconds)) * lines.length)
    );
    setActiveLineIdx(idx);
  }, [elapsedSeconds, lines.length, totalSeconds]);

  const onLineLayout = useCallback((idx: number, e: LayoutChangeEvent) => {
    lineYRef.current[idx] = e.nativeEvent.layout.y;
  }, []);

  useEffect(() => {
    const y = lineYRef.current[activeLineIdx];
    if (!Number.isFinite(y)) return;
    scriptScrollRef.current?.scrollTo({
      y: Math.max(0, y - 170),
      animated: true,
    });
  }, [activeLineIdx]);

  useEffect(() => {
    lineYRef.current = {};
    setActiveLineIdx(0);
  }, [lines]);

  useEffect(() => {
    return () => {
      void stopVoice();
    };
  }, [stopVoice]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        setRunning(false);
        void stopVoice();
      }
    });
    return () => {
      sub.remove();
    };
  }, [stopVoice]);

  useEffect(() => {
    completionHandledRef.current = false;
    setRunning(false);
    setSessionTotalSeconds(minutes * 60);
    setSecondsLeft(minutes * 60);
    setActiveLineIdx(0);
    lineYRef.current = {};
    void stopVoice();
  }, [minutes, requestedCategory, requestedIntention, requestedTitle, stopVoice]);

  const handleStartVoice = useCallback(async (): Promise<boolean> => {
    if (voiceLoading) return false;
    const requestId = voiceRequestIdRef.current + 1;
    voiceRequestIdRef.current = requestId;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch {
      // ignore
    }

    const existing = soundRef.current;
    if (existing) {
      try {
        await existing.setIsMutedAsync(audioMuted);
        await existing.playAsync();
        setVoicePlaying(true);
        return true;
      } catch {
        await stopVoice();
      }
    }

    setVoiceLoading(true);
    try {
      const generated = await generateSoloVoiceAudio({
        title: requestedTitle,
        intention: requestedIntention,
        lines,
        language: speechLanguageCode(preferredLanguage),
        durationMinutes: minutes,
        voice: preferredVoiceGender === "Male" ? "onyx" : "shimmer",
        speechRate: preferredSpeechRate,
        style:
          "Spiritual, calm, and intentional prayer guide. Speak warmly with gentle pauses and soothing cadence.",
      });
      if (voiceRequestIdRef.current !== requestId) {
        return false;
      }

      const base64 = String(generated.audioBase64 ?? "").trim();
      if (!base64) {
        throw new Error(
          String(generated.warning ?? "").trim() ||
            "No audio returned from voice generation."
        );
      }

      const sound = new Audio.Sound() as unknown as ExpoAvSound;
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (typeof status?.durationMillis === "number" && status.durationMillis > 0) {
          const exactTotal = Math.max(1, Math.ceil(status.durationMillis / 1000));
          setSessionTotalSeconds(exactTotal);
          if (typeof status?.positionMillis === "number") {
            const remaining = Math.max(
              0,
              Math.ceil((status.durationMillis - status.positionMillis) / 1000)
            );
            setSecondsLeft(remaining);
          }
        }
        if (typeof status?.isPlaying === "boolean") {
          setVoicePlaying(!!status.isPlaying);
        }
        if (status?.didJustFinish) {
          setVoicePlaying(false);
          setRunning(false);
          setSecondsLeft(0);
          void sound.unloadAsync();
          if (soundRef.current === sound) {
            soundRef.current = null;
          }
          return;
        }
        if (status?.isLoaded === false) {
          setVoicePlaying(false);
          setRunning(false);
        }
      });

      const mimeType = String(generated.mimeType ?? "audio/mpeg").trim() || "audio/mpeg";
      const status = await sound.loadAsync({
        uri: `data:${mimeType};base64,${base64}`,
      }, { shouldPlay: true });
      if (voiceRequestIdRef.current !== requestId) {
        try {
          await sound.unloadAsync();
        } catch {
          // ignore
        }
        return false;
      }
      syncSessionFromDurationMillis(status?.durationMillis);
      await sound.setIsMutedAsync(audioMuted);
      setVoicePlaying(true);
      return true;
    } catch (error: any) {
      if (voiceRequestIdRef.current !== requestId) {
        return false;
      }
      setVoicePlaying(false);
      Alert.alert(
        "Voice playback failed",
        String(error?.message ?? "").trim() ||
          "Could not generate or play voice guidance right now."
      );
      return false;
    } finally {
      if (voiceRequestIdRef.current === requestId) {
        setVoiceLoading(false);
      }
    }
  }, [
    audioMuted,
    lines,
    minutes,
    preferredLanguage,
    preferredSpeechRate,
    preferredVoiceGender,
    requestedIntention,
    requestedTitle,
    syncSessionFromDurationMillis,
    stopVoice,
    voiceLoading,
  ]);

  const handleToggleMute = useCallback(async () => {
    const next = !audioMuted;
    setAudioMuted(next);
    const sound = soundRef.current;
    if (!sound) return;
    try {
      await sound.setIsMutedAsync(next);
    } catch {
      // ignore
    }
  }, [audioMuted]);

  const resetSession = useCallback(() => {
    completionHandledRef.current = false;
    setRunning(false);
    setSecondsLeft(totalSeconds);
    setActiveLineIdx(0);
    void stopVoice();
  }, [stopVoice, totalSeconds]);

  const handleInviteOthers = useCallback(() => {
    openSuggestedGroupEvent();
  }, [openSuggestedGroupEvent]);

  const handleCloseSession = useCallback(() => {
    setRunning(false);
    void stopVoice();
    navigation.goBack();
  }, [navigation, stopVoice]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setRunning(false);
        void stopVoice();
      };
    }, [stopVoice])
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg }]} edges={["top", "bottom"]}>
      <View style={styles.bgWrap} pointerEvents="none">
        <Animated.View
          style={[
            styles.pulse,
            {
              backgroundColor: palette.pulseA,
              top: "12%",
              left: -80,
              opacity: pulseA.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] }),
              transform: [{ scale: pulseA.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.5] }) }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.pulse,
            {
              backgroundColor: palette.pulseB,
              bottom: "18%",
              right: -70,
              opacity: pulseB.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.4] }),
              transform: [{ scale: pulseB.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.6] }) }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.pulseSmall,
            {
              backgroundColor: palette.pulseC,
              top: "42%",
              right: "28%",
              opacity: pulseC.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.5] }),
              transform: [{ scale: pulseC.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.35] }) }],
            },
          ]}
        />
      </View>

      <View style={styles.topBar}>
        <Pressable style={styles.ghostBtn} onPress={handleCloseSession}>
          <Text style={styles.ghostBtnText}>Close</Text>
        </Pressable>
        <Text style={[styles.phase, { color: palette.text }]}>{phaseText}</Text>
      </View>

      <View style={styles.center}>
        <Text style={[styles.title, { color: palette.text }]}>{requestedTitle}</Text>
        <ScrollView
          ref={scriptScrollRef}
          contentContainerStyle={styles.scriptContent}
          showsVerticalScrollIndicator={false}
        >
          {lines.map((line, idx) => (
            <Text
              key={`${idx}-${line}`}
              onLayout={(e) => onLineLayout(idx, e)}
              style={[
                styles.scriptLine,
                { color: palette.text },
                idx === activeLineIdx && styles.scriptLineActive,
              ]}
            >
              {line}
            </Text>
          ))}
        </ScrollView>
      </View>

      <View style={styles.actions}>
        <Animated.View
          style={[
            styles.actionBtnAnimatedWrap,
            {
              transform: [{ scale: startCtaPulse }],
              opacity: voiceLoading && !running ? 0.96 : 1,
            },
          ]}
        >
          <Pressable
            style={[styles.actionBtn, { backgroundColor: c.primary }]}
            disabled={voiceLoading}
            onPress={async () => {
              if (running) {
                setRunning(false);
                await pauseVoice();
                return;
              }
              if (secondsLeft <= 0) {
                completionHandledRef.current = false;
                setSecondsLeft(totalSeconds);
                setActiveLineIdx(0);
              }
              const ok = await handleStartVoice();
              if (ok) setRunning(true);
            }}
          >
            <Text style={styles.actionBtnText}>
              {running ? "Pause" : voiceLoading ? "Starting..." : "Start prayer"}
            </Text>
          </Pressable>
        </Animated.View>

        <Pressable
          style={[styles.actionBtnOutline, { borderColor: "#d8ecff" }]}
          onPress={resetSession}
        >
          <Text style={[styles.actionBtnOutlineText, { color: palette.text }]}>Reset</Text>
        </Pressable>

        <Pressable
          style={[
            styles.actionBtnOutline,
            { borderColor: "#d8ecff", opacity: voiceLoading && !voicePlaying ? 0.7 : 1 },
          ]}
          onPress={handleToggleMute}
          disabled={voiceLoading}
        >
          <Text style={[styles.actionBtnOutlineText, { color: palette.text }]}>
            {audioMuted ? "Unmute voice" : "Mute voice"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtnWide, { borderColor: "#d8ecff" }]}
          onPress={handleInviteOthers}
        >
          <Text style={[styles.actionBtnOutlineText, { color: palette.text }]}>Invite others</Text>
        </Pressable>
      </View>

      <View style={styles.progressWrap}>
        <View
          style={styles.progressTrack}
          onLayout={(event) => setProgressTrackWidth(event.nativeEvent.layout.width)}
        >
          <View
            style={[
              styles.progressFill,
              { width: `${Math.max(0, prayerProgress * 100)}%`, backgroundColor: c.primary },
            ]}
          />
          <View style={[styles.handsWrap, { transform: [{ translateX: handsX }] }]}>
            <MaterialCommunityIcons name="hands-pray" size={17} color="#eff8ff" />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  bgWrap: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  pulse: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 999,
  },
  pulseSmall: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 999,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: "rgba(216,236,255,0.45)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "rgba(7,18,34,0.35)",
  },
  ghostBtnText: {
    color: "#eef6ff",
    fontWeight: "700",
    fontSize: 12,
  },
  phase: {
    fontSize: 13,
    fontWeight: "800",
    opacity: 0.95,
  },
  center: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 26,
  },
  title: {
    textAlign: "center",
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900",
    marginBottom: 14,
  },
  scriptContent: {
    paddingBottom: 18,
    gap: 10,
  },
  scriptLine: {
    textAlign: "center",
    fontSize: 22,
    lineHeight: 32,
    paddingHorizontal: 8,
    paddingVertical: 2,
    opacity: 0.86,
  },
  scriptLineActive: {
    opacity: 1,
    transform: [{ scale: 1.03 }],
    textShadowColor: "rgba(255,255,255,0.25)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  actionBtnAnimatedWrap: {
    flex: 1,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  actionBtnOutline: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,18,34,0.35)",
  },
  actionBtnOutlineText: {
    fontSize: 14,
    fontWeight: "800",
  },
  actionBtnWide: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,18,34,0.35)",
  },
  progressWrap: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  progressTrack: {
    height: 16,
    borderRadius: 999,
    overflow: "visible",
    backgroundColor: "rgba(225,240,255,0.25)",
    justifyContent: "center",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  handsWrap: {
    position: "absolute",
    left: 0,
    top: -11,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(7,18,34,0.75)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
});
