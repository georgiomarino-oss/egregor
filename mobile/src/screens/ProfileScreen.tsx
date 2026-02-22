// mobile/src/screens/ProfileScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { supabase } from "../supabase/client";
import { useAppState } from "../state";
import { getScreenColors } from "../theme/appearance";
import type { RootStackParamList } from "../types";
import type { Database } from "../types/db";
import { logMonetizationEvent } from "../features/billing/billingAnalyticsRepo";
import { getSoloHistoryStats, listSoloHistory, type SoloHistoryEntry } from "../features/solo/soloHistoryRepo";

const KEY_AUTO_JOIN_GLOBAL = "prefs:autoJoinLive";
const KEY_JOURNAL = "journal:entries";
const KEY_PROFILE_PREFS = "profile:prefs:v1";
const KEY_SUPPORT_TOTAL = "support:total:v1";
const KEY_DAILY_INTENTION = "onboarding:intention:v1";
const KEY_CIRCLE_WAITLIST = "circle:waitlist:v1";
const KEY_MY_CIRCLES = "social:circles:v1";
type JournalVisibility = "private" | "shared_anonymous";
type JournalEntry = { id: string; createdAt: string; text: string; visibility: JournalVisibility };
type JournalDbRow = {
  id: string | null;
  created_at: string | null;
  body: string | null;
  visibility: string | null;
};
type CircleWaitlistEntry = { id: string; createdAt: string; email: string; note: string };
type SocialCircle = { id: string; name: string; intention: string; createdAt: string };
type RhythmDay = { label: string; value: number };
type ProfileLiveStatsRow = {
  streak_days: number | null;
  active_days_30: number | null;
  intention_energy: number | null;
  rhythm_sun: number | null;
  rhythm_mon: number | null;
  rhythm_tue: number | null;
  rhythm_wed: number | null;
  rhythm_thu: number | null;
  rhythm_fri: number | null;
  rhythm_sat: number | null;
  live_events_now: number | null;
  active_participants_now: number | null;
  prayers_week: number | null;
  shared_intentions_week: number | null;
};
const PROFILE_LANGUAGES = ["English", "Spanish", "Portuguese", "French"] as const;
type ProfileLanguage = (typeof PROFILE_LANGUAGES)[number];

function normalizeProfileLanguage(value: string): ProfileLanguage {
  const raw = value.trim().toLowerCase();
  if (raw.startsWith("span")) return "Spanish";
  if (raw.startsWith("port")) return "Portuguese";
  if (raw.startsWith("fren")) return "French";
  return "English";
}

function normalizeJournalVisibility(value: unknown): JournalVisibility {
  return String(value ?? "").trim().toLowerCase() === "shared_anonymous"
    ? "shared_anonymous"
    : "private";
}

type ProfilePrefs = {
  notifyLiveStart: boolean;
  notifyNewsEvents: boolean;
  notifyFriendInvites: boolean;
  notifyStreakReminders: boolean;
  showCommunityFeed: boolean;
  voiceMode: boolean;
  highContrast: boolean;
  language: ProfileLanguage;
};
type UserNotificationPrefsRow = Database["public"]["Tables"]["user_notification_prefs"]["Row"];
type UserNotificationPrefsInsert = Database["public"]["Tables"]["user_notification_prefs"]["Insert"];
const DEFAULT_PROFILE_PREFS: ProfilePrefs = {
  notifyLiveStart: true,
  notifyNewsEvents: true,
  notifyFriendInvites: true,
  notifyStreakReminders: true,
  showCommunityFeed: true,
  voiceMode: false,
  highContrast: false,
  language: "English",
};

function normalizeProfilePrefs(raw: unknown): ProfilePrefs {
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    notifyLiveStart: parsed.notifyLiveStart !== false,
    notifyNewsEvents: parsed.notifyNewsEvents !== false,
    notifyFriendInvites: parsed.notifyFriendInvites !== false,
    notifyStreakReminders: parsed.notifyStreakReminders !== false,
    showCommunityFeed: parsed.showCommunityFeed !== false,
    voiceMode: !!parsed.voiceMode,
    highContrast: !!parsed.highContrast,
    language: normalizeProfileLanguage(String(parsed.language ?? DEFAULT_PROFILE_PREFS.language)),
  };
}

function withServerNotificationPrefs(base: ProfilePrefs, row: Partial<UserNotificationPrefsRow>): ProfilePrefs {
  return {
    ...base,
    notifyLiveStart: row.notify_live_start !== false,
    notifyNewsEvents: row.notify_news_events !== false,
    notifyFriendInvites: row.notify_friend_invites !== false,
    notifyStreakReminders: row.notify_streak_reminders !== false,
    showCommunityFeed: row.show_community_feed !== false,
  };
}

function toServerNotificationPrefs(userId: string, prefs: ProfilePrefs): UserNotificationPrefsInsert {
  return {
    user_id: userId,
    notify_live_start: prefs.notifyLiveStart,
    notify_news_events: prefs.notifyNewsEvents,
    notify_friend_invites: prefs.notifyFriendInvites,
    notify_streak_reminders: prefs.notifyStreakReminders,
    show_community_feed: prefs.showCommunityFeed,
  };
}

type CollectiveImpact = {
  liveEventsNow: number;
  activeParticipantsNow: number;
  prayersWeek: number;
  sharedIntentionsWeek: number;
};

const DEFAULT_COLLECTIVE_IMPACT: CollectiveImpact = {
  liveEventsNow: 0,
  activeParticipantsNow: 0,
  prayersWeek: 0,
  sharedIntentionsWeek: 0,
};
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const PROFILE_STATS_RESYNC_MS = 30_000;

function emptyRhythmDays(): RhythmDay[] {
  return WEEKDAY_LABELS.map((label) => ({ label, value: 0 }));
}

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function safeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function compactProfileTabLabel(value: string, max = 11) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return "Profile";
  const first = cleaned.split(" ")[0] ?? cleaned;
  if (first.length <= max) return first;
  return `${first.slice(0, Math.max(3, max - 1))}.`;
}

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const {
    theme,
    highContrast,
    setTheme,
    setHighContrast,
    billingReady,
    billingAvailable,
    billingError,
    isCircleMember,
    circleExpiresAt,
    circlePackages,
    refreshBilling,
    purchaseCircle,
    restoreCircle,
    signOut,
  } = useAppState();
  const c = useMemo(() => getScreenColors(theme, highContrast, "profile"), [theme, highContrast]);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [billingActionBusy, setBillingActionBusy] = useState(false);

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");

  const [displayName, setDisplayName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const [streakDays, setStreakDays] = useState(0);
  const [activeDays30, setActiveDays30] = useState(0);
  const [intentionEnergy, setIntentionEnergy] = useState(0);
  const [journalText, setJournalText] = useState("");
  const [journalShareAnonymously, setJournalShareAnonymously] = useState(false);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [prefs, setPrefs] = useState<ProfilePrefs>(DEFAULT_PROFILE_PREFS);
  const [collectiveImpact, setCollectiveImpact] = useState<CollectiveImpact>(DEFAULT_COLLECTIVE_IMPACT);
  const [supportTotalUsd, setSupportTotalUsd] = useState(0);
  const [dailyIntention, setDailyIntention] = useState("peace and clarity");
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistNote, setWaitlistNote] = useState("");
  const [savingWaitlist, setSavingWaitlist] = useState(false);
  const [circles, setCircles] = useState<SocialCircle[]>([]);
  const [circleName, setCircleName] = useState("");
  const [circleIntention, setCircleIntention] = useState("Weekly peace and gratitude.");
  const [soloSessionsWeek, setSoloSessionsWeek] = useState(0);
  const [soloMinutesWeek, setSoloMinutesWeek] = useState(0);
  const [soloRecent, setSoloRecent] = useState<SoloHistoryEntry[]>([]);
  const [rhythmByDay, setRhythmByDay] = useState<RhythmDay[]>(emptyRhythmDays());
  const [showInsights, setShowInsights] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const statsRefreshInFlightRef = useRef(false);
  const statsRefreshQueuedRef = useRef(false);
  const paywallViewSignatureRef = useRef("");

  const loadJournal = useCallback(async () => {
    const resolveUserId = async () => {
      if (userId) return userId;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.id ?? "";
    };

    const uid = await resolveUserId();
    if (uid) {
      const { data, error } = await supabase
        .from("manifestation_journal_entries")
        .select("id,created_at,body,visibility")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(200);

      if (!error) {
        const rows = ((data ?? []) as JournalDbRow[])
          .map((r) => ({
            id: String(r.id ?? ""),
            createdAt: String(r.created_at ?? ""),
            text: String(r.body ?? ""),
            visibility: normalizeJournalVisibility(r.visibility),
          }))
          .filter((r: JournalEntry) => !!r.id && !!r.text.trim());
        setJournalEntries(rows);
        try {
          await AsyncStorage.setItem(KEY_JOURNAL, JSON.stringify(rows));
        } catch {
          // ignore local cache write errors
        }
        return;
      }
    }

    try {
      const raw = await AsyncStorage.getItem(KEY_JOURNAL);
      if (!raw) {
        setJournalEntries([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setJournalEntries([]);
        return;
      }
      const rows = parsed
        .map((r: any) => ({
          id: String(r?.id ?? ""),
          createdAt: String(r?.createdAt ?? ""),
          text: String(r?.text ?? ""),
          visibility: normalizeJournalVisibility(r?.visibility),
        }))
        .filter((r: JournalEntry) => !!r.id && !!r.text.trim());
      rows.sort((a: JournalEntry, b: JournalEntry) => safeTimeMs(b.createdAt) - safeTimeMs(a.createdAt));
      setJournalEntries(rows);
    } catch {
      setJournalEntries([]);
    }
  }, [userId]);

  const saveJournalLocal = useCallback(async (entries: JournalEntry[]) => {
    await AsyncStorage.setItem(KEY_JOURNAL, JSON.stringify(entries));
  }, []);

  const loadPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY_PROFILE_PREFS);
      const localPrefs = normalizeProfilePrefs(raw ? JSON.parse(raw) : null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = String(user?.id ?? "").trim();
      if (!uid) {
        setPrefs(localPrefs);
        void setHighContrast(localPrefs.highContrast);
        return;
      }

      const { data: serverRow, error: serverErr } = await supabase
        .from("user_notification_prefs")
        .select(
          "notify_live_start,notify_news_events,notify_friend_invites,notify_streak_reminders,show_community_feed"
        )
        .eq("user_id", uid)
        .maybeSingle();

      if (serverErr) {
        setPrefs(localPrefs);
        void setHighContrast(localPrefs.highContrast);
        return;
      }

      if (serverRow) {
        const mergedPrefs = withServerNotificationPrefs(
          localPrefs,
          serverRow as Partial<UserNotificationPrefsRow>
        );
        setPrefs(mergedPrefs);
        void setHighContrast(mergedPrefs.highContrast);
        try {
          await AsyncStorage.setItem(KEY_PROFILE_PREFS, JSON.stringify(mergedPrefs));
        } catch {
          // ignore local cache write errors
        }
        return;
      }

      await supabase.from("user_notification_prefs").upsert(
        toServerNotificationPrefs(uid, localPrefs),
        { onConflict: "user_id" }
      );
      setPrefs(localPrefs);
      void setHighContrast(localPrefs.highContrast);
    } catch {
      setPrefs(DEFAULT_PROFILE_PREFS);
      void setHighContrast(DEFAULT_PROFILE_PREFS.highContrast);
    }
  }, [setHighContrast]);

  const loadSupportTotal = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY_SUPPORT_TOTAL);
      const parsed = Number(raw ?? 0);
      setSupportTotalUsd(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    } catch {
      setSupportTotalUsd(0);
    }
  }, []);

  const loadDailyIntention = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY_DAILY_INTENTION);
      setDailyIntention(raw?.trim() ? raw.trim() : "peace and clarity");
    } catch {
      setDailyIntention("peace and clarity");
    }
  }, []);

  const loadWaitlistDraft = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY_CIRCLE_WAITLIST);
      if (!raw) {
        setWaitlistEmail(email.trim());
        setWaitlistNote("");
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setWaitlistEmail(email.trim());
        setWaitlistNote("");
        return;
      }
      const latest = parsed[0] as Partial<CircleWaitlistEntry>;
      setWaitlistEmail(String(latest?.email ?? email).trim());
      setWaitlistNote(String(latest?.note ?? "").trim());
    } catch {
      setWaitlistEmail(email.trim());
      setWaitlistNote("");
    }
  }, [email]);

  const loadCircles = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY_MY_CIRCLES);
      if (!raw) {
        setCircles([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setCircles([]);
        return;
      }
      const rows = parsed
        .map((r: any) => ({
          id: String(r?.id ?? ""),
          name: String(r?.name ?? "").trim(),
          intention: String(r?.intention ?? "").trim(),
          createdAt: String(r?.createdAt ?? ""),
        }))
        .filter((r: SocialCircle) => !!r.id && !!r.name);
      rows.sort((a: SocialCircle, b: SocialCircle) => safeTimeMs(b.createdAt) - safeTimeMs(a.createdAt));
      setCircles(rows);
    } catch {
      setCircles([]);
    }
  }, []);

  const loadSoloPractice = useCallback(async () => {
    try {
      const [stats, recent] = await Promise.all([getSoloHistoryStats(7), listSoloHistory()]);
      setSoloSessionsWeek(stats.sessionCount);
      setSoloMinutesWeek(stats.totalMinutes);
      setSoloRecent(recent.slice(0, 5));
    } catch {
      setSoloSessionsWeek(0);
      setSoloMinutesWeek(0);
      setSoloRecent([]);
    }
  }, []);

  const refreshLiveProfileStats = useCallback(
    async (targetUserId?: string) => {
      const resolveUserId = async () => {
        if (targetUserId) return targetUserId;
        if (userId) return userId;
        const {
          data: { user },
        } = await supabase.auth.getUser();
        return user?.id ?? "";
      };

      const uid = await resolveUserId();
      if (!uid) {
        setStreakDays(0);
        setActiveDays30(0);
        setIntentionEnergy(0);
        setCollectiveImpact(DEFAULT_COLLECTIVE_IMPACT);
        setRhythmByDay(emptyRhythmDays());
        return;
      }

      if (statsRefreshInFlightRef.current) {
        statsRefreshQueuedRef.current = true;
        return;
      }

      statsRefreshInFlightRef.current = true;
      try {
        const { data, error } = await supabase.rpc("get_profile_live_stats", { p_user_id: uid });
        if (error) throw error;

        const row = Array.isArray(data)
          ? ((data[0] as ProfileLiveStatsRow | undefined) ?? null)
          : ((data as ProfileLiveStatsRow | null) ?? null);

        setStreakDays(safeCount(row?.streak_days));
        setActiveDays30(safeCount(row?.active_days_30));
        setIntentionEnergy(safeCount(row?.intention_energy));
        setRhythmByDay([
          { label: "Sun", value: safeCount(row?.rhythm_sun) },
          { label: "Mon", value: safeCount(row?.rhythm_mon) },
          { label: "Tue", value: safeCount(row?.rhythm_tue) },
          { label: "Wed", value: safeCount(row?.rhythm_wed) },
          { label: "Thu", value: safeCount(row?.rhythm_thu) },
          { label: "Fri", value: safeCount(row?.rhythm_fri) },
          { label: "Sat", value: safeCount(row?.rhythm_sat) },
        ]);
        setCollectiveImpact({
          liveEventsNow: safeCount(row?.live_events_now),
          activeParticipantsNow: safeCount(row?.active_participants_now),
          prayersWeek: safeCount(row?.prayers_week),
          sharedIntentionsWeek: safeCount(row?.shared_intentions_week),
        });
      } catch {
        // keep previous values on refresh failure
      } finally {
        statsRefreshInFlightRef.current = false;
        if (statsRefreshQueuedRef.current) {
          statsRefreshQueuedRef.current = false;
          void refreshLiveProfileStats(uid);
        }
      }
    },
    [userId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        setUserId("");
        setEmail("");
        setDisplayName("");
        setAvatarUrl("");
        setFirstName("");
        setLastName("");
        setStreakDays(0);
        setActiveDays30(0);
        setIntentionEnergy(0);
        setCollectiveImpact(DEFAULT_COLLECTIVE_IMPACT);
        return;
      }

      setUserId(user.id);
      setEmail(user.email ?? "");

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("display_name,avatar_url,first_name,last_name")
        .eq("id", user.id)
        .maybeSingle();

      if (!profErr && prof) {
        setDisplayName(String((prof as any).display_name ?? ""));
        setAvatarUrl(String((prof as any).avatar_url ?? ""));
        setFirstName(String((prof as any).first_name ?? ""));
        setLastName(String((prof as any).last_name ?? ""));
      } else if (profErr) {
        const { data: fallbackProf, error: fallbackError } = await supabase
          .from("profiles")
          .select("display_name,avatar_url")
          .eq("id", user.id)
          .maybeSingle();
        if (!fallbackError && fallbackProf) {
          setDisplayName(String((fallbackProf as any).display_name ?? ""));
          setAvatarUrl(String((fallbackProf as any).avatar_url ?? ""));
          setFirstName("");
          setLastName("");
        } else {
          setDisplayName("");
          setAvatarUrl("");
          setFirstName("");
          setLastName("");
        }
      } else {
        setDisplayName("");
        setAvatarUrl("");
        setFirstName("");
        setLastName("");
      }

      await refreshLiveProfileStats(user.id);
    } finally {
      setLoading(false);
    }
  }, [refreshLiveProfileStats]);

  useEffect(() => {
    load();
    void loadJournal();
    void loadPrefs();
    void loadSupportTotal();
    void loadDailyIntention();
    void loadWaitlistDraft();
    void loadCircles();
    void loadSoloPractice();
  }, [load, loadJournal, loadPrefs, loadSupportTotal, loadDailyIntention, loadWaitlistDraft, loadCircles, loadSoloPractice]);

  useFocusEffect(
    useCallback(() => {
      let disposed = false;
      let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

      const refresh = () => {
        if (disposed) return;
        void refreshLiveProfileStats();
      };

      const scheduleRefresh = () => {
        if (disposed || refreshTimeout) return;
        refreshTimeout = setTimeout(() => {
          refreshTimeout = null;
          refresh();
        }, 1200);
      };

      refresh();
      const intervalId = setInterval(refresh, PROFILE_STATS_RESYNC_MS);
      const realtime = supabase
        .channel(`profile:live:${userId || "anon"}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "event_presence" },
          scheduleRefresh
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "events" },
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
        clearInterval(intervalId);
        if (refreshTimeout) clearTimeout(refreshTimeout);
        supabase.removeChannel(realtime);
      };
    }, [refreshLiveProfileStats, userId])
  );

  useFocusEffect(
    useCallback(() => {
      if (!userId || !billingReady || isCircleMember) return;

      const today = new Date().toISOString().slice(0, 10);
      const signature = `${userId}:${today}:${billingAvailable ? "available" : "unavailable"}:${circlePackages.length}`;
      if (paywallViewSignatureRef.current === signature) return;
      paywallViewSignatureRef.current = signature;

      void logMonetizationEvent({
        userId,
        eventName: "circle_paywall_view",
        stage: "info",
        isCircleMember,
        metadata: {
          screen: "Profile",
          billingAvailable,
          packageCount: circlePackages.length,
        },
      });
    }, [billingAvailable, billingReady, circlePackages.length, isCircleMember, userId])
  );

  useEffect(() => {
    if (!waitlistEmail.trim() && email.trim()) {
      setWaitlistEmail(email.trim());
    }
  }, [email, waitlistEmail]);

  const initials = useMemo(() => {
    const first = firstName.trim();
    const last = lastName.trim();
    if (first || last) {
      const a = first[0] ?? "?";
      const b = last[0] ?? "";
      return (a + b).toUpperCase();
    }
    const name = (displayName || email || "").trim();
    if (!name) return "?";
    const parts = name.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "?";
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (a + b).toUpperCase();
  }, [displayName, email, firstName, lastName]);
  const fullName = useMemo(() => {
    const fromNames = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ").trim();
    if (fromNames) return fromNames;
    const fromDisplayName = displayName.trim();
    if (fromDisplayName) return fromDisplayName;
    return "Unnamed user";
  }, [displayName, firstName, lastName]);
  const profileTabLabel = useMemo(() => {
    const first = firstName.trim();
    if (first) return compactProfileTabLabel(first);

    const display = displayName.trim();
    if (display) return compactProfileTabLabel(display);

    const emailLocal = String(email ?? "").trim().split("@")[0] ?? "";
    if (emailLocal.trim()) return compactProfileTabLabel(emailLocal);

    return "Profile";
  }, [displayName, email, firstName]);

  useEffect(() => {
    navigation.setOptions?.({
      title: profileTabLabel,
      tabBarLabel: profileTabLabel,
    });
  }, [navigation, profileTabLabel]);

  const clearAutoJoinPrefs = useCallback(async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const toRemove = keys.filter((k) => k === KEY_AUTO_JOIN_GLOBAL || k.startsWith("joined:event:"));
      if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
      Alert.alert("Cleared", "Auto-join preferences have been reset.");
    } catch (e: any) {
      Alert.alert("Failed", e?.message ?? "Could not clear preferences.");
    }
  }, []);

  const handleSaveProfile = useCallback(async () => {
    if (!userId) {
      Alert.alert("Not signed in", "Sign in again and retry.");
      return;
    }

    const nextFirstName = firstName.trim();
    const nextLastName = lastName.trim();
    if (nextFirstName.length > 60) {
      Alert.alert("Validation", "First name must be 60 characters or fewer.");
      return;
    }
    if (nextLastName.length > 60) {
      Alert.alert("Validation", "Last name must be 60 characters or fewer.");
      return;
    }

    const nextDisplayName = displayName.trim();
    if (nextDisplayName.length > 80) {
      Alert.alert("Validation", "Display name must be 80 characters or fewer.");
      return;
    }

    const nextAvatarUrl = avatarUrl.trim();
    if (nextAvatarUrl) {
      let validUrl = false;
      try {
        const parsed = new URL(nextAvatarUrl);
        validUrl = parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        validUrl = false;
      }
      if (!validUrl) {
        Alert.alert("Validation", "Avatar URL must be a valid http(s) URL.");
        return;
      }
    }

    setSavingProfile(true);
    try {
      const fallbackDisplayName = [nextFirstName, nextLastName].filter(Boolean).join(" ").trim();
      const payload = {
        id: userId,
        first_name: nextFirstName || null,
        last_name: nextLastName || null,
        display_name: nextDisplayName || fallbackDisplayName || null,
        avatar_url: nextAvatarUrl || null,
      };

      let { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
      if (error) {
        const schemaMissingNameColumns =
          String(error.message ?? "").toLowerCase().includes("first_name") ||
          String(error.message ?? "").toLowerCase().includes("last_name");
        if (schemaMissingNameColumns) {
          const legacyPayload = {
            id: userId,
            display_name: nextDisplayName || fallbackDisplayName || null,
            avatar_url: nextAvatarUrl || null,
          };
          const legacyResult = await supabase
            .from("profiles")
            .upsert(legacyPayload, { onConflict: "id" });
          error = legacyResult.error;
        }
      }
      if (error) {
        Alert.alert("Save failed", error.message);
        return;
      }

      Alert.alert("Saved", "Profile updated.");
      await load();
    } finally {
      setSavingProfile(false);
    }
  }, [avatarUrl, displayName, firstName, lastName, load, userId]);

  const handleSignOut = useCallback(async () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
          } catch (e: any) {
            Alert.alert("Sign out failed", e?.message ?? "Please try again.");
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }, [signOut]);

  const runDeleteAccount = useCallback(async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = String(session?.access_token ?? "").trim();
      if (!accessToken) {
        throw new Error("Session expired. Please sign in again and retry.");
      }

      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: { accessToken },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (error) {
        let details = error.message || "Could not delete account.";
        try {
          const context = (error as any)?.context;
          const payload = context ? await context.json() : null;
          const fromPayload = String(payload?.error ?? "").trim();
          if (fromPayload) details = fromPayload;
        } catch {
          // keep generic message
        }
        throw new Error(details);
      }

      const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
      if (payload.ok !== true) {
        throw new Error(String(payload.error ?? "Could not delete account."));
      }

      try {
        const keys = await AsyncStorage.getAllKeys();
        const removable = keys.filter(
          (k) =>
            k === KEY_AUTO_JOIN_GLOBAL ||
            k.startsWith("joined:event:") ||
            k === KEY_PROFILE_PREFS ||
            k === KEY_JOURNAL ||
            k === KEY_SUPPORT_TOTAL ||
            k === KEY_DAILY_INTENTION ||
            k === KEY_CIRCLE_WAITLIST ||
            k === KEY_MY_CIRCLES
        );
        if (removable.length > 0) await AsyncStorage.multiRemove(removable);
      } catch {
        // best effort local cleanup
      }

      try {
        await signOut();
      } catch {
        const { error: fallbackSignOutError } = await supabase.auth.signOut();
        if (fallbackSignOutError) {
          throw new Error(fallbackSignOutError.message || "Account removed but sign out failed.");
        }
      }

      Alert.alert(
        "Account deleted",
        "Your account and associated data have been permanently deleted."
      );
    } catch (e: any) {
      Alert.alert("Delete account failed", e?.message ?? "Please try again.");
    } finally {
      setDeletingAccount(false);
    }
  }, [deletingAccount, signOut]);

  const handleDeleteAccount = useCallback(() => {
    if (deletingAccount) return;
    Alert.alert(
      "Delete account",
      "This permanently deletes your account and associated data. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Final confirmation",
              "Are you sure you want to permanently delete your account?",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete account",
                  style: "destructive",
                  onPress: () => {
                    void runDeleteAccount();
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [deletingAccount, runDeleteAccount]);

  const addJournalEntry = useCallback(async () => {
    const text = journalText.trim();
    if (!text) return;
    if (text.length > 600) {
      Alert.alert("Validation", "Journal entry must be 600 characters or fewer.");
      return;
    }
    const visibility: JournalVisibility = journalShareAnonymously ? "shared_anonymous" : "private";

    if (userId) {
      setJournalText("");
      const { error } = await supabase.from("manifestation_journal_entries").insert({
        user_id: userId,
        body: text,
        visibility,
      });
      if (error) {
        setJournalText(text);
        Alert.alert("Save failed", error.message);
        return;
      }
      setJournalShareAnonymously(false);
      await loadJournal();
      return;
    }

    const next: JournalEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      text,
      visibility,
    };
    const entries = [next, ...journalEntries].slice(0, 200);
    setJournalEntries(entries);
    setJournalText("");
    setJournalShareAnonymously(false);
    try {
      await saveJournalLocal(entries);
    } catch {
      Alert.alert("Save failed", "Could not save journal entry.");
    }
  }, [
    journalEntries,
    journalShareAnonymously,
    journalText,
    loadJournal,
    saveJournalLocal,
    userId,
  ]);

  const deleteJournalEntry = useCallback(async (entryId: string) => {
    if (userId) {
      const previous = journalEntries;
      const next = previous.filter((e) => e.id !== entryId);
      setJournalEntries(next);
      const { error } = await supabase
        .from("manifestation_journal_entries")
        .delete()
        .eq("id", entryId)
        .eq("user_id", userId);
      if (error) {
        setJournalEntries(previous);
        Alert.alert("Delete failed", error.message);
        return;
      }
      try {
        await AsyncStorage.setItem(KEY_JOURNAL, JSON.stringify(next));
      } catch {
        // ignore local cache write errors
      }
      return;
    }

    const next = journalEntries.filter((e) => e.id !== entryId);
    setJournalEntries(next);
    try {
      await saveJournalLocal(next);
    } catch {
      Alert.alert("Delete failed", "Could not update journal storage.");
    }
  }, [journalEntries, saveJournalLocal, userId]);

  const handleSavePrefs = useCallback(async () => {
    setSavingPrefs(true);
    try {
      const payload: ProfilePrefs = {
        ...prefs,
        language: normalizeProfileLanguage(prefs.language),
      };
      await AsyncStorage.setItem(KEY_PROFILE_PREFS, JSON.stringify(payload));
      setPrefs(payload);
      await setHighContrast(payload.highContrast);

      const targetUserId = userId || String((await supabase.auth.getUser()).data.user?.id ?? "").trim();
      let cloudSyncFailed = false;
      if (targetUserId) {
        const { error: syncErr } = await supabase
          .from("user_notification_prefs")
          .upsert(toServerNotificationPrefs(targetUserId, payload), {
            onConflict: "user_id",
          });
        cloudSyncFailed = !!syncErr;
      }

      Alert.alert(
        "Saved",
        cloudSyncFailed
          ? "Preferences updated locally. Cloud sync failed and will retry on next save."
          : "Preferences updated."
      );
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not save preferences.");
    } finally {
      setSavingPrefs(false);
    }
  }, [prefs, setHighContrast, userId]);

  const sendDonation = useCallback(async (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    try {
      const next = supportTotalUsd + amount;
      setSupportTotalUsd(next);
      await AsyncStorage.setItem(KEY_SUPPORT_TOTAL, String(next));
      Alert.alert("Thank you", `Your $${amount} support has been recorded.`);
    } catch (e: any) {
      Alert.alert("Could not record support", e?.message ?? "Please try again.");
    }
  }, [supportTotalUsd]);

  const saveDailyIntention = useCallback(async () => {
    const next = dailyIntention.trim();
    if (!next) {
      Alert.alert("Validation", "Please enter an intention.");
      return;
    }
    try {
      await AsyncStorage.setItem(KEY_DAILY_INTENTION, next);
      setDailyIntention(next);
      Alert.alert("Saved", "Daily intention updated.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not save daily intention.");
    }
  }, [dailyIntention]);

  const openWaitlist = useCallback(() => {
    if (userId) {
      void logMonetizationEvent({
        userId,
        eventName: "circle_paywall_cta_tap",
        stage: "info",
        isCircleMember,
        metadata: {
          cta: "join_waitlist",
          billingAvailable,
          packageCount: circlePackages.length,
        },
      });
    }
    setWaitlistEmail((prev) => (prev.trim() ? prev : email.trim()));
    setWaitlistOpen(true);
  }, [billingAvailable, circlePackages.length, email, isCircleMember, userId]);

  const handlePurchaseCircle = useCallback(
    async (packageIdentifier?: string) => {
      if (userId) {
        void logMonetizationEvent({
          userId,
          eventName: "circle_paywall_cta_tap",
          stage: "attempt",
          packageIdentifier,
          isCircleMember,
          metadata: {
            cta: "purchase_circle",
            billingAvailable,
            packageCount: circlePackages.length,
          },
        });
      }
      setBillingActionBusy(true);
      try {
        const result = await purchaseCircle(packageIdentifier);
        if (!result.ok) {
          if (result.message !== "Purchase cancelled.") {
            Alert.alert("Purchase not completed", result.message);
          }
          return;
        }
        Alert.alert("Egregor Circle active", result.message);
      } finally {
        setBillingActionBusy(false);
        void refreshBilling();
      }
    },
    [billingAvailable, circlePackages.length, isCircleMember, purchaseCircle, refreshBilling, userId]
  );

  const handleRestoreCircle = useCallback(async () => {
    if (userId) {
      void logMonetizationEvent({
        userId,
        eventName: "circle_paywall_cta_tap",
        stage: "attempt",
        isCircleMember,
        metadata: {
          cta: "restore_circle",
          billingAvailable,
          packageCount: circlePackages.length,
        },
      });
    }
    setBillingActionBusy(true);
    try {
      const result = await restoreCircle();
      if (!result.ok) {
        Alert.alert("Restore finished", result.message);
        return;
      }
      Alert.alert("Restore successful", result.message);
    } finally {
      setBillingActionBusy(false);
      void refreshBilling();
    }
  }, [billingAvailable, circlePackages.length, isCircleMember, refreshBilling, restoreCircle, userId]);

  const handleRefreshBilling = useCallback(async () => {
    if (userId) {
      void logMonetizationEvent({
        userId,
        eventName: "circle_paywall_cta_tap",
        stage: "info",
        isCircleMember,
        metadata: {
          cta: "refresh_status",
          billingAvailable,
          packageCount: circlePackages.length,
        },
      });
    }
    await refreshBilling();
  }, [billingAvailable, circlePackages.length, isCircleMember, refreshBilling, userId]);

  const openBillingDebug = useCallback(() => {
    if (userId) {
      void logMonetizationEvent({
        userId,
        eventName: "billing_debug_open",
        stage: "info",
        isCircleMember,
        metadata: {
          source: "Profile",
          billingAvailable,
          packageCount: circlePackages.length,
        },
      });
    }
    const navToUse = navigation.getParent?.() ?? navigation;
    (navToUse as any).navigate("BillingDebug" as keyof RootStackParamList);
  }, [billingAvailable, circlePackages.length, isCircleMember, navigation, userId]);

  const submitWaitlist = useCallback(async () => {
    const nextEmail = waitlistEmail.trim().toLowerCase();
    const nextNote = waitlistNote.trim();

    if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      Alert.alert("Validation", "Enter a valid email address.");
      return;
    }
    if (nextNote.length > 240) {
      Alert.alert("Validation", "Note must be 240 characters or fewer.");
      return;
    }

    setSavingWaitlist(true);
    try {
      const raw = await AsyncStorage.getItem(KEY_CIRCLE_WAITLIST);
      const entries = raw ? (JSON.parse(raw) as CircleWaitlistEntry[]) : [];
      const next: CircleWaitlistEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        email: nextEmail,
        note: nextNote,
      };
      const merged = [next, ...(Array.isArray(entries) ? entries : [])].slice(0, 50);
      await AsyncStorage.setItem(KEY_CIRCLE_WAITLIST, JSON.stringify(merged));
      setWaitlistOpen(false);
      Alert.alert("You're on the list", "We'll notify you as soon as Egregor Circle opens.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not save waitlist entry.");
    } finally {
      setSavingWaitlist(false);
    }
  }, [waitlistEmail, waitlistNote]);

  const createCircle = useCallback(async () => {
    const name = circleName.trim();
    const intention = circleIntention.trim();
    if (!name) {
      Alert.alert("Validation", "Circle name is required.");
      return;
    }
    if (name.length > 60) {
      Alert.alert("Validation", "Circle name must be 60 characters or fewer.");
      return;
    }
    if (intention.length > 200) {
      Alert.alert("Validation", "Circle intention must be 200 characters or fewer.");
      return;
    }
    try {
      const next: SocialCircle = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        intention,
        createdAt: new Date().toISOString(),
      };
      const merged = [next, ...circles].slice(0, 50);
      setCircles(merged);
      setCircleName("");
      await AsyncStorage.setItem(KEY_MY_CIRCLES, JSON.stringify(merged));
      Alert.alert("Circle created", "You can now share an invite.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not create circle.");
    }
  }, [circleIntention, circleName, circles]);

  const deleteCircle = useCallback(async (id: string) => {
    const next = circles.filter((c) => c.id !== id);
    setCircles(next);
    try {
      await AsyncStorage.setItem(KEY_MY_CIRCLES, JSON.stringify(next));
    } catch {
      Alert.alert("Delete failed", "Could not update circles.");
    }
  }, [circles]);

  const shareCircleInvite = useCallback(async (circle: SocialCircle) => {
    const lines = [
      `Join my Egregor circle: ${circle.name}`,
      circle.intention ? `Intention: ${circle.intention}` : "",
      "Open Egregor and join us for synchronized practice.",
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join("\n") });
    } catch {
      // ignore
    }
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <ScrollView style={styles.wrap} contentContainerStyle={styles.wrapContent}>
        <Text style={[styles.h1, { color: c.text }]}>Profile</Text>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatar}
              onError={() => {
                setAvatarUrl("");
              }}
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: c.cardAlt, borderColor: c.primary }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: c.text }]}>{fullName}</Text>

            {!!email && <Text style={[styles.meta, { color: c.textMuted }]}>{email}</Text>}

            {!!userId && (
              <Text style={[styles.meta, { color: c.textMuted }]}>
                User ID: <Text style={{ color: c.text }}>{userId.slice(0, 8)}...{userId.slice(-6)}</Text>
              </Text>
            )}

            {!!avatarUrl && <Text style={[styles.meta, { color: c.textMuted }]}>Avatar: set</Text>}
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Spiritual Stats</Text>
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.text }]}>{streakDays}</Text>
              <Text style={[styles.statLabel, { color: c.textMuted }]}>Day streak</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.text }]}>{intentionEnergy}</Text>
              <Text style={[styles.statLabel, { color: c.textMuted }]}>Intention energy</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.text }]}>{activeDays30}</Text>
              <Text style={[styles.statLabel, { color: c.textMuted }]}>Active days (30d)</Text>
            </View>
          </View>
          <Text style={[styles.tip, { color: c.textMuted }]}>
            Stats are derived from your room presence activity.
          </Text>
        </View>

        <View style={[styles.sectionToggleCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Insights</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>
              Weekly rhythm and collective impact.
            </Text>
          </View>
          <Pressable
            style={[styles.sectionToggleBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
            onPress={() => setShowInsights((v) => !v)}
          >
            <Text style={[styles.sectionToggleBtnText, { color: c.text }]}>{showInsights ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>

        {showInsights ? (
          <>
            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Weekly Rhythm</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                Presence activity over the last 14 days by weekday.
              </Text>
              <View style={{ gap: 6 }}>
                {rhythmByDay.map((d) => {
                  const max = Math.max(1, ...rhythmByDay.map((x) => x.value));
                  const pct = Math.max(6, Math.round((d.value / max) * 100));
                  return (
                    <View key={d.label} style={styles.row}>
                      <Text style={[styles.meta, { color: c.textMuted, width: 34 }]}>{d.label}</Text>
                      <View style={[styles.rhythmTrack, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
                        <View style={[styles.rhythmFill, { backgroundColor: c.primary, width: `${pct}%` }]} />
                      </View>
                      <Text style={[styles.meta, { color: c.text, width: 24, textAlign: "right" }]}>{d.value}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Collective Impact</Text>
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                  <Text style={[styles.statValue, { color: c.text }]}>{collectiveImpact.liveEventsNow}</Text>
                  <Text style={[styles.statLabel, { color: c.textMuted }]}>Live circles now</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                  <Text style={[styles.statValue, { color: c.text }]}>{collectiveImpact.activeParticipantsNow}</Text>
                  <Text style={[styles.statLabel, { color: c.textMuted }]}>Active now (90s)</Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                  <Text style={[styles.statValue, { color: c.text }]}>{collectiveImpact.prayersWeek}</Text>
                  <Text style={[styles.statLabel, { color: c.textMuted }]}>Prayers this week</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                  <Text style={[styles.statValue, { color: c.text }]}>{collectiveImpact.sharedIntentionsWeek}</Text>
                  <Text style={[styles.statLabel, { color: c.textMuted }]}>Shared intentions (7d)</Text>
                </View>
              </View>
              <Text style={[styles.tip, { color: c.textMuted }]}>
                Snapshot based on global events, presence, and chat activity.
              </Text>
            </View>
          </>
        ) : null}

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Manifestation Journal</Text>
          <TextInput
            style={[styles.input, styles.journalInput, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={journalText}
            onChangeText={setJournalText}
            placeholder="Capture what shifted, what you felt, or what you're calling in..."
            placeholderTextColor={c.textMuted}
            multiline
            maxLength={600}
          />
          <View style={[styles.prefRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={[styles.prefLabel, { color: c.text }]}>Share anonymously to community feed</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                Your name stays hidden. Entry appears as Anonymous in Home feed.
              </Text>
            </View>
            <Switch value={journalShareAnonymously} onValueChange={setJournalShareAnonymously} />
          </View>
          <Text style={[styles.meta, { color: c.textMuted }]}>{journalText.trim().length}/600</Text>
          <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }]} onPress={addJournalEntry}>
            <Text style={styles.btnText}>Add entry</Text>
          </Pressable>

          {journalEntries.length === 0 ? (
            <Text style={[styles.meta, { color: c.textMuted }]}>No entries yet.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {journalEntries.slice(0, 8).map((entry) => (
                <View key={entry.id} style={[styles.journalCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    {new Date(entry.createdAt).toLocaleString()} -{" "}
                    {entry.visibility === "shared_anonymous" ? "Shared anonymously" : "Private"}
                  </Text>
                  <Text style={[styles.journalBody, { color: c.text }]}>{entry.text}</Text>
                  <Pressable onPress={() => deleteJournalEntry(entry.id)} style={[styles.inlineDelete, { borderColor: c.border }]}>
                    <Text style={[styles.meta, { color: c.textMuted }]}>Delete</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[styles.sectionToggleCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Advanced Tools</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>
              Solo history, preferences, circles, themes, and billing.
            </Text>
          </View>
          <Pressable
            style={[styles.sectionToggleBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
            onPress={() => setShowAdvancedTools((v) => !v)}
          >
            <Text style={[styles.sectionToggleBtnText, { color: c.text }]}>
              {showAdvancedTools ? "Hide" : "Show"}
            </Text>
          </Pressable>
        </View>

        {showAdvancedTools ? (
          <>
            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Solo Practice</Text>
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.text }]}>{soloSessionsWeek}</Text>
              <Text style={[styles.statLabel, { color: c.textMuted }]}>Sessions (7d)</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.text }]}>{soloMinutesWeek}</Text>
              <Text style={[styles.statLabel, { color: c.textMuted }]}>Minutes (7d)</Text>
            </View>
          </View>
          {soloRecent.length === 0 ? (
            <Text style={[styles.meta, { color: c.textMuted }]}>No completed solo sessions yet.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {soloRecent.map((entry) => (
                <View key={entry.id} style={[styles.journalCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    {new Date(entry.completedAt).toLocaleString()} • {entry.minutes} min • {entry.ambientPreset}
                  </Text>
                  <Text style={[styles.journalBody, { color: c.text }]}>{entry.intent}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Preferences</Text>

          <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Notifications</Text>
          <View style={[styles.prefRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <Text style={[styles.prefLabel, { color: c.text }]}>Live events starting</Text>
            <Switch value={prefs.notifyLiveStart} onValueChange={(v) => setPrefs((p) => ({ ...p, notifyLiveStart: v }))} />
          </View>
          <View style={[styles.prefRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <Text style={[styles.prefLabel, { color: c.text }]}>News-triggered events</Text>
            <Switch value={prefs.notifyNewsEvents} onValueChange={(v) => setPrefs((p) => ({ ...p, notifyNewsEvents: v }))} />
          </View>
          <View style={[styles.prefRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <Text style={[styles.prefLabel, { color: c.text }]}>Friend invites</Text>
            <Switch value={prefs.notifyFriendInvites} onValueChange={(v) => setPrefs((p) => ({ ...p, notifyFriendInvites: v }))} />
          </View>
          <View style={[styles.prefRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <Text style={[styles.prefLabel, { color: c.text }]}>Streak reminders</Text>
            <Switch value={prefs.notifyStreakReminders} onValueChange={(v) => setPrefs((p) => ({ ...p, notifyStreakReminders: v }))} />
          </View>
          <View style={[styles.prefRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <Text style={[styles.prefLabel, { color: c.text }]}>Community feed shares</Text>
            <Switch value={prefs.showCommunityFeed} onValueChange={(v) => setPrefs((p) => ({ ...p, showCommunityFeed: v }))} />
          </View>

          <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Accessibility</Text>
          <View style={[styles.prefRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <Text style={[styles.prefLabel, { color: c.text }]}>Voice mode</Text>
            <Switch value={prefs.voiceMode} onValueChange={(v) => setPrefs((p) => ({ ...p, voiceMode: v }))} />
          </View>
          <View style={[styles.prefRow, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
            <Text style={[styles.prefLabel, { color: c.text }]}>High contrast mode</Text>
            <Switch
              value={prefs.highContrast}
              onValueChange={(v) => {
                setPrefs((p) => ({ ...p, highContrast: v }));
                void setHighContrast(v);
              }}
            />
          </View>

          <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Preferred language</Text>
          <View style={styles.langRow}>
            {PROFILE_LANGUAGES.map((lang) => {
              const on = prefs.language === lang;
              return (
                <Pressable
                  key={lang}
                  onPress={() => setPrefs((p) => ({ ...p, language: lang }))}
                  style={[
                    styles.themeBtn,
                    { borderColor: c.border, backgroundColor: c.cardAlt, flexBasis: "48%" },
                    on && [styles.themeBtnActive, { backgroundColor: c.primary, borderColor: c.primary }],
                  ]}
                >
                  <Text style={[styles.themeBtnText, { color: c.textMuted }, on && styles.themeBtnTextActive]}>
                    {lang}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, savingPrefs && styles.disabled]}
            onPress={handleSavePrefs}
            disabled={savingPrefs}
          >
            <Text style={styles.btnText}>{savingPrefs ? "Saving..." : "Save preferences"}</Text>
          </Pressable>

          <Text style={[styles.tip, { color: c.textMuted }]}>
            These settings prepare notification, voice, and accessibility behavior across the app.
          </Text>
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Daily Intention</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={dailyIntention}
            onChangeText={setDailyIntention}
            placeholder="peace and clarity"
            placeholderTextColor={c.textMuted}
            maxLength={120}
          />
          <Text style={[styles.meta, { color: c.textMuted }]}>{dailyIntention.trim().length}/120</Text>
          <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }]} onPress={saveDailyIntention}>
            <Text style={styles.btnText}>Save daily intention</Text>
          </Pressable>
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Egregor Circle</Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Premium unlocks unlimited AI scripts, priority access, custom themes, and exclusive soundscapes.
          </Text>
          {!billingReady ? (
            <Text style={[styles.meta, { color: c.textMuted }]}>Loading billing status...</Text>
          ) : billingAvailable ? (
            <>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                {isCircleMember
                  ? `Status: Active${circleExpiresAt ? ` until ${new Date(circleExpiresAt).toLocaleDateString()}` : ""}`
                  : "Status: Free tier"}
              </Text>
              {circlePackages.length > 0 ? (
                <View style={{ gap: 8 }}>
                  {circlePackages.map((pkg) => (
                    <Pressable
                      key={pkg.identifier}
                      style={[
                        styles.btn,
                        styles.btnPrimary,
                        { backgroundColor: c.primary },
                        billingActionBusy && styles.disabled,
                      ]}
                      onPress={() => handlePurchaseCircle(pkg.identifier)}
                      disabled={billingActionBusy}
                    >
                      <Text style={styles.btnText}>
                        {pkg.title}
                        {pkg.priceString ? ` - ${pkg.priceString}` : ""}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={[styles.meta, { color: c.textMuted }]}>
                  No subscription packages are available yet. Import products into RevenueCat from App
                  Store Connect and Google Play Console, then tap Refresh status.
                </Text>
              )}
              <View style={styles.row}>
                <Pressable
                  style={[styles.btn, styles.btnGhost, { borderColor: c.border }, billingActionBusy && styles.disabled]}
                  onPress={handleRestoreCircle}
                  disabled={billingActionBusy}
                >
                  <Text style={[styles.btnGhostText, { color: c.text }]}>Restore purchases</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnGhost, { borderColor: c.border }, billingActionBusy && styles.disabled]}
                  onPress={() => void handleRefreshBilling()}
                  disabled={billingActionBusy}
                >
                  <Text style={[styles.btnGhostText, { color: c.text }]}>
                    {billingActionBusy ? "Working..." : "Refresh status"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnGhost, { borderColor: c.border }, billingActionBusy && styles.disabled]}
                  onPress={openBillingDebug}
                  disabled={billingActionBusy}
                >
                  <Text style={[styles.btnGhostText, { color: c.text }]}>Open billing debug</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                {billingError?.trim()
                  ? `Billing not configured on this build. ${billingError}`
                  : "Billing is not configured on this build yet."}
              </Text>
              <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }]} onPress={openWaitlist}>
                <Text style={styles.btnText}>Join waitlist</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Circle Support</Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            One-time support gifts help sustain live infrastructure and AI guidance.
          </Text>
          <View style={styles.themeRow}>
            {[5, 15, 33].map((amount) => (
              <Pressable
                key={amount}
                style={[styles.themeBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                onPress={() => sendDonation(amount)}
              >
                <Text style={[styles.themeBtnText, { color: c.text }]}>Donate ${amount}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.tip, { color: c.textMuted }]}>Total supported: ${supportTotalUsd}</Text>
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>My Circles</Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Create private friend circles and share invites.
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={circleName}
            onChangeText={setCircleName}
            placeholder="Circle name"
            placeholderTextColor={c.textMuted}
            maxLength={60}
          />
          <TextInput
            style={[styles.input, styles.journalInput, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={circleIntention}
            onChangeText={setCircleIntention}
            placeholder="Circle intention"
            placeholderTextColor={c.textMuted}
            multiline
            maxLength={200}
          />
          <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }]} onPress={createCircle}>
            <Text style={styles.btnText}>Create circle</Text>
          </Pressable>

          {circles.length === 0 ? (
            <Text style={[styles.meta, { color: c.textMuted }]}>No circles yet.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {circles.slice(0, 8).map((circle) => (
                <View key={circle.id} style={[styles.journalCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                  <Text style={[styles.sectionTitle, { color: c.text, fontSize: 14 }]}>{circle.name}</Text>
                  {!!circle.intention && <Text style={[styles.meta, { color: c.textMuted }]}>{circle.intention}</Text>}
                  <View style={styles.row}>
                    <Pressable style={[styles.btnGhost, { borderColor: c.border }]} onPress={() => shareCircleInvite(circle)}>
                      <Text style={[styles.btnGhostText, { color: c.text }]}>Share invite</Text>
                    </Pressable>
                    <Pressable style={[styles.btnGhost, { borderColor: c.border }]} onPress={() => deleteCircle(circle.id)}>
                      <Text style={[styles.btnGhostText, { color: c.text }]}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Appearance</Text>

          <View style={styles.themeRow}>
            <Pressable
              style={[
                styles.themeBtn,
                { borderColor: c.border, backgroundColor: c.cardAlt },
                theme === "light" && [styles.themeBtnActive, { backgroundColor: c.primary, borderColor: c.primary }],
              ]}
              onPress={() => setTheme("light")}
            >
              <Text style={[styles.themeBtnText, { color: c.textMuted }, theme === "light" && styles.themeBtnTextActive]}>Light</Text>
            </Pressable>
            <Pressable
              style={[
                styles.themeBtn,
                { borderColor: c.border, backgroundColor: c.cardAlt },
                theme === "dark" && [styles.themeBtnActive, { backgroundColor: c.primary, borderColor: c.primary }],
              ]}
              onPress={() => setTheme("dark")}
            >
              <Text style={[styles.themeBtnText, { color: c.textMuted }, theme === "dark" && styles.themeBtnTextActive]}>Dark</Text>
            </Pressable>
            <Pressable
              style={[
                styles.themeBtn,
                { borderColor: c.border, backgroundColor: c.cardAlt },
                theme === "cosmic" && [styles.themeBtnActive, { backgroundColor: c.primary, borderColor: c.primary }],
              ]}
              onPress={() => setTheme("cosmic")}
            >
              <Text style={[styles.themeBtnText, { color: c.textMuted }, theme === "cosmic" && styles.themeBtnTextActive]}>Cosmic</Text>
            </Pressable>
          </View>

          <Text style={[styles.tip, { color: c.textMuted }]}>Theme applies to navigation chrome and core surfaces.</Text>
        </View>
          </>
        ) : null}

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Account</Text>

          <Text style={[styles.fieldLabel, { color: c.textMuted }]}>First name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Your first name"
            placeholderTextColor={c.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!loading && !savingProfile}
            maxLength={60}
          />

          <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Last name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Your last name"
            placeholderTextColor={c.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!loading && !savingProfile}
            maxLength={60}
          />

          <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Display name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your display name"
            placeholderTextColor={c.textMuted}
            editable={!loading && !savingProfile}
          />

          <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Avatar URL</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
            value={avatarUrl}
            onChangeText={setAvatarUrl}
            placeholder="https://..."
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading && !savingProfile}
          />

          <Pressable
            style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, (loading || savingProfile) && styles.disabled]}
            onPress={handleSaveProfile}
            disabled={loading || savingProfile}
          >
            <Text style={styles.btnText}>{savingProfile ? "Saving..." : "Save profile"}</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={load} disabled={loading}>
            <Text style={[styles.btnGhostText, { color: c.text }]}>{loading ? "Refreshing..." : "Refresh profile"}</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost, { borderColor: c.border }]} onPress={clearAutoJoinPrefs}>
            <Text style={[styles.btnGhostText, { color: c.text }]}>Reset auto-join remembers</Text>
          </Pressable>

          <Pressable
            style={[styles.btn, styles.btnDanger, (signingOut || loading) && styles.disabled]}
            onPress={handleSignOut}
            disabled={signingOut || loading}
          >
            <Text style={styles.btnText}>{signingOut ? "Signing out..." : "Sign out"}</Text>
          </Pressable>

          <Pressable
            style={[styles.btn, styles.btnDanger, (deletingAccount || signingOut || loading) && styles.disabled]}
            onPress={handleDeleteAccount}
            disabled={deletingAccount || signingOut || loading}
          >
            <Text style={styles.btnText}>{deletingAccount ? "Deleting account..." : "Delete account"}</Text>
          </Pressable>

          <Text style={[styles.tip, { color: c.textMuted }]}>
            Tip: if you ever get stuck signed in, use Sign out. Delete account permanently removes your profile and app data.
          </Text>

          {loading ? <ActivityIndicator /> : null}
        </View>
      </ScrollView>

      <Modal visible={waitlistOpen} transparent animationType="slide" onRequestClose={() => setWaitlistOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Egregor Circle Waitlist</Text>
            <Text style={[styles.meta, { color: c.textMuted }]}>
              Share your email to get early access to premium themes, soundscapes, and priority events.
            </Text>

            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>Email</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              value={waitlistEmail}
              onChangeText={setWaitlistEmail}
              placeholder="you@example.com"
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />

            <Text style={[styles.fieldLabel, { color: c.textMuted }]}>What feature excites you most? (optional)</Text>
            <TextInput
              style={[styles.input, styles.journalInput, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              value={waitlistNote}
              onChangeText={setWaitlistNote}
              placeholder="Custom cosmic themes, voice guidance, unlimited scripts..."
              placeholderTextColor={c.textMuted}
              maxLength={240}
              multiline
            />
            <Text style={[styles.meta, { color: c.textMuted }]}>{waitlistNote.trim().length}/240</Text>

            <View style={styles.row}>
              <Pressable
                style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, savingWaitlist && styles.disabled]}
                onPress={submitWaitlist}
                disabled={savingWaitlist}
              >
                <Text style={styles.btnText}>{savingWaitlist ? "Saving..." : "Join waitlist"}</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnGhost, { borderColor: c.border }, savingWaitlist && styles.disabled]}
                onPress={() => setWaitlistOpen(false)}
                disabled={savingWaitlist}
              >
                <Text style={[styles.btnGhostText, { color: c.text }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1020" },
  wrap: { flex: 1 },
  wrapContent: { padding: 16, paddingBottom: 42 },

  h1: { color: "white", fontSize: 28, fontWeight: "800", marginBottom: 12 },

  card: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
  },

  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1A2C5F",
    borderWidth: 1,
    borderColor: "#6EA1FF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "white", fontWeight: "900", fontSize: 18 },

  name: { color: "white", fontSize: 16, fontWeight: "800", marginBottom: 2 },
  meta: { color: "#93A3D9", fontSize: 12 },

  section: {
    marginTop: 14,
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
    gap: 10,
  },
  sectionToggleCard: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionToggleBtn: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 74,
    alignItems: "center",
  },
  sectionToggleBtnText: { fontSize: 12, fontWeight: "800" },
  sectionTitle: { color: "#DCE4FF", fontSize: 16, fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: 8 },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#2A365E",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  statValue: { fontSize: 20, fontWeight: "900" },
  statLabel: { fontSize: 11, fontWeight: "700", textAlign: "center", marginTop: 2 },
  prefRow: {
    borderWidth: 1,
    borderColor: "#2A365E",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  prefLabel: { fontSize: 13, fontWeight: "700" },
  themeRow: { flexDirection: "row", gap: 8 },
  langRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  themeBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3E4C78",
    backgroundColor: "#0E1428",
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  themeBtnActive: {
    backgroundColor: "#5B8CFF",
    borderColor: "#6EA1FF",
  },
  themeBtnText: { color: "#C8D3FF", fontWeight: "800" },
  themeBtnTextActive: { color: "white" },
  fieldLabel: { color: "#B9C3E6", fontSize: 12, marginBottom: 4, marginTop: 2 },

  input: {
    backgroundColor: "#0E1428",
    borderColor: "#2A365E",
    borderWidth: 1,
    color: "white",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  journalInput: { minHeight: 74, textAlignVertical: "top" },
  journalCard: {
    borderWidth: 1,
    borderColor: "#2A365E",
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  journalBody: { fontSize: 13, lineHeight: 19 },
  inlineDelete: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 8,
    alignItems: "center",
  },
  rhythmTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  rhythmFill: {
    height: "100%",
    borderRadius: 999,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(3, 6, 12, 0.6)",
    justifyContent: "flex-end",
    padding: 16,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },

  btn: {
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3E4C78",
  },
  btnPrimary: { backgroundColor: "#5B8CFF" },
  btnDanger: { backgroundColor: "#FB7185" },

  btnText: { color: "white", fontWeight: "800" },
  btnGhostText: { color: "#C8D3FF", fontWeight: "800" },

  disabled: { opacity: 0.45 },

  tip: { color: "#93A3D9", fontSize: 12, marginTop: 2, lineHeight: 16 },
});

