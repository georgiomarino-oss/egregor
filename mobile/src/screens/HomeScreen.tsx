import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  LayoutChangeEvent,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { supabase } from "../supabase/client";
import type { Database } from "../types/db";
import type { RootStackParamList, RootTabParamList } from "../types";
import { useAppState } from "../state";
import { getScreenColors } from "../theme/appearance";
import { getUnreadNotificationCount } from "../features/notifications/notificationsRepo";
import {
  consumeAiGenerationQuota,
  generateSoloGuidance,
  getAiQuotaSnapshot,
  type AiQuotaResult,
} from "../features/ai/aiScriptRepo";
import {
  appendSoloHistory,
  getSoloHistoryStats,
  listSoloHistory,
  type SoloHistoryEntry,
} from "../features/solo/soloHistoryRepo";
import { logMonetizationEvent } from "../features/billing/billingAnalyticsRepo";
import { getCircleSummary } from "../features/community/communityRepo";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type CommunityFeedItem = {
  id: string;
  body: string;
  createdAt: string;
  eventId: string | null;
  userId: string;
  eventTitle: string;
  displayName: string;
  source: "chat" | "journal";
};
type HomeDashboardSnapshotRow = {
  weekly_impact: number | null;
  previous_weekly_impact: number | null;
  active_global_participants: number | null;
  active_global_events: number | null;
  feed_items: unknown;
};
type CirclePastEventSummary = {
  id: string;
  title: string;
  endTimeUtc: string;
  totalJoinCount: number;
  positiveCount: number;
  totalReports: number;
};

const HOME_RESYNC_MS = 30_000;
const KEY_PROFILE_PREFS = "profile:prefs:v1";
const KEY_DAILY_INTENTION = "onboarding:intention:v1";
type HomeLanguage = "English" | "Spanish" | "Portuguese" | "French";
type AmbientPreset = "Silence" | "Rain" | "Singing Bowls" | "Binaural";
type BreathMode = "Calm" | "Deep";
type SoloDurationMin = 3 | 5 | 10;
type ExpoSpeechModule = {
  speak: (
    text: string,
    options?: {
      language?: string;
      rate?: number;
      pitch?: number;
      onDone?: () => void;
      onStopped?: () => void;
      onError?: (error: unknown) => void;
    }
  ) => void;
  stop: () => void;
};

let cachedSpeechModule: ExpoSpeechModule | null | undefined;

function getSpeechModule(): ExpoSpeechModule | null {
  if (cachedSpeechModule !== undefined) return cachedSpeechModule;
  try {
    const runtimeRequire = (globalThis as any)?.require;
    if (typeof runtimeRequire !== "function") {
      cachedSpeechModule = null;
      return null;
    }
    const mod = runtimeRequire("expo-speech") as ExpoSpeechModule | undefined;
    const valid = !!mod && typeof mod.speak === "function" && typeof mod.stop === "function";
    cachedSpeechModule = valid ? mod : null;
    return cachedSpeechModule;
  } catch {
    cachedSpeechModule = null;
    return null;
  }
}

function normalizeLanguage(v: string): HomeLanguage {
  const raw = v.trim().toLowerCase();
  if (raw.startsWith("span")) return "Spanish";
  if (raw.startsWith("port")) return "Portuguese";
  if (raw.startsWith("fren")) return "French";
  return "English";
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function shortId(id: string) {
  if (!id) return "";
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function resolveBreathPhase(elapsedSeconds: number, mode: BreathMode) {
  const pattern =
    mode === "Deep"
      ? [
          { name: "Inhale", seconds: 5 },
          { name: "Hold", seconds: 4 },
          { name: "Exhale", seconds: 7 },
        ]
      : [
          { name: "Inhale", seconds: 4 },
          { name: "Hold", seconds: 4 },
          { name: "Exhale", seconds: 6 },
        ];

  const total = pattern.reduce((sum, p) => sum + p.seconds, 0);
  const t = ((Math.max(0, elapsedSeconds) % total) + total) % total;
  let cursor = 0;
  for (const p of pattern) {
    const next = cursor + p.seconds;
    if (t < next) {
      return {
        phase: p.name,
        secondsRemaining: next - t,
      };
    }
    cursor = next;
  }
  return { phase: "Inhale", secondsRemaining: pattern[0].seconds };
}

function speechLanguageCode(language: HomeLanguage) {
  if (language === "Spanish") return "es-ES";
  if (language === "Portuguese") return "pt-PT";
  if (language === "French") return "fr-FR";
  return "en-US";
}

function buildSoloPrayer(intent: string, language: HomeLanguage) {
  const core = intent.trim() || "peace and healing";
  if (language === "Spanish") {
    return [
      `Inhala despacio y centra tu atencion en ${core}.`,
      "Exhala y suaviza hombros, mandibula y respiracion.",
      `Con cada inhalacion, invita claridad y compasion a ${core}.`,
      "Con cada exhalacion, suelta el miedo y el apego al resultado.",
      "Descansa en gratitud por lo que ya esta cambiando en tu vida.",
    ];
  }
  if (language === "Portuguese") {
    return [
      `Inspire lentamente e concentre sua atencao em ${core}.`,
      "Expire e relaxe ombros, mandibula e respiracao.",
      `A cada inspiracao, convide clareza e compaixao para ${core}.`,
      "A cada expiracao, solte o medo e o apego aos resultados.",
      "Descanse em gratidao pelo que ja esta mudando em sua vida.",
    ];
  }
  if (language === "French") {
    return [
      `Inspirez lentement et centrez votre attention sur ${core}.`,
      "Expirez et relachez epaules, machoire et souffle.",
      `A chaque inspiration, invitez clarte et compassion dans ${core}.`,
      "A chaque expiration, liberez la peur et l'attachement au resultat.",
      "Reposez-vous dans la gratitude pour ce qui change deja dans votre vie.",
    ];
  }
  return [
    `Breathe in slowly and center your awareness on ${core}.`,
    "Breathe out and soften your shoulders, jaw, and breath.",
    `With each inhale, invite clarity and compassion into ${core}.`,
    "With each exhale, release fear and attachment to outcomes.",
    "Rest in gratitude for what is already shifting in your life.",
  ];
}

function truncate(text: string, max = 150) {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
}

function safeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export default function HomeScreen() {
  const { theme, highContrast, user, isCircleMember } = useAppState();
  const c = useMemo(() => getScreenColors(theme, highContrast, "home"), [theme, highContrast]);
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootTabParamList, "Home"> | RouteProp<RootTabParamList, "Solo">>();

  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [weeklyImpact, setWeeklyImpact] = useState(0);
  const [previousWeeklyImpact, setPreviousWeeklyImpact] = useState(0);
  const [activeGlobalParticipants, setActiveGlobalParticipants] = useState(0);
  const [activeGlobalEvents, setActiveGlobalEvents] = useState(0);
  const [feedItems, setFeedItems] = useState<CommunityFeedItem[]>([]);
  const [showFullFeed, setShowFullFeed] = useState(false);
  const [showExpandedHome, setShowExpandedHome] = useState(false);
  const [preferredLanguage, setPreferredLanguage] = useState<HomeLanguage>("English");
  const [showCommunityFeed, setShowCommunityFeed] = useState(true);
  const [dailyIntention, setDailyIntention] = useState("peace and clarity");
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [circleMembersCount, setCircleMembersCount] = useState(0);
  const [circlePendingCount, setCirclePendingCount] = useState(0);
  const [circlePastEvents, setCirclePastEvents] = useState<CirclePastEventSummary[]>([]);
  const [soloOpen, setSoloOpen] = useState(false);
  const [soloIntent, setSoloIntent] = useState("peace, healing, and grounded courage");
  const [soloDurationMin, setSoloDurationMin] = useState<SoloDurationMin>(3);
  const [soloSecondsLeft, setSoloSecondsLeft] = useState(180);
  const [soloRunning, setSoloRunning] = useState(false);
  const [ambientPreset, setAmbientPreset] = useState<AmbientPreset>("Silence");
  const [breathMode, setBreathMode] = useState<BreathMode>("Calm");
  const [soloCompletionTick, setSoloCompletionTick] = useState(0);
  const [soloCompletedMinutes, setSoloCompletedMinutes] = useState<SoloDurationMin>(3);
  const [soloSessionsWeek, setSoloSessionsWeek] = useState(0);
  const [soloMinutesWeek, setSoloMinutesWeek] = useState(0);
  const [lastSoloAt, setLastSoloAt] = useState<string | null>(null);
  const [soloRecent, setSoloRecent] = useState<SoloHistoryEntry[]>([]);
  const [soloAiLines, setSoloAiLines] = useState<string[] | null>(null);
  const [soloGeneratingAi, setSoloGeneratingAi] = useState(false);
  const [soloAiQuota, setSoloAiQuota] = useState<AiQuotaResult | null>(null);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [soloActiveLineIdx, setSoloActiveLineIdx] = useState(-1);
  const lastJournalPromptTickRef = useRef(0);
  const homeLoadInFlightRef = useRef(false);
  const homeLoadQueuedRef = useRef(false);
  const voiceSessionRef = useRef(0);
  const soloModalScrollRef = useRef<ScrollView | null>(null);
  const soloLineYRef = useRef<Record<number, number>>({});

  useFocusEffect(
    useCallback(() => {
      const params = ((route as any)?.params ?? {}) as { openSolo?: boolean; soloPreset?: string };
      const fromSoloTab = (route as any)?.name === "Solo";
      const wantsOpenSolo = !!params.openSolo || fromSoloTab;
      const preset = String(params.soloPreset ?? "").trim();

      if (!wantsOpenSolo && !preset) return;

      if (preset) {
        setSoloIntent(preset);
        setSoloAiLines(null);
      }
      setSoloOpen(true);

      if (params.openSolo || params.soloPreset) {
        navigation.setParams?.({ openSolo: undefined, soloPreset: undefined });
      }
    }, [navigation, route])
  );

  const liveEvents = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => {
      const start = safeTimeMs((e as any).start_time_utc);
      const end = safeTimeMs((e as any).end_time_utc);
      return start > 0 && start <= now && (end <= 0 || now <= end);
    });
  }, [events]);

  const alertCount = useMemo(() => {
    const now = Date.now();
    const liveCount = liveEvents.length;
    const soonCount = events.filter((e) => {
      const start = safeTimeMs((e as any).start_time_utc);
      if (!start || start <= now) return false;
      return start - now <= 60 * 60 * 1000;
    }).length;
    return liveCount + soonCount;
  }, [events, liveEvents]);

  const refreshUnreadNotifications = useCallback(async () => {
    try {
      const count = await getUnreadNotificationCount();
      setUnreadNotifications(count);
    } catch {
      setUnreadNotifications(0);
    }
  }, []);

  const refreshSoloStats = useCallback(async () => {
    try {
      const [stats, recent] = await Promise.all([getSoloHistoryStats(7), listSoloHistory()]);
      setSoloSessionsWeek(stats.sessionCount);
      setSoloMinutesWeek(stats.totalMinutes);
      setLastSoloAt(stats.lastCompletedAt);
      setSoloRecent(recent.slice(0, 3));
    } catch {
      setSoloSessionsWeek(0);
      setSoloMinutesWeek(0);
      setLastSoloAt(null);
      setSoloRecent([]);
    }
  }, []);

  const refreshCircleSnapshot = useCallback(async () => {
    const uid = String(user?.id ?? "").trim();
    if (!uid) {
      setCircleMembersCount(0);
      setCirclePendingCount(0);
      setCirclePastEvents([]);
      return;
    }

    try {
      const [summary, pastEventsResp] = await Promise.all([
        getCircleSummary(),
        (supabase as any)
          .from("events")
          .select("id,title,end_time_utc,total_join_count")
          .eq("host_user_id", uid)
          .lt("end_time_utc", new Date().toISOString())
          .order("end_time_utc", { ascending: false })
          .limit(8),
      ]);

      setCircleMembersCount(safeCount(summary.membersCount));
      setCirclePendingCount(safeCount(summary.pendingIncomingCount));

      const pastEvents = (pastEventsResp?.data ?? []) as any[];
      const eventIds = pastEvents.map((row) => String(row?.id ?? "")).filter(Boolean);
      if (!eventIds.length) {
        setCirclePastEvents([]);
        return;
      }

      const { data: outcomeRows } = await (supabase as any)
        .from("event_outcome_reports")
        .select("event_id,outcome_type")
        .in("event_id", eventIds);

      const byEvent = new Map<string, { positive: number; total: number }>();
      for (const row of outcomeRows ?? []) {
        const eventId = String((row as any)?.event_id ?? "");
        if (!eventId) continue;
        const outcomeType = String((row as any)?.outcome_type ?? "").trim().toLowerCase();
        const current = byEvent.get(eventId) ?? { positive: 0, total: 0 };
        current.total += 1;
        if (outcomeType === "positive") current.positive += 1;
        byEvent.set(eventId, current);
      }

      const rows: CirclePastEventSummary[] = pastEvents.map((eventRow) => {
        const eventId = String(eventRow?.id ?? "");
        const tally = byEvent.get(eventId) ?? { positive: 0, total: 0 };
        return {
          id: eventId,
          title: String(eventRow?.title ?? "Untitled event"),
          endTimeUtc: String(eventRow?.end_time_utc ?? ""),
          totalJoinCount: safeCount(eventRow?.total_join_count),
          positiveCount: safeCount(tally.positive),
          totalReports: safeCount(tally.total),
        };
      });

      setCirclePastEvents(rows);
    } catch {
      setCircleMembersCount(0);
      setCirclePendingCount(0);
      setCirclePastEvents([]);
    }
  }, [user?.id]);

  const recommendedEvents = useMemo(() => {
    const now = Date.now();
    return [...events]
      .filter((e) => safeTimeMs((e as any).end_time_utc) >= now)
      .sort((a, b) => safeTimeMs((a as any).start_time_utc) - safeTimeMs((b as any).start_time_utc))
      .slice(0, 4);
  }, [events]);
  const visibleFeedItems = useMemo(
    () => (showFullFeed ? feedItems : feedItems.slice(0, 2)),
    [feedItems, showFullFeed]
  );

  const activeNow = useMemo(() => {
    return liveEvents.reduce((sum, e) => sum + Number((e as any).active_count_snapshot ?? 0), 0);
  }, [liveEvents]);
  const impactDeltaPct = useMemo(() => {
    if (previousWeeklyImpact <= 0) return weeklyImpact > 0 ? 100 : 0;
    return Math.round(((weeklyImpact - previousWeeklyImpact) / previousWeeklyImpact) * 100);
  }, [weeklyImpact, previousWeeklyImpact]);
  const impactDeltaLabel = useMemo(() => {
    if (impactDeltaPct > 0) return `+${impactDeltaPct}% vs last week`;
    if (impactDeltaPct < 0) return `${impactDeltaPct}% vs last week`;
    return "No change vs last week";
  }, [impactDeltaPct]);

  const defaultSoloLines = useMemo(
    () => buildSoloPrayer(soloIntent, preferredLanguage),
    [soloIntent, preferredLanguage]
  );
  const soloLines = useMemo(
    () => (soloAiLines && soloAiLines.length > 0 ? soloAiLines : defaultSoloLines),
    [defaultSoloLines, soloAiLines]
  );
  const selectedDurationSeconds = useMemo(() => soloDurationMin * 60, [soloDurationMin]);
  const breathGuide = useMemo(() => {
    const elapsed = Math.max(0, selectedDurationSeconds - soloSecondsLeft);
    return resolveBreathPhase(elapsed, breathMode);
  }, [soloSecondsLeft, breathMode, selectedDurationSeconds]);

  const ui = useMemo(() => {
    if (preferredLanguage === "Spanish") {
      return {
        hero: "Cual es tu intencion hoy?",
        subtitle: "Unete a un circulo global sincronizado o inicia tu propio momento de enfoque.",
        joinLive: "Unirse en vivo",
        browseEvents: "Explorar eventos",
        quickSolo: "Oracion individual rapida",
        communityFeed: "Comunidad",
        noShares: "Aun no hay mensajes publicos.",
      };
    }
    if (preferredLanguage === "Portuguese") {
      return {
        hero: "Qual e a sua intencao hoje?",
        subtitle: "Participe de um circulo global sincronizado ou inicie seu proprio momento de foco.",
        joinLive: "Entrar ao vivo",
        browseEvents: "Ver eventos",
        quickSolo: "Oracao individual rapida",
        communityFeed: "Comunidade",
        noShares: "Ainda nao ha mensagens publicas.",
      };
    }
    if (preferredLanguage === "French") {
      return {
        hero: "Quelle est votre intention aujourd'hui?",
        subtitle: "Rejoignez un cercle mondial synchronise ou commencez votre propre moment de centrage.",
        joinLive: "Rejoindre en direct",
        browseEvents: "Parcourir les evenements",
        quickSolo: "Priere solo rapide",
        communityFeed: "Communaute",
        noShares: "Pas encore de partages publics.",
      };
    }
    return {
      hero: "What is your intention today?",
      subtitle: "Join a synchronized global circle or begin your own focused moment.",
      joinLive: "Join Live Now",
      browseEvents: "Browse Events",
      quickSolo: "Quick Solo Prayer",
      communityFeed: "Community Feed",
      noShares: "No public shares yet.",
    };
  }, [preferredLanguage]);

  const loadHome = useCallback(async () => {
    if (homeLoadInFlightRef.current) {
      homeLoadQueuedRef.current = true;
      return;
    }

    homeLoadInFlightRef.current = true;
    setLoading(true);
    try {
      const [{ data: eventRows }, { data: snapshotData, error: snapshotError }] =
        await Promise.all([
          supabase
            .from("events")
            .select(
              "id,title,intention_statement,start_time_utc,end_time_utc,timezone,active_count_snapshot,total_join_count,host_user_id"
            )
            .order("start_time_utc", { ascending: true })
            .limit(80),
          supabase.rpc("get_home_dashboard_snapshot"),
        ]);

      setEvents((eventRows ?? []) as EventRow[]);
      if (snapshotError) {
        setWeeklyImpact(0);
        setPreviousWeeklyImpact(0);
        setActiveGlobalParticipants(0);
        setActiveGlobalEvents(0);
        setFeedItems([]);
      } else {
        const snapshot = Array.isArray(snapshotData)
          ? ((snapshotData[0] as HomeDashboardSnapshotRow | undefined) ?? null)
          : ((snapshotData as HomeDashboardSnapshotRow | null) ?? null);

        setWeeklyImpact(safeCount(snapshot?.weekly_impact));
        setPreviousWeeklyImpact(safeCount(snapshot?.previous_weekly_impact));
        setActiveGlobalParticipants(safeCount(snapshot?.active_global_participants));
        setActiveGlobalEvents(safeCount(snapshot?.active_global_events));

        const rawFeed = snapshot?.feed_items;
        const feed = Array.isArray(rawFeed) ? rawFeed : [];
        setFeedItems(
          feed.map((item) => {
            const row = item as Record<string, unknown>;
            const userId = String(row.userId ?? "");
            const sourceRaw = String(row.source ?? "").trim().toLowerCase();
            const source: "chat" | "journal" = sourceRaw === "journal" ? "journal" : "chat";
            return {
              id: String(row.id ?? ""),
              body: String(row.body ?? ""),
              createdAt: String(row.createdAt ?? ""),
              eventId: row.eventId ? String(row.eventId) : null,
              userId,
              eventTitle: String(row.eventTitle ?? "Live circle"),
              displayName: String(row.displayName ?? shortId(userId)),
              source,
            };
          })
        );
      }
    } finally {
      setLoading(false);
      homeLoadInFlightRef.current = false;
      if (homeLoadQueuedRef.current) {
        homeLoadQueuedRef.current = false;
        void loadHome();
      }
    }
  }, []);

  const refreshHomeBundle = useCallback(async () => {
    await Promise.all([loadHome(), refreshUnreadNotifications(), refreshSoloStats(), refreshCircleSnapshot()]);
  }, [loadHome, refreshCircleSnapshot, refreshUnreadNotifications, refreshSoloStats]);

  const refreshSoloAiQuota = useCallback(async () => {
    const uid = String(user?.id ?? "").trim();
    if (!uid) {
      setSoloAiQuota(null);
      return;
    }
    const quota = await getAiQuotaSnapshot({
      userId: uid,
      mode: "solo_guidance",
      isPremium: isCircleMember,
    });
    setSoloAiQuota(quota);
  }, [isCircleMember, user?.id]);

  useFocusEffect(
    useCallback(() => {
      let disposed = false;
      let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
      const scheduleRefresh = () => {
        if (disposed || refreshTimeout) return;
        refreshTimeout = setTimeout(() => {
          refreshTimeout = null;
          if (disposed) return;
          void refreshHomeBundle();
        }, 1200);
      };
      const run = async () => {
        const [raw, intentionRaw] = await Promise.all([
          AsyncStorage.getItem(KEY_PROFILE_PREFS),
          AsyncStorage.getItem(KEY_DAILY_INTENTION),
        ]);
        if (disposed) return;
        if (intentionRaw && intentionRaw.trim()) {
          setDailyIntention(intentionRaw.trim());
        } else {
          setDailyIntention("peace and clarity");
        }
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            setPreferredLanguage(normalizeLanguage(String(parsed?.language ?? "English")));
            setShowCommunityFeed(parsed?.showCommunityFeed !== false);
            setVoiceModeEnabled(!!parsed?.voiceMode);
          } catch {
            setPreferredLanguage("English");
            setShowCommunityFeed(true);
            setVoiceModeEnabled(false);
          }
        } else {
          setPreferredLanguage("English");
          setShowCommunityFeed(true);
          setVoiceModeEnabled(false);
        }
        if (!disposed) await refreshHomeBundle();
      };
      void run();
      const id = setInterval(() => {
        void refreshHomeBundle();
      }, HOME_RESYNC_MS);

      const realtime = supabase
        .channel("home:refresh")
        .on("postgres_changes", { event: "*", schema: "public", table: "events" }, scheduleRefresh)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "event_presence" },
          scheduleRefresh
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "event_messages" },
          scheduleRefresh
        )
        .subscribe();

      return () => {
        disposed = true;
        clearInterval(id);
        if (refreshTimeout) clearTimeout(refreshTimeout);
        supabase.removeChannel(realtime);
      };
    }, [refreshHomeBundle])
  );

  const openEventRoom = useCallback(
    (eventId: string) => {
      if (!isLikelyUuid(eventId)) {
        Alert.alert("Invalid event", "Could not open this event.");
        return;
      }
      const navToUse = navigation.getParent?.() ?? navigation;
      (navToUse as any).navigate("EventRoom" as keyof RootStackParamList, { eventId });
    },
    [navigation]
  );

  const joinLiveNow = useCallback(() => {
    const live = liveEvents[0];
    if (!live) {
      Alert.alert("No live events", "There is no live event right now. Try one of the upcoming circles.");
      return;
    }
    openEventRoom(live.id);
  }, [liveEvents, openEventRoom]);

  const openNotifications = useCallback(() => {
    const navToUse = navigation.getParent?.() ?? navigation;
    (navToUse as any).navigate("Notifications" as keyof RootStackParamList);
  }, [navigation]);

  React.useEffect(() => {
    setVoiceAvailable(!!getSpeechModule());
  }, []);

  const stopSoloVoice = useCallback(() => {
    voiceSessionRef.current += 1;
    const speech = getSpeechModule();
    if (speech) {
      try {
        speech.stop();
      } catch {
        // ignore
      }
    }
    setVoicePlaying(false);
    setSoloActiveLineIdx(-1);
  }, []);

  const registerSoloLineLayout = useCallback((idx: number, e: LayoutChangeEvent) => {
    soloLineYRef.current[idx] = e.nativeEvent.layout.y;
  }, []);

  const scrollToSoloLine = useCallback((idx: number) => {
    const y = soloLineYRef.current[idx];
    if (!Number.isFinite(y)) return;
    soloModalScrollRef.current?.scrollTo({
      y: Math.max(0, y - 180),
      animated: true,
    });
  }, []);

  React.useEffect(() => {
    if (soloOpen) return;
    stopSoloVoice();
  }, [soloOpen, stopSoloVoice]);

  React.useEffect(() => {
    return () => {
      stopSoloVoice();
    };
  }, [stopSoloVoice]);

  const playSoloVoice = useCallback(() => {
    if (!voiceModeEnabled) {
      Alert.alert("Voice mode is off", "Enable Voice mode in Profile to use spoken solo guidance.");
      return;
    }

    const speech = getSpeechModule();
    setVoiceAvailable(!!speech);
    if (!speech) {
      Alert.alert(
        "Voice guidance unavailable",
        "Install expo-speech to enable spoken solo guidance.\n\nRun: npx expo install expo-speech"
      );
      return;
    }

    const nextSessionId = voiceSessionRef.current + 1;
    voiceSessionRef.current = nextSessionId;
    try {
      speech.stop();
    } catch {
      // ignore
    }

    const intentCore = soloIntent.trim() || "peace and healing";
    const introByLanguage: Record<HomeLanguage, string> = {
      English: `Let us begin. Your intention is ${intentCore}.`,
      Spanish: `Comencemos. Tu intencion es ${intentCore}.`,
      Portuguese: `Vamos comecar. Sua intencao e ${intentCore}.`,
      French: `Commencons. Votre intention est ${intentCore}.`,
    };
    const finishIfCurrent = () => {
      if (voiceSessionRef.current !== nextSessionId) return;
      setVoicePlaying(false);
      setSoloActiveLineIdx(-1);
    };

    const speakScriptLine = (lineIndex: number) => {
      if (voiceSessionRef.current !== nextSessionId) return;
      if (lineIndex >= soloLines.length) {
        finishIfCurrent();
        return;
      }

      setSoloActiveLineIdx(lineIndex);
      scrollToSoloLine(lineIndex);

      speech.speak(soloLines[lineIndex], {
        language: speechLanguageCode(preferredLanguage),
        rate: breathMode === "Deep" ? 0.9 : 0.96,
        pitch: 1,
        onDone: () => speakScriptLine(lineIndex + 1),
        onStopped: finishIfCurrent,
        onError: () => {
          finishIfCurrent();
          Alert.alert("Voice playback failed", "Could not play voice guidance on this device.");
        },
      });
    };

    setVoicePlaying(true);
    speech.speak(introByLanguage[preferredLanguage], {
      language: speechLanguageCode(preferredLanguage),
      rate: breathMode === "Deep" ? 0.9 : 0.96,
      pitch: 1,
      onDone: () => speakScriptLine(0),
      onStopped: finishIfCurrent,
      onError: () => {
        finishIfCurrent();
        Alert.alert("Voice playback failed", "Could not play voice guidance on this device.");
      },
    });
  }, [breathMode, preferredLanguage, soloIntent, soloLines, voiceModeEnabled, scrollToSoloLine]);

  const closeSoloModal = useCallback(() => {
    stopSoloVoice();
    setSoloOpen(false);
  }, [stopSoloVoice]);

  React.useEffect(() => {
    if (!soloOpen) return;
    if (!soloRunning) return;

    const id = setInterval(() => {
      setSoloSecondsLeft((prev) => {
        if (prev <= 1) {
          setSoloRunning(false);
          stopSoloVoice();
          setSoloCompletedMinutes(soloDurationMin);
          setSoloCompletionTick(Date.now());
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [soloOpen, soloRunning, soloDurationMin, stopSoloVoice]);

  React.useEffect(() => {
    if (!soloOpen) return;
    void refreshSoloAiQuota();
  }, [soloOpen, refreshSoloAiQuota]);

  const handleGenerateSoloAi = useCallback(async () => {
    const uid = String(user?.id ?? "").trim();
    if (!uid) {
      Alert.alert("Not signed in", "Please sign in to generate AI solo guidance.");
      return;
    }

    void logMonetizationEvent({
      userId: uid,
      eventName: "premium_feature_use",
      stage: "attempt",
      isCircleMember: isCircleMember,
      metadata: {
        feature: "ai_solo_guidance_generate",
        mode: "solo_guidance",
        isPremium: isCircleMember,
      },
    });

    const quota = await consumeAiGenerationQuota({
      userId: uid,
      mode: "solo_guidance",
      isPremium: isCircleMember,
    });
    setSoloAiQuota(quota);
    if (!quota.allowed) {
      void logMonetizationEvent({
        userId: uid,
        eventName: "premium_feature_use",
        stage: "failure",
        isCircleMember: isCircleMember,
        errorMessage: "quota_denied",
        metadata: {
          feature: "ai_solo_guidance_generate",
          mode: "solo_guidance",
          isPremium: isCircleMember,
          usedToday: quota.usedToday,
          limit: quota.limit,
          remaining: quota.remaining,
        },
      });
      Alert.alert(
        "Daily AI limit reached",
        `Free tier allows ${quota.limit ?? 0} AI solo guidance generations per day. Upgrade to Egregor Circle for unlimited AI guidance.`
      );
      return;
    }

    setSoloGeneratingAi(true);
    try {
      const generated = await generateSoloGuidance({
        intention: soloIntent.trim() || "peace and healing",
        durationMinutes: soloDurationMin,
        tone: breathMode === "Deep" ? "focused" : "calm",
        language: preferredLanguage,
      });
      setSoloAiLines(generated.lines);
      void logMonetizationEvent({
        userId: uid,
        eventName: "premium_feature_use",
        stage: "success",
        isCircleMember: isCircleMember,
        metadata: {
          feature: "ai_solo_guidance_generate",
          mode: "solo_guidance",
          isPremium: isCircleMember,
          source: generated.source,
          lines: generated.lines.length,
          language: preferredLanguage,
          durationMinutes: soloDurationMin,
        },
      });
      Alert.alert(
        "Guidance ready",
        "Your Egregor guidance is ready. Start whenever you are ready."
      );
    } catch (e: any) {
      void logMonetizationEvent({
        userId: uid,
        eventName: "premium_feature_use",
        stage: "failure",
        isCircleMember: isCircleMember,
        errorMessage: e?.message ?? "Could not generate guidance.",
        metadata: {
          feature: "ai_solo_guidance_generate",
          mode: "solo_guidance",
          isPremium: isCircleMember,
        },
      });
      Alert.alert("Could not generate guidance", "Please try again.");
    } finally {
      setSoloGeneratingAi(false);
      void refreshSoloAiQuota();
    }
  }, [
    breathMode,
    isCircleMember,
    preferredLanguage,
    refreshSoloAiQuota,
    soloDurationMin,
    soloIntent,
    user?.id,
  ]);

  React.useEffect(() => {
    if (!soloCompletionTick) return;
    let cancelled = false;
    const persist = async () => {
      try {
        await appendSoloHistory({
          completedAt: new Date(soloCompletionTick).toISOString(),
          intent: soloIntent.trim() || "peace and healing",
          language: preferredLanguage,
          ambientPreset,
          breathMode,
          minutes: soloCompletedMinutes,
        });
        if (!cancelled) await refreshSoloStats();
      } catch {
        // ignore
      }
    };
    void persist();
    return () => {
      cancelled = true;
    };
  }, [
    ambientPreset,
    breathMode,
    preferredLanguage,
    refreshSoloStats,
    soloCompletedMinutes,
    soloCompletionTick,
    soloIntent,
  ]);

  React.useEffect(() => {
    if (!soloCompletionTick) return;
    if (lastJournalPromptTickRef.current === soloCompletionTick) return;
    lastJournalPromptTickRef.current = soloCompletionTick;
    const navToUse = navigation.getParent?.() ?? navigation;

    Alert.alert(
      "Session complete",
      "Beautiful focus. Would you like to journal this moment while it is still fresh?",
      [
        { text: "Later", style: "cancel" },
        {
          text: "Journal now",
          onPress: () =>
            (navToUse as any).navigate("JournalCompose", {
              source: "solo",
              prefill: `Intention: ${soloIntent.trim() || "peace and healing"}\n\nReflection:`,
            }),
        },
      ]
    );
  }, [navigation, soloCompletionTick, soloIntent]);

  const renderEvent = ({ item }: { item: EventRow }) => {
    const startMs = safeTimeMs((item as any).start_time_utc);
    const label = startMs ? new Date(startMs).toLocaleString() : "Unknown time";
    const isNewsEvent = String((item as any).source ?? "").trim().toLowerCase() === "news";
    const intentionPreview = truncate(
      String((item as any).intention_statement ?? "").trim() ||
        `Host ${shortId(String((item as any).host_user_id ?? ""))}`,
      120
    );
    return (
      <Pressable style={[styles.eventCard, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => openEventRoom(item.id)}>
        <View style={styles.eventTitleRow}>
          <Text style={[styles.eventTitle, { color: c.text }]} numberOfLines={2}>
            {String((item as any).title ?? "Untitled")}
          </Text>
          {isNewsEvent ? (
            <View style={[styles.eventBadge, { borderColor: c.primary, backgroundColor: c.cardAlt }]}>
              <Text style={[styles.eventBadgeText, { color: c.primary }]}>Crisis response</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.eventMeta, { color: c.textMuted }]}>{label}</Text>
        <Text style={[styles.eventMeta, { color: c.text }]} numberOfLines={2}>
          {intentionPreview}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <View style={[styles.glow, { backgroundColor: c.glowA, top: -80, right: -40 }]} />
      <View style={[styles.glow, { backgroundColor: c.glowB, bottom: 140, left: -60 }]} />

      <FlatList
        data={recommendedEvents}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refreshHomeBundle} tintColor={c.primary} />
        }
        ListHeaderComponent={
          <View style={styles.content}>
            <View style={styles.headerRow}>
              <Text style={[styles.kicker, { color: c.textMuted }]}>EGREGOR</Text>
              <Pressable
                style={[styles.notifyBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                onPress={openNotifications}
              >
                <Text style={[styles.notifyBtnText, { color: c.text }]}>
                  Notifications {(unreadNotifications || alertCount) > 0 ? `(${unreadNotifications || alertCount})` : ""}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.hero, { color: c.text }]}>{ui.hero}</Text>
            <Text style={[styles.subtitle, { color: c.text }]}>{ui.subtitle}</Text>
            <View style={[styles.dayPhasePill, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
              <Text style={[styles.dayPhaseText, { color: c.text }]}>
                {c.dayPeriod === "day" ? "Day Flow - Community" : "Evening Flow - Community"}
              </Text>
            </View>
            <View style={[styles.sectionCard, { backgroundColor: c.cardAlt, borderColor: c.border, marginTop: 0 }]}>
              <Text style={[styles.sectionMeta, { color: c.textMuted, marginTop: 0 }]}>Today's intention</Text>
              <Text style={[styles.sectionTitle, { color: c.text }]}>{dailyIntention}</Text>
              <Text style={[styles.sectionMeta, { color: c.textMuted }]}>
                Intention becomes impact when many people hold it together.
              </Text>
            </View>

            <View style={styles.row}>
              <Pressable style={[styles.primaryBtn, { backgroundColor: c.primary }]} onPress={joinLiveNow}>
                <Text style={[styles.primaryBtnText, { color: "#FFFFFF" }]}>{ui.joinLive}</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.card }]}
                onPress={() => navigation.navigate("Events")}
              >
                <Text style={[styles.secondaryBtnText, { color: c.text }]}>{ui.browseEvents}</Text>
              </Pressable>
            </View>
            <Pressable
              style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
              onPress={() =>
                (navigation.getParent?.() ?? navigation).navigate("SoloSession", {
                  title: "Quick Solo Prayer",
                  intention: dailyIntention,
                  category: "Wellbeing",
                  minutes: 3,
                })
              }
            >
              <Text style={[styles.secondaryBtnText, { color: c.text }]}>{ui.quickSolo}</Text>
            </Pressable>

            <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionMeta, { color: c.textMuted, marginTop: 0 }]}>Egregor Circle</Text>
              <Text style={[styles.sectionTitle, { color: c.text }]}>
                {circleMembersCount} member{circleMembersCount === 1 ? "" : "s"}
              </Text>
              <Text style={[styles.sectionMeta, { color: c.textMuted }]}>
                {circlePendingCount > 0
                  ? `${circlePendingCount} request-to-chat pending approval.`
                  : "No pending requests right now."}
              </Text>
              <View style={styles.row}>
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: c.primary }]}
                  onPress={() => (navigation.getParent?.() ?? navigation).navigate("EgregorCircle")}
                >
                  <Text style={[styles.primaryBtnText, { color: "#FFFFFF" }]}>Open Egregor Circle</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                  onPress={() => (navigation.getParent?.() ?? navigation).navigate("CommunityChat")}
                >
                  <Text style={[styles.secondaryBtnText, { color: c.text }]}>Community Chat</Text>
                </Pressable>
              </View>
            </View>

            <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Past Circle Events</Text>
              <Text style={[styles.sectionMeta, { color: c.textMuted }]}>
                Track post-event outcomes to show collective intention in action.
              </Text>
              {!circlePastEvents.length ? (
                <Text style={[styles.sectionMeta, { color: c.textMuted, marginTop: 8 }]}>
                  No completed circle events yet.
                </Text>
              ) : (
                <View style={{ gap: 8, marginTop: 8 }}>
                  {circlePastEvents.slice(0, 3).map((eventRow) => (
                    <Pressable
                      key={eventRow.id}
                      onPress={() => openEventRoom(eventRow.id)}
                      style={[styles.feedCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}
                    >
                      <Text style={[styles.feedMeta, { color: c.textMuted }]}>
                        {eventRow.endTimeUtc ? new Date(eventRow.endTimeUtc).toLocaleDateString() : "Completed"} -{" "}
                        {eventRow.totalJoinCount} joined
                      </Text>
                      <Text style={[styles.feedBody, { color: c.text }]} numberOfLines={2}>
                        {eventRow.title}
                      </Text>
                      <Text style={[styles.feedMeta, { color: c.textMuted }]}>
                        Positive outcomes: {eventRow.positiveCount}/{eventRow.totalReports}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <Pressable
              style={[styles.viewToggleBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
              onPress={() => setShowExpandedHome((v) => !v)}
            >
              <Text style={[styles.viewToggleText, { color: c.text }]}>
                {showExpandedHome ? "Hide insights" : "Show insights"}
              </Text>
            </Pressable>

            {showExpandedHome ? (
              <>
                <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Text style={[styles.sectionMeta, { color: c.textMuted, marginTop: 0 }]}>
                    {activeGlobalParticipants || activeNow} active across {activeGlobalEvents} live event
                    {activeGlobalEvents === 1 ? "" : "s"} right now.
                  </Text>
                  <Text style={[styles.sectionMeta, { color: c.textMuted }]}>{impactDeltaLabel}</Text>
                </View>
                <View style={styles.metricsRow}>
                  <View style={[styles.metricCard, { backgroundColor: c.card, borderColor: c.border }]}>
                    <Text style={[styles.metricValue, { color: c.text }]}>{liveEvents.length}</Text>
                    <Text style={[styles.metricLabel, { color: c.textMuted }]}>Live circles</Text>
                  </View>
                  <View style={[styles.metricCard, { backgroundColor: c.card, borderColor: c.border }]}>
                    <Text style={[styles.metricValue, { color: c.text }]}>
                      {activeGlobalParticipants || activeNow}
                    </Text>
                    <Text style={[styles.metricLabel, { color: c.textMuted }]}>Active now</Text>
                  </View>
                  <View style={[styles.metricCard, { backgroundColor: c.card, borderColor: c.border }]}>
                    <Text style={[styles.metricValue, { color: c.text }]}>{weeklyImpact}</Text>
                    <Text style={[styles.metricLabel, { color: c.textMuted }]}>Prayers this week</Text>
                  </View>
                </View>
                <Text style={[styles.liveMeta, { color: c.textMuted }]}>
                  Live presence across {activeGlobalEvents} event{activeGlobalEvents === 1 ? "" : "s"} (last 90 seconds).
                </Text>

                <View style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <Text style={[styles.sectionTitle, { color: c.text }]}>{ui.communityFeed}</Text>
                  {!showCommunityFeed ? (
                    <Text style={[styles.sectionMeta, { color: c.textMuted }]}>
                      Community feed is hidden by your privacy preference. You can re-enable it in Profile.
                    </Text>
                  ) : (
                    <>
                      <Text style={[styles.sectionMeta, { color: c.textMuted }]}>
                        Recent shared intentions from live circles and anonymous journal shares.
                      </Text>
                      {feedItems.length === 0 ? (
                        <Text style={[styles.sectionMeta, { color: c.textMuted, marginTop: 8 }]}>{ui.noShares}</Text>
                      ) : (
                        <View style={{ gap: 8, marginTop: 8 }}>
                          {visibleFeedItems.map((item) => {
                            const canOpenEvent = item.source === "chat" && !!item.eventId && isLikelyUuid(item.eventId);
                            const metaPrefix =
                              item.source === "journal"
                                ? `${item.displayName} in ${item.eventTitle} (anonymous)`
                                : `${item.displayName} in ${item.eventTitle}`;

                            if (!canOpenEvent) {
                              return (
                                <View
                                  key={item.id}
                                  style={[styles.feedCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}
                                >
                                  <Text style={[styles.feedMeta, { color: c.textMuted }]}>
                                    {metaPrefix} -{" "}
                                    {item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : "now"}
                                  </Text>
                                  <Text style={[styles.feedBody, { color: c.text }]}>{truncate(item.body, 160)}</Text>
                                </View>
                              );
                            }

                            return (
                              <Pressable
                                key={item.id}
                                style={[styles.feedCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}
                                onPress={() => openEventRoom(item.eventId!)}
                              >
                                <Text style={[styles.feedMeta, { color: c.textMuted }]}>
                                  {metaPrefix} -{" "}
                                  {item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : "now"}
                                </Text>
                                <Text style={[styles.feedBody, { color: c.text }]}>{truncate(item.body, 160)}</Text>
                              </Pressable>
                            );
                          })}
                          {feedItems.length > 2 ? (
                            <Pressable
                              onPress={() => setShowFullFeed((v) => !v)}
                              style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                            >
                              <Text style={[styles.secondaryBtnText, { color: c.text }]}>
                                {showFullFeed ? "Show less" : `Show ${feedItems.length - 2} more`}
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      )}
                    </>
                  )}
                </View>
              </>
            ) : null}

            <View style={[styles.sectionCard, { backgroundColor: c.chip, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.chipText }]}>Recommended Events</Text>
              <Text style={[styles.sectionMeta, { color: c.textMuted }]}>Tap any event below to enter the live room in sync.</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={{ color: c.textMuted }}>No events available yet.</Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      />

      <Modal visible={soloOpen} animationType="slide" transparent onRequestClose={closeSoloModal}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <ScrollView
              ref={soloModalScrollRef}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              <Text style={[styles.modalTitle, { color: c.text }]}>Solo Guided Prayer</Text>
              <Text style={[styles.modalMeta, { color: c.textMuted }]}>
                {soloDurationMin}-minute rhythm. Keep breathing steady and stay with one intention.
              </Text>

              <View style={styles.row}>
                {([3, 5, 10] as SoloDurationMin[]).map((minutes) => {
                  const on = soloDurationMin === minutes;
                  return (
                    <Pressable
                      key={`dur-${minutes}`}
                      onPress={() => {
                        stopSoloVoice();
                        setSoloRunning(false);
                        setSoloDurationMin(minutes);
                        setSoloSecondsLeft(minutes * 60);
                      }}
                      style={[
                        styles.ambientChip,
                        { borderColor: c.border, backgroundColor: c.cardAlt },
                        on && { borderColor: c.primary, backgroundColor: c.card },
                      ]}
                    >
                      <Text style={[styles.ambientChipText, { color: c.text }]}>{minutes} min</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.row}>
                {(["Silence", "Rain", "Singing Bowls", "Binaural"] as AmbientPreset[]).map((preset) => {
                  const on = ambientPreset === preset;
                  return (
                    <Pressable
                      key={preset}
                      onPress={() => setAmbientPreset(preset)}
                      style={[
                        styles.ambientChip,
                        { borderColor: c.border, backgroundColor: c.cardAlt },
                        on && { borderColor: c.primary, backgroundColor: c.card },
                      ]}
                    >
                      <Text style={[styles.ambientChipText, { color: c.text }]}>{preset}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.row}>
                {(["Calm", "Deep"] as BreathMode[]).map((mode) => {
                  const on = breathMode === mode;
                  return (
                    <Pressable
                      key={mode}
                      onPress={() => setBreathMode(mode)}
                      style={[
                        styles.ambientChip,
                        { borderColor: c.border, backgroundColor: c.cardAlt },
                        on && { borderColor: c.primary, backgroundColor: c.card },
                      ]}
                    >
                      <Text style={[styles.ambientChipText, { color: c.text }]}>{mode} breath</Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                value={soloIntent}
                onChangeText={(next) => {
                  setSoloIntent(next);
                  setSoloAiLines(null);
                }}
                placeholder="What intention are you holding right now?"
                placeholderTextColor={c.textMuted}
                style={[styles.modalInput, { color: c.text, borderColor: c.border, backgroundColor: c.cardAlt }]}
                multiline
              />

              <View style={[styles.timerChip, { borderColor: c.primary, backgroundColor: c.cardAlt }]}>
                <Text style={[styles.timerValue, { color: c.text }]}>{formatClock(soloSecondsLeft)}</Text>
              </View>
              <Text style={[styles.modalMeta, { color: c.textMuted }]}>
                {soloRunning ? `${breathGuide.phase} for ${breathGuide.secondsRemaining}s` : "Press Start to begin guided breathing"} - Ambient: {ambientPreset}
              </Text>
              <Text style={[styles.modalMeta, { color: c.textMuted, marginTop: -6 }]}>
                Voice mode:{" "}
                {voiceModeEnabled
                  ? voiceAvailable === false
                    ? "Enabled, but speech module missing"
                    : voicePlaying
                      ? "Speaking now"
                      : "Ready"
                  : "Off (enable in Profile)"}
              </Text>

              <View style={{ gap: 6, marginTop: 10 }}>
                {soloLines.map((line, idx) => (
                  <Text
                    key={`${idx}-${line}`}
                    onLayout={(e) => registerSoloLineLayout(idx, e)}
                    style={[
                      styles.modalLine,
                      { color: c.text },
                      idx === soloActiveLineIdx && [styles.modalLineActive, { borderColor: c.primary, backgroundColor: c.cardAlt }],
                    ]}
                  >
                    {idx + 1}. {line}
                  </Text>
                ))}
              </View>

              <View style={styles.row}>
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: c.primary }]}
                  onPress={() => {
                    if (!soloRunning && soloSecondsLeft <= 0) {
                      setSoloSecondsLeft(selectedDurationSeconds);
                    }
                    setSoloRunning((v) => !v);
                  }}
                >
                  <Text style={[styles.primaryBtnText, { color: "#FFFFFF" }]}>
                    {soloRunning ? "Pause" : "Start"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                  onPress={() => {
                    stopSoloVoice();
                    setSoloRunning(false);
                    setSoloSecondsLeft(selectedDurationSeconds);
                  }}
                >
                  <Text style={[styles.secondaryBtnText, { color: c.text }]}>Reset</Text>
                </Pressable>
              </View>
              <View style={styles.row}>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    { borderColor: c.border, backgroundColor: c.cardAlt },
                    !voiceModeEnabled && { opacity: 0.6 },
                  ]}
                  onPress={playSoloVoice}
                  disabled={!voiceModeEnabled}
                >
                  <Text style={[styles.secondaryBtnText, { color: c.text }]}>{voicePlaying ? "Replay voice" : "Play voice"}</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    { borderColor: c.border, backgroundColor: c.cardAlt },
                    !voicePlaying && { opacity: 0.6 },
                  ]}
                  onPress={stopSoloVoice}
                  disabled={!voicePlaying}
                >
                  <Text style={[styles.secondaryBtnText, { color: c.text }]}>Stop voice</Text>
                </Pressable>
              </View>

              <Pressable
                style={[
                  styles.secondaryBtn,
                  { borderColor: c.border, backgroundColor: c.cardAlt, marginTop: 10 },
                  soloGeneratingAi && { opacity: 0.5 },
                ]}
                onPress={handleGenerateSoloAi}
                disabled={soloGeneratingAi}
              >
                <Text style={[styles.secondaryBtnText, { color: c.text }]}>
                  {soloGeneratingAi ? "Generating..." : "Generate AI guidance"}
                </Text>
              </Pressable>
              <Text style={[styles.modalMeta, { color: c.textMuted }]}>
                {isCircleMember
                  ? "Egregor Circle: unlimited AI solo guidance."
                  : `Free AI solo guidance today: ${soloAiQuota?.usedToday ?? 0}/${soloAiQuota?.limit ?? 2}`}
              </Text>

              <Pressable
                style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.cardAlt, marginTop: 10 }]}
                onPress={closeSoloModal}
              >
                <Text style={[styles.secondaryBtnText, { color: c.text }]}>Close</Text>
              </Pressable>
              <Text style={[styles.modalMeta, { color: c.textMuted }]}>
                Solo this week: {soloSessionsWeek} sessions ({soloMinutesWeek} min)
              </Text>
              <Text style={[styles.modalMeta, { color: c.textMuted }]}>
                Last completed: {lastSoloAt ? new Date(lastSoloAt).toLocaleString() : "No completed session yet"}
              </Text>
              {soloRecent.length > 0 ? (
                <View style={{ gap: 6, marginTop: 4 }}>
                  <Text style={[styles.modalMeta, { color: c.textMuted, marginBottom: 0 }]}>Recent sessions</Text>
                  {soloRecent.map((entry) => (
                    <Text key={entry.id} style={[styles.modalLine, { color: c.textMuted }]}>
                      {new Date(entry.completedAt).toLocaleString()} - {entry.minutes} min - {entry.ambientPreset} /{" "}
                      {entry.breathMode}
                    </Text>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  glow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 999,
    opacity: 0.32,
  },
  content: {
    padding: 16,
    gap: 10,
  },
  kicker: { fontSize: 11, letterSpacing: 2, fontWeight: "800" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  notifyBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  notifyBtnText: { fontSize: 11, fontWeight: "800" },
  hero: { fontSize: 30, fontWeight: "900", lineHeight: 36 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 6 },
  dayPhasePill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 2,
  },
  dayPhaseText: { fontSize: 11, fontWeight: "800" },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  primaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontWeight: "900" },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontWeight: "900" },
  metricsRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: { fontSize: 22, fontWeight: "900" },
  metricLabel: { fontSize: 12, fontWeight: "700" },
  liveMeta: { fontSize: 12, marginTop: 4 },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  sectionMeta: { fontSize: 12, marginTop: 4 },
  viewToggleBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  viewToggleText: {
    fontSize: 12,
    fontWeight: "800",
  },
  feedCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  feedMeta: { fontSize: 11 },
  feedBody: { fontSize: 13, lineHeight: 19 },
  eventCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  eventTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  eventTitle: { fontSize: 16, fontWeight: "800", marginBottom: 4 },
  eventBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  eventBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  eventMeta: { fontSize: 12, lineHeight: 17 },
  empty: {
    paddingVertical: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(4, 7, 15, 0.7)",
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 16,
    paddingBottom: 28,
    maxHeight: "92%",
  },
  modalScrollContent: { paddingBottom: 12 },
  modalTitle: { fontSize: 22, fontWeight: "900" },
  modalMeta: { fontSize: 12, marginTop: 4, marginBottom: 10 },
  modalInput: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  timerChip: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 999,
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  timerValue: { fontSize: 22, fontWeight: "900" },
  modalLine: { fontSize: 13, lineHeight: 19 },
  modalLineActive: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ambientChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  ambientChipText: { fontSize: 11, fontWeight: "800" },
});

