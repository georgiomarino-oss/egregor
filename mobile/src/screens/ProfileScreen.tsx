// mobile/src/screens/ProfileScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabase/client";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";
import type { Database } from "../types/db";

const KEY_AUTO_JOIN_GLOBAL = "prefs:autoJoinLive";
const KEY_JOURNAL = "journal:entries";
const KEY_PROFILE_PREFS = "profile:prefs:v1";
const KEY_SUPPORT_TOTAL = "support:total:v1";
type PresenceRow = Database["public"]["Tables"]["event_presence"]["Row"];
type EventRow = Database["public"]["Tables"]["events"]["Row"];
type EventMessageRow = Database["public"]["Tables"]["event_messages"]["Row"];
type JournalEntry = { id: string; createdAt: string; text: string };
const PROFILE_LANGUAGES = ["English", "Spanish", "Portuguese", "French"] as const;
type ProfileLanguage = (typeof PROFILE_LANGUAGES)[number];

function normalizeProfileLanguage(value: string): ProfileLanguage {
  const raw = value.trim().toLowerCase();
  if (raw.startsWith("span")) return "Spanish";
  if (raw.startsWith("port")) return "Portuguese";
  if (raw.startsWith("fren")) return "French";
  return "English";
}

type ProfilePrefs = {
  notifyLiveStart: boolean;
  notifyNewsEvents: boolean;
  notifyFriendInvites: boolean;
  notifyStreakReminders: boolean;
  voiceMode: boolean;
  highContrast: boolean;
  language: ProfileLanguage;
};
const DEFAULT_PROFILE_PREFS: ProfilePrefs = {
  notifyLiveStart: true,
  notifyNewsEvents: true,
  notifyFriendInvites: true,
  notifyStreakReminders: true,
  voiceMode: false,
  highContrast: false,
  language: "English",
};

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

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toDayKey(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeStreakDays(dayKeys: string[]): number {
  if (!dayKeys.length) return 0;
  const set = new Set(dayKeys.filter(Boolean));
  if (!set.size) return 0;

  const now = new Date();
  const utcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let streak = 0;

  for (let i = 0; i < 366; i += 1) {
    const ms = utcMidnightMs - i * 24 * 60 * 60 * 1000;
    const d = new Date(ms);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    if (set.has(key)) {
      streak += 1;
      continue;
    }
    if (i === 0) continue;
    break;
  }

  return streak;
}

export default function ProfileScreen() {
  const { theme, highContrast, setTheme, setHighContrast } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");

  const [displayName, setDisplayName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [streakDays, setStreakDays] = useState(0);
  const [activeDays30, setActiveDays30] = useState(0);
  const [intentionEnergy, setIntentionEnergy] = useState(0);
  const [journalText, setJournalText] = useState("");
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [prefs, setPrefs] = useState<ProfilePrefs>(DEFAULT_PROFILE_PREFS);
  const [collectiveImpact, setCollectiveImpact] = useState<CollectiveImpact>(DEFAULT_COLLECTIVE_IMPACT);
  const [supportTotalUsd, setSupportTotalUsd] = useState(0);

  const loadJournal = useCallback(async () => {
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
        }))
        .filter((r: JournalEntry) => !!r.id && !!r.text.trim());
      rows.sort((a: JournalEntry, b: JournalEntry) => safeTimeMs(b.createdAt) - safeTimeMs(a.createdAt));
      setJournalEntries(rows);
    } catch {
      setJournalEntries([]);
    }
  }, []);

  const saveJournal = useCallback(async (entries: JournalEntry[]) => {
    await AsyncStorage.setItem(KEY_JOURNAL, JSON.stringify(entries));
  }, []);

  const loadPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY_PROFILE_PREFS);
      if (!raw) {
        setPrefs(DEFAULT_PROFILE_PREFS);
        return;
      }
      const parsed = JSON.parse(raw);
      const nextPrefs: ProfilePrefs = {
        notifyLiveStart: !!parsed?.notifyLiveStart,
        notifyNewsEvents: !!parsed?.notifyNewsEvents,
        notifyFriendInvites: !!parsed?.notifyFriendInvites,
        notifyStreakReminders: !!parsed?.notifyStreakReminders,
        voiceMode: !!parsed?.voiceMode,
        highContrast: !!parsed?.highContrast,
        language: normalizeProfileLanguage(String(parsed?.language ?? DEFAULT_PROFILE_PREFS.language)),
      };
      setPrefs(nextPrefs);
      void setHighContrast(nextPrefs.highContrast);
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
        .select("display_name,avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (!profErr && prof) {
        setDisplayName(String((prof as any).display_name ?? ""));
        setAvatarUrl(String((prof as any).avatar_url ?? ""));
      } else {
        setDisplayName("");
        setAvatarUrl("");
      }

      const { data: presenceRows } = await supabase
        .from("event_presence")
        .select("event_id,joined_at,last_seen_at")
        .eq("user_id", user.id)
        .order("last_seen_at", { ascending: false })
        .limit(5000);

      const rows = (presenceRows ?? []) as Pick<PresenceRow, "event_id" | "joined_at" | "last_seen_at">[];
      const dayKeys = rows
        .map((r) => toDayKey(String((r as any).last_seen_at ?? (r as any).joined_at ?? "")))
        .filter(Boolean);
      const distinctDayKeys = Array.from(new Set(dayKeys));
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recentDays = distinctDayKeys.filter((k) => safeTimeMs(`${k}T00:00:00.000Z`) >= cutoff).length;
      const distinctEventCount = new Set(rows.map((r) => String((r as any).event_id ?? ""))).size;

      setStreakDays(computeStreakDays(distinctDayKeys));
      setActiveDays30(recentDays);
      setIntentionEnergy(distinctEventCount);

      const nowMs = Date.now();
      const weekAgoIso = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
      const activeCutoffIso = new Date(nowMs - 90_000).toISOString();

      const [{ data: allEvents }, { count: prayersWeekCount }, { data: activePresenceRows }, { count: sharedIntentionsCount }] =
        await Promise.all([
          supabase
            .from("events")
            .select("id,start_time_utc,end_time_utc")
            .limit(300),
          supabase
            .from("event_presence")
            .select("*", { count: "exact", head: true })
            .gte("last_seen_at", weekAgoIso),
          supabase
            .from("event_presence")
            .select("event_id,user_id,last_seen_at")
            .gte("last_seen_at", activeCutoffIso)
            .limit(5000),
          supabase
            .from("event_messages")
            .select("*", { count: "exact", head: true })
            .gte("created_at", weekAgoIso),
        ]);

      const eventsRows = (allEvents ?? []) as Pick<EventRow, "id" | "start_time_utc" | "end_time_utc">[];
      const liveEventsNow = eventsRows.filter((e) => {
        const startMs = safeTimeMs(String((e as any).start_time_utc ?? ""));
        const endMs = safeTimeMs(String((e as any).end_time_utc ?? ""));
        return startMs > 0 && startMs <= nowMs && (endMs <= 0 || nowMs <= endMs);
      }).length;

      const activeRows = (activePresenceRows ?? []) as Pick<PresenceRow, "event_id" | "user_id" | "last_seen_at">[];
      const activeParticipantsNow = activeRows.filter((r) => {
        const ts = safeTimeMs(String((r as any).last_seen_at ?? ""));
        return ts > 0 && nowMs - ts <= 90_000;
      }).length;

      setCollectiveImpact({
        liveEventsNow,
        activeParticipantsNow,
        prayersWeek: prayersWeekCount ?? 0,
        sharedIntentionsWeek: sharedIntentionsCount ?? 0,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    void loadJournal();
    void loadPrefs();
    void loadSupportTotal();
  }, [load, loadJournal, loadPrefs, loadSupportTotal]);

  const initials = useMemo(() => {
    const name = (displayName || email || "").trim();
    if (!name) return "?";
    const parts = name.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "?";
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (a + b).toUpperCase();
  }, [displayName, email]);

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
      const payload = {
        id: userId,
        display_name: nextDisplayName || null,
        avatar_url: nextAvatarUrl || null,
      };

      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
      if (error) {
        Alert.alert("Save failed", error.message);
        return;
      }

      Alert.alert("Saved", "Profile updated.");
      await load();
    } finally {
      setSavingProfile(false);
    }
  }, [avatarUrl, displayName, load, userId]);

  const handleSignOut = useCallback(async () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            const { error } = await supabase.auth.signOut();
            if (error) {
              Alert.alert("Sign out failed", error.message);
              return;
            }
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }, []);

  const addJournalEntry = useCallback(async () => {
    const text = journalText.trim();
    if (!text) return;
    if (text.length > 600) {
      Alert.alert("Validation", "Journal entry must be 600 characters or fewer.");
      return;
    }

    const next: JournalEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      text,
    };
    const entries = [next, ...journalEntries].slice(0, 200);
    setJournalEntries(entries);
    setJournalText("");
    try {
      await saveJournal(entries);
    } catch {
      Alert.alert("Save failed", "Could not save journal entry.");
    }
  }, [journalEntries, journalText, saveJournal]);

  const deleteJournalEntry = useCallback(async (entryId: string) => {
    const next = journalEntries.filter((e) => e.id !== entryId);
    setJournalEntries(next);
    try {
      await saveJournal(next);
    } catch {
      Alert.alert("Delete failed", "Could not update journal storage.");
    }
  }, [journalEntries, saveJournal]);

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
      Alert.alert("Saved", "Preferences updated.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Could not save preferences.");
    } finally {
      setSavingPrefs(false);
    }
  }, [prefs, setHighContrast]);

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
            <Text style={[styles.name, { color: c.text }]}>{displayName?.trim() ? displayName.trim() : "Unnamed user"}</Text>

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
                    {new Date(entry.createdAt).toLocaleString()}
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
          <Text style={[styles.sectionTitle, { color: c.text }]}>Egregor Circle</Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Premium unlocks unlimited AI scripts, priority access, custom themes, and exclusive soundscapes.
          </Text>
          <Pressable style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }]}>
            <Text style={styles.btnText}>Join waitlist</Text>
          </Pressable>
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

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Account</Text>

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

          <Text style={[styles.tip, { color: c.textMuted }]}>
            Tip: if you ever get stuck signed in, use Sign out here and relaunch the app.
          </Text>

          {loading ? <ActivityIndicator /> : null}
        </View>
      </ScrollView>
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

