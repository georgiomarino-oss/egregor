// mobile/src/screens/ScriptsScreen.tsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../supabase/client";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";
import type { Database } from "../types/db";
import {
  consumeAiGenerationQuota,
  generateEventPrayerScript,
  getAiQuotaSnapshot,
  type AiQuotaResult,
  type EventScriptSection,
} from "../features/ai/aiScriptRepo";
import { logMonetizationEvent } from "../features/billing/billingAnalyticsRepo";

type ScriptRow = Database["public"]["Tables"]["scripts"]["Row"];
type ScriptInsert = Database["public"]["Tables"]["scripts"]["Insert"];
type EventRow = Database["public"]["Tables"]["events"]["Row"];

const RESYNC_MS = 60_000;
const SCRIPT_TITLE_MAX = 120;
const SCRIPT_INTENTION_MAX = 2000;
const SCRIPT_TONE_MAX = 40;
const SCRIPT_DURATION_MIN = 1;
const SCRIPT_DURATION_MAX = 240;
const SCRIPT_LANGUAGES = ["English", "Spanish", "Portuguese", "French"] as const;
type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sortScripts(rows: ScriptRow[]): ScriptRow[] {
  const copy = [...rows];
  copy.sort((a, b) => safeTimeMs(b.created_at) - safeTimeMs(a.created_at));
  return copy;
}

function sortEvents(rows: EventRow[]): EventRow[] {
  const copy = [...rows];
  copy.sort((a, b) => safeTimeMs(b.start_time_utc) - safeTimeMs(a.start_time_utc));
  return copy;
}

function upsertScriptRow(rows: ScriptRow[], next: ScriptRow): ScriptRow[] {
  const idx = rows.findIndex((r) => r.id === next.id);
  if (idx < 0) return sortScripts([...rows, next]);
  const copy = [...rows];
  copy[idx] = next;
  return sortScripts(copy);
}

function removeScriptRow(rows: ScriptRow[], scriptId: string): ScriptRow[] {
  if (!scriptId) return rows;
  return rows.filter((r) => r.id !== scriptId);
}

function upsertEventRow(rows: EventRow[], next: EventRow): EventRow[] {
  const idx = rows.findIndex((r) => r.id === next.id);
  if (idx < 0) return sortEvents([...rows, next]);
  const copy = [...rows];
  copy[idx] = next;
  return sortEvents(copy);
}

function removeEventRow(rows: EventRow[], eventId: string): EventRow[] {
  if (!eventId) return rows;
  return rows.filter((r) => r.id !== eventId);
}

function normalizeLanguage(value: string): ScriptLanguage {
  const raw = value.trim().toLowerCase();
  if (raw.startsWith("span")) return "Spanish";
  if (raw.startsWith("port")) return "Portuguese";
  if (raw.startsWith("fren")) return "French";
  return "English";
}

function toneHint(tone: string) {
  const t = tone.trim().toLowerCase();
  if (t.includes("uplift")) return "uplifting";
  if (t.includes("focus")) return "focused";
  if (t.includes("gentle") || t.includes("soft")) return "gentle";
  return "calm";
}

function sectionCopy(name: "arrival" | "intention" | "silence" | "closing", intentionText: string, tone: string, language: ScriptLanguage) {
  const vibe = toneHint(tone);
  if (language === "Spanish") {
    if (name === "arrival") return `Respira y llega con energia ${vibe}.`;
    if (name === "intention") return intentionText.trim();
    if (name === "silence") return "Sostiene la intencion en silencio y presencia.";
    return "Regresa con gratitud y cierra suavemente.";
  }
  if (language === "Portuguese") {
    if (name === "arrival") return `Respire e chegue com energia ${vibe}.`;
    if (name === "intention") return intentionText.trim();
    if (name === "silence") return "Sustente a intencao em silencio e presenca.";
    return "Retorne com gratidao e encerre com suavidade.";
  }
  if (language === "French") {
    if (name === "arrival") return `Respirez et arrivez avec une energie ${vibe}.`;
    if (name === "intention") return intentionText.trim();
    if (name === "silence") return "Maintenez l'intention en silence et en presence.";
    return "Revenez avec gratitude et terminez en douceur.";
  }
  if (name === "arrival") return `Take a breath and arrive in a ${vibe} tone.`;
  if (name === "intention") return intentionText.trim();
  if (name === "silence") return "Hold the intention in silence and presence.";
  return "Return gently with gratitude and close the circle.";
}

function buildDefaultSections(
  durationMinutes: number,
  intentionText: string,
  tone: string,
  language: ScriptLanguage
) {
  const mins = Math.max(1, Math.round(durationMinutes));

  if (mins <= 3) {
    return [{ name: "Guided Intention", minutes: mins, text: intentionText.trim() }];
  }

  let arrival = Math.max(1, Math.round(mins * 0.15));
  let intention = Math.max(1, Math.round(mins * 0.25));
  let closing = Math.max(1, Math.round(mins * 0.15));
  let silence = mins - arrival - intention - closing;

  while (silence < 1) {
    if (arrival > 1) {
      arrival -= 1;
      silence += 1;
      continue;
    }
    if (intention > 1) {
      intention -= 1;
      silence += 1;
      continue;
    }
    if (closing > 1) {
      closing -= 1;
      silence += 1;
      continue;
    }
    silence = 1;
    break;
  }

  return [
    { name: "Arrival", minutes: arrival, text: sectionCopy("arrival", intentionText, tone, language) },
    { name: "Intention", minutes: intention, text: sectionCopy("intention", intentionText, tone, language) },
    { name: "Silence", minutes: silence, text: sectionCopy("silence", intentionText, tone, language) },
    { name: "Closing", minutes: closing, text: sectionCopy("closing", intentionText, tone, language) },
  ];
}

export default function ScriptsScreen() {
  const navigation = useNavigation<any>();
  const { theme, highContrast, isCircleMember } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const [loading, setLoading] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [myUserId, setMyUserId] = useState("");

  // Create script form
  const [title, setTitle] = useState("Peace Circle Script");
  const [intention, setIntention] = useState(
    "May people everywhere experience peace, clarity and compassion."
  );
  const [durationMinutes, setDurationMinutes] = useState("20");
  const [tone, setTone] = useState("calm");
  const [scriptLanguage, setScriptLanguage] = useState<ScriptLanguage>("English");
  const [createSectionsOverride, setCreateSectionsOverride] = useState<EventScriptSection[] | null>(null);
  const [createAiQuota, setCreateAiQuota] = useState<AiQuotaResult | null>(null);

  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [myEvents, setMyEvents] = useState<EventRow[]>([]);

  // Attach modal state
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachScriptId, setAttachScriptId] = useState<string>("");
  const [eventQuery, setEventQuery] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editScriptId, setEditScriptId] = useState<string>("");
  const [editTitle, setEditTitle] = useState("");
  const [editIntention, setEditIntention] = useState("");
  const [editDurationMinutes, setEditDurationMinutes] = useState("20");
  const [editTone, setEditTone] = useState("calm");
  const [editLanguage, setEditLanguage] = useState<ScriptLanguage>("English");

  const scriptsById = useMemo(() => {
    const map: Record<string, ScriptRow> = {};
    for (const s of scripts) map[s.id] = s;
    return map;
  }, [scripts]);

  const selectedScript = useMemo(
    () => scripts.find((s) => s.id === attachScriptId) ?? null,
    [scripts, attachScriptId]
  );
  const hostedUsageByScriptId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of myEvents) {
      const sid = e.script_id ?? "";
      if (!sid) continue;
      map[sid] = (map[sid] ?? 0) + 1;
    }
    return map;
  }, [myEvents]);
  const editingScript = useMemo(
    () => scripts.find((s) => s.id === editScriptId) ?? null,
    [scripts, editScriptId]
  );

  const filteredEvents = useMemo(() => {
    const q = eventQuery.trim().toLowerCase();
    if (!q) return myEvents;

    return myEvents.filter((e) => {
      const t = (e.title ?? "").toLowerCase();
      const d = (e.description ?? "").toLowerCase();
      const currentTitle = e.script_id ? (scriptsById[e.script_id]?.title ?? "") : "";
      return t.includes(q) || d.includes(q) || currentTitle.toLowerCase().includes(q);
    });
  }, [myEvents, eventQuery, scriptsById]);

  const previewCreateSections = useMemo(() => {
    if (createSectionsOverride?.length) return createSectionsOverride;
    const mins = Number(durationMinutes);
    if (!Number.isFinite(mins) || mins < SCRIPT_DURATION_MIN || mins > SCRIPT_DURATION_MAX) return [];
    return buildDefaultSections(mins, intention.trim() || "Collective peace.", tone, scriptLanguage);
  }, [createSectionsOverride, durationMinutes, intention, tone, scriptLanguage]);

  const previewEditSections = useMemo(() => {
    const mins = Number(editDurationMinutes);
    if (!Number.isFinite(mins) || mins < SCRIPT_DURATION_MIN || mins > SCRIPT_DURATION_MAX) return [];
    return buildDefaultSections(mins, editIntention.trim() || "Collective peace.", editTone, editLanguage);
  }, [editDurationMinutes, editIntention, editTone, editLanguage]);

  const loadScripts = useCallback(async () => {
    const { data, error } = await supabase
      .from("scripts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      Alert.alert("Load scripts failed", error.message);
      return;
    }
    setScripts(sortScripts((data ?? []) as ScriptRow[]));
  }, []);

  const loadMyUserId = useCallback(async () => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      setMyUserId("");
      return;
    }
    setMyUserId(user.id);
  }, []);

  const loadMyHostedEvents = useCallback(async () => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) return;

    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("host_user_id", user.id)
      .order("start_time_utc", { ascending: false });

    if (error) {
      Alert.alert("Load events failed", error.message);
      return;
    }
    setMyEvents(sortEvents((data ?? []) as EventRow[]));
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadMyUserId(), loadScripts(), loadMyHostedEvents()]);
    } finally {
      setLoading(false);
    }
  }, [loadMyHostedEvents, loadMyUserId, loadScripts]);

  const refreshCreateAiQuota = useCallback(
    async (targetUserId?: string) => {
      const uid = String(targetUserId ?? myUserId).trim();
      if (!uid) {
        setCreateAiQuota(null);
        return;
      }
      const quota = await getAiQuotaSnapshot({
        userId: uid,
        mode: "event_script",
        isPremium: isCircleMember,
      });
      setCreateAiQuota(quota);
    },
    [isCircleMember, myUserId]
  );

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    void refreshCreateAiQuota(myUserId);
  }, [myUserId, isCircleMember, refreshCreateAiQuota]);

  useEffect(() => {
    if (attachOpen && attachScriptId && !scripts.some((s) => s.id === attachScriptId)) {
      setAttachOpen(false);
      setAttachScriptId("");
    }
    if (editOpen && editScriptId && !scripts.some((s) => s.id === editScriptId)) {
      setEditOpen(false);
      setEditScriptId("");
    }
  }, [scripts, attachOpen, attachScriptId, editOpen, editScriptId]);

  useEffect(() => {
    let disposed = false;
    const resync = () => {
      if (disposed) return;
      void loadScripts();
    };

    resync();
    const intervalId = setInterval(resync, RESYNC_MS);

    const channel = supabase
      .channel("scripts:list")
      .on("postgres_changes", { event: "*", schema: "public", table: "scripts" }, (payload) => {
        const eventType = String((payload as any).eventType ?? "");
        const next = ((payload as any).new ?? null) as ScriptRow | null;
        const prev = ((payload as any).old ?? null) as ScriptRow | null;

        setScripts((rows) => {
          if (eventType === "DELETE") {
            const scriptId = String((prev as any)?.id ?? "");
            return removeScriptRow(rows, scriptId);
          }
          if (!next) return rows;
          return upsertScriptRow(rows, next);
        });
      })
      .subscribe();

    return () => {
      disposed = true;
      clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [loadScripts]);

  useEffect(() => {
    if (!myUserId) return;

    let disposed = false;
    const resync = () => {
      if (disposed) return;
      void loadMyHostedEvents();
    };

    resync();
    const intervalId = setInterval(resync, RESYNC_MS);

    const channel = supabase
      .channel(`events:hosted:${myUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events", filter: `host_user_id=eq.${myUserId}` },
        (payload) => {
          const eventType = String((payload as any).eventType ?? "");
          const next = ((payload as any).new ?? null) as EventRow | null;
          const prev = ((payload as any).old ?? null) as EventRow | null;

          setMyEvents((rows) => {
            if (eventType === "DELETE") {
              const eventId = String((prev as any)?.id ?? "");
              return removeEventRow(rows, eventId);
            }
            if (!next) return rows;
            return upsertEventRow(rows, next);
          });
        }
      )
      .subscribe();

    return () => {
      disposed = true;
      clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [myUserId, loadMyHostedEvents]);

  const handleCreateScript = useCallback(async () => {
    const mins = Number(durationMinutes);
    const titleText = title.trim();
    const intentionText = intention.trim();
    const toneText = tone.trim().toLowerCase();

    if (!titleText) return Alert.alert("Validation", "Title is required.");
    if (titleText.length > SCRIPT_TITLE_MAX) {
      return Alert.alert("Validation", `Title must be ${SCRIPT_TITLE_MAX} characters or fewer.`);
    }
    if (!intentionText) return Alert.alert("Validation", "Intention is required.");
    if (intentionText.length > SCRIPT_INTENTION_MAX) {
      return Alert.alert("Validation", `Intention must be ${SCRIPT_INTENTION_MAX} characters or fewer.`);
    }
    if (!toneText) return Alert.alert("Validation", "Tone is required.");
    if (toneText.length > SCRIPT_TONE_MAX) {
      return Alert.alert("Validation", `Tone must be ${SCRIPT_TONE_MAX} characters or fewer.`);
    }
    if (!/^[a-z][a-z0-9 _-]*$/.test(toneText)) {
      return Alert.alert("Validation", "Tone can contain lowercase letters, numbers, spaces, '_' and '-'.");
    }
    if (!Number.isFinite(mins) || mins < SCRIPT_DURATION_MIN || mins > SCRIPT_DURATION_MAX) {
      return Alert.alert(
        "Validation",
        `Duration must be between ${SCRIPT_DURATION_MIN} and ${SCRIPT_DURATION_MAX} minutes.`
      );
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      Alert.alert("Not signed in", "Please sign in first.");
      return;
    }

    setLoading(true);
    try {
      const payload: ScriptInsert = {
        author_user_id: user.id as any,
        title: titleText,
        intention: intentionText,
        duration_minutes: mins as any,
        tone: toneText as any,
        content_json: {
          title: titleText,
          durationMinutes: mins,
          tone: toneText,
          language: scriptLanguage,
          sections:
            createSectionsOverride?.length
              ? createSectionsOverride
              : buildDefaultSections(mins, intentionText, toneText, scriptLanguage),
        } as any,
      };

      const { error } = await supabase.from("scripts").insert(payload);

      if (error) {
        Alert.alert("Create script failed", error.message);
        return;
      }

      Alert.alert("Success", "Script created.");
      setCreateSectionsOverride(null);
      await refreshAll();
    } catch (e: any) {
      Alert.alert("Create script failed", e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [
    createSectionsOverride,
    durationMinutes,
    intention,
    refreshAll,
    scriptLanguage,
    title,
    tone,
  ]);

  const handleGenerateAiScript = useCallback(async () => {
    const mins = Number(durationMinutes);
    const intentionText = intention.trim();
    const toneText = tone.trim().toLowerCase() || "calm";

    if (!intentionText) {
      Alert.alert("Validation", "Add an intention first.");
      return;
    }
    if (!Number.isFinite(mins) || mins < SCRIPT_DURATION_MIN || mins > SCRIPT_DURATION_MAX) {
      Alert.alert(
        "Validation",
        `Duration must be between ${SCRIPT_DURATION_MIN} and ${SCRIPT_DURATION_MAX} minutes.`
      );
      return;
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      Alert.alert("Not signed in", "Please sign in first.");
      return;
    }

    void logMonetizationEvent({
      userId: user.id,
      eventName: "premium_feature_use",
      stage: "attempt",
      isCircleMember: isCircleMember,
      metadata: {
        feature: "ai_event_script_generate",
        mode: "event_script",
        isPremium: isCircleMember,
      },
    });

    const quota = await consumeAiGenerationQuota({
      userId: user.id,
      mode: "event_script",
      isPremium: isCircleMember,
    });
    setCreateAiQuota(quota);

    if (!quota.allowed) {
      const capText = quota.limit ? `${quota.limit}` : "your";
      void logMonetizationEvent({
        userId: user.id,
        eventName: "premium_feature_use",
        stage: "failure",
        isCircleMember: isCircleMember,
        errorMessage: "quota_denied",
        metadata: {
          feature: "ai_event_script_generate",
          mode: "event_script",
          isPremium: isCircleMember,
          usedToday: quota.usedToday,
          limit: quota.limit,
          remaining: quota.remaining,
        },
      });
      Alert.alert(
        "Daily AI limit reached",
        `Free tier allows ${capText} AI event scripts per day. Upgrade to Egregor Circle for unlimited generation.`
      );
      return;
    }

    setGeneratingAi(true);
    try {
      const generated = await generateEventPrayerScript({
        intention: intentionText,
        durationMinutes: mins,
        tone: toneText,
        language: scriptLanguage,
      });

      setTitle(generated.title);
      setIntention(generated.intention);
      setDurationMinutes(String(generated.durationMinutes));
      setTone(generated.tone);
      setScriptLanguage(normalizeLanguage(generated.language));
      setCreateSectionsOverride(generated.sections);
      void logMonetizationEvent({
        userId: user.id,
        eventName: "premium_feature_use",
        stage: "success",
        isCircleMember: isCircleMember,
        metadata: {
          feature: "ai_event_script_generate",
          mode: "event_script",
          isPremium: isCircleMember,
          source: generated.source,
          language: generated.language,
          durationMinutes: generated.durationMinutes,
          sections: generated.sections.length,
        },
      });
      Alert.alert(
        "AI script ready",
        generated.source === "openai"
          ? "Generated with OpenAI. Review and create when ready."
          : "Generated with local fallback. Review and create when ready."
      );
    } catch (e: any) {
      void logMonetizationEvent({
        userId: user.id,
        eventName: "premium_feature_use",
        stage: "failure",
        isCircleMember: isCircleMember,
        errorMessage: e?.message ?? "Could not generate script.",
        metadata: {
          feature: "ai_event_script_generate",
          mode: "event_script",
          isPremium: isCircleMember,
        },
      });
      Alert.alert("AI generation failed", e?.message ?? "Could not generate script.");
    } finally {
      setGeneratingAi(false);
      void refreshCreateAiQuota(user.id);
    }
  }, [durationMinutes, intention, isCircleMember, refreshCreateAiQuota, scriptLanguage, tone]);

  const openAttachForScript = useCallback(
    async (scriptId: string) => {
      setAttachScriptId(scriptId);
      setEventQuery("");
      setAttachOpen(true);
      await loadMyHostedEvents();
    },
    [loadMyHostedEvents]
  );

  const openEditScript = useCallback((script: ScriptRow) => {
    setEditScriptId(script.id);
    setEditTitle(String((script as any).title ?? ""));
    setEditIntention(String((script as any).intention ?? ""));
    setEditDurationMinutes(String((script as any).duration_minutes ?? "20"));
    setEditTone(String((script as any).tone ?? "calm"));
    setEditLanguage(normalizeLanguage(String((script as any)?.content_json?.language ?? "English")));
    setEditOpen(true);
  }, []);

  const saveScriptEdit = useCallback(async () => {
    if (!editingScript) return;

    const mins = Number(editDurationMinutes);
    const titleText = editTitle.trim();
    const intentionText = editIntention.trim();
    const toneText = editTone.trim().toLowerCase();

    if (!titleText) return Alert.alert("Validation", "Title is required.");
    if (titleText.length > SCRIPT_TITLE_MAX) {
      return Alert.alert("Validation", `Title must be ${SCRIPT_TITLE_MAX} characters or fewer.`);
    }
    if (!intentionText) return Alert.alert("Validation", "Intention is required.");
    if (intentionText.length > SCRIPT_INTENTION_MAX) {
      return Alert.alert("Validation", `Intention must be ${SCRIPT_INTENTION_MAX} characters or fewer.`);
    }
    if (!toneText) return Alert.alert("Validation", "Tone is required.");
    if (toneText.length > SCRIPT_TONE_MAX) {
      return Alert.alert("Validation", `Tone must be ${SCRIPT_TONE_MAX} characters or fewer.`);
    }
    if (!/^[a-z][a-z0-9 _-]*$/.test(toneText)) {
      return Alert.alert("Validation", "Tone can contain lowercase letters, numbers, spaces, '_' and '-'.");
    }
    if (!Number.isFinite(mins) || mins < SCRIPT_DURATION_MIN || mins > SCRIPT_DURATION_MAX) {
      return Alert.alert(
        "Validation",
        `Duration must be between ${SCRIPT_DURATION_MIN} and ${SCRIPT_DURATION_MAX} minutes.`
      );
    }

    setLoading(true);
    try {
      const payload = {
        title: titleText,
        intention: intentionText,
        duration_minutes: mins,
        tone: toneText,
        content_json: {
          title: titleText,
          durationMinutes: mins,
          tone: toneText,
          language: editLanguage,
          sections: buildDefaultSections(mins, intentionText, toneText, editLanguage),
        },
      };

      const { error } = await supabase.from("scripts").update(payload as any).eq("id", editingScript.id);
      if (error) {
        Alert.alert("Update failed", error.message);
        return;
      }
      setEditOpen(false);
      setEditScriptId("");
      await refreshAll();
      Alert.alert("Updated", "Script saved.");
    } finally {
      setLoading(false);
    }
  }, [editDurationMinutes, editIntention, editLanguage, editTitle, editTone, editingScript, refreshAll]);

  const handleDeleteScript = useCallback(
    async (script: ScriptRow) => {
      const attachedCount = myEvents.filter((e) => e.script_id === script.id).length;
      if (attachedCount > 0) {
        Alert.alert(
          "Cannot delete",
          `This script is attached to ${attachedCount} hosted event${attachedCount === 1 ? "" : "s"}. Detach it first.`
        );
        return;
      }

      Alert.alert("Delete script?", `Delete "${script.title ?? "Untitled"}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              const { error } = await supabase.from("scripts").delete().eq("id", script.id);
              if (error) {
                Alert.alert("Delete failed", error.message);
                return;
              }
              await refreshAll();
              Alert.alert("Deleted", "Script removed.");
            } finally {
              setLoading(false);
            }
          },
        },
      ]);
    },
    [myEvents, refreshAll]
  );

  const handleDuplicateScript = useCallback(
    async (script: ScriptRow) => {
      const baseTitle = String((script as any).title ?? "Untitled").trim();
      const nextTitle = `${baseTitle} (Copy)`.slice(0, SCRIPT_TITLE_MAX);
      const nextIntention = String((script as any).intention ?? "").trim();
      const nextTone = String((script as any).tone ?? "calm").trim().toLowerCase();
      const nextDuration = Number((script as any).duration_minutes ?? 20);
      const nextLanguage = normalizeLanguage(String((script as any)?.content_json?.language ?? "English"));

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr || !user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      setLoading(true);
      try {
        const payload: ScriptInsert = {
          author_user_id: user.id as any,
          title: nextTitle,
          intention: nextIntention,
          duration_minutes: nextDuration as any,
          tone: nextTone as any,
          content_json: {
            title: nextTitle,
            durationMinutes: nextDuration,
            tone: nextTone,
            language: nextLanguage,
            sections: buildDefaultSections(nextDuration, nextIntention || "Copied script intention.", nextTone, nextLanguage),
          } as any,
        };

        const { error } = await supabase.from("scripts").insert(payload);
        if (error) {
          Alert.alert("Duplicate failed", error.message);
          return;
        }
        await refreshAll();
        Alert.alert("Duplicated", "Script copied.");
      } finally {
        setLoading(false);
      }
    },
    [refreshAll]
  );

  const updateEventScript = useCallback(
    async (event: EventRow, nextScriptId: string | null) => {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        Alert.alert("Not signed in", "Please sign in first.");
        return false;
      }

      if (event.host_user_id !== user.id) {
        Alert.alert("Not allowed", "Only the host can change this event’s script.");
        return false;
      }

      setLoading(true);
      try {
        const { error } = await supabase
          .from("events")
          .update({ script_id: nextScriptId })
          .eq("id", event.id);

        if (error) {
          Alert.alert("Update failed", error.message);
          return false;
        }

        await loadMyHostedEvents();
        return true;
      } finally {
        setLoading(false);
      }
    },
    [loadMyHostedEvents]
  );

  const attachToEvent = useCallback(
    async (event: EventRow) => {
      if (!attachScriptId) return;

      if (event.script_id === attachScriptId) {
        Alert.alert("Already attached", "This event already uses the selected script.");
        return;
      }

      if (event.script_id && event.script_id !== attachScriptId) {
        Alert.alert(
          "Replace script?",
          "This event already has a script attached. Replace it?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Replace",
              style: "destructive",
              onPress: async () => {
                const ok = await updateEventScript(event, attachScriptId);
                if (ok) {
                  setAttachOpen(false);
                  Alert.alert("Updated", "Script replaced.");
                }
              },
            },
          ]
        );
        return;
      }

      const ok = await updateEventScript(event, attachScriptId);
      if (ok) {
        setAttachOpen(false);
        Alert.alert("Attached", "Script attached to event.");
      }
    },
    [attachScriptId, updateEventScript]
  );

  const detachFromEvent = useCallback(
    async (event: EventRow) => {
      if (!event.script_id) return;

      Alert.alert("Detach script?", "Remove the current script from this event?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Detach",
          style: "destructive",
          onPress: async () => {
            const ok = await updateEventScript(event, null);
            if (ok) {
              setAttachOpen(false);
              Alert.alert("Detached", "Script removed from event.");
            }
          },
        },
      ]);
    },
    [updateEventScript]
  );

  const goProfile = useCallback(() => {
    navigation.navigate("Profile");
  }, [navigation]);

  const renderScript = ({ item }: { item: ScriptRow }) => (
    <View style={[styles.card, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
      <Text style={[styles.cardTitle, { color: c.text }]}>{(item as any).title ?? "Untitled"}</Text>

      {"tone" in (item as any) ? <Text style={[styles.meta, { color: c.textMuted }]}>Tone: {(item as any).tone}</Text> : null}

      {"duration_minutes" in (item as any) ? (
        <Text style={[styles.meta, { color: c.textMuted }]}>Duration: {(item as any).duration_minutes} min</Text>
      ) : null}

      {"intention" in (item as any) ? (
        <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={2}>
          Intention: {(item as any).intention}
        </Text>
      ) : null}

      <Text style={[styles.meta, { color: c.textMuted }]}>
        Used by hosted events: {hostedUsageByScriptId[item.id] ?? 0}
      </Text>

      <View style={styles.row}>
        <Pressable
          onPress={() => openEditScript(item)}
          style={[styles.btn, styles.btnGhost, { borderColor: c.border }, loading && styles.disabled]}
          disabled={loading}
        >
          <Text style={[styles.btnGhostText, { color: c.textMuted }]}>Edit</Text>
        </Pressable>

        <Pressable
          onPress={() => handleDuplicateScript(item)}
          style={[styles.btn, styles.btnGhost, { borderColor: c.border }, loading && styles.disabled]}
          disabled={loading}
        >
          <Text style={[styles.btnGhostText, { color: c.textMuted }]}>Duplicate</Text>
        </Pressable>

        <Pressable
          onPress={() => openAttachForScript(item.id)}
          style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, loading && styles.disabled]}
          disabled={loading}
        >
          <Text style={styles.btnText}>Attach to event</Text>
        </Pressable>

        <Pressable
          onPress={() => handleDeleteScript(item)}
          style={[styles.btn, styles.btnDanger, loading && styles.disabled]}
          disabled={loading}
        >
          <Text style={styles.btnText}>Delete</Text>
        </Pressable>
      </View>

      <Text style={[styles.metaSmall, { color: c.textMuted }]}>ID: {item.id}</Text>
    </View>
  );

  const renderEventRow = ({ item }: { item: EventRow }) => {
    const isUsingSelected = !!attachScriptId && item.script_id === attachScriptId;

    const currentTitle =
      item.script_id ? scriptsById[item.script_id]?.title ?? item.script_id : "(none)";

    const attachLabel = isUsingSelected ? "Attached" : item.script_id ? "Replace" : "Attach";

    return (
      <View style={[styles.eventCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
        <Text style={[styles.eventTitle, { color: c.text }]} numberOfLines={1}>
          {item.title}
        </Text>

        <Text style={[styles.eventMeta, { color: c.textMuted }]} numberOfLines={1}>
          {new Date(item.start_time_utc).toLocaleString()} ({item.timezone ?? "UTC"})
        </Text>

        <Text style={[styles.eventMeta, { color: c.textMuted }]} numberOfLines={1}>
          Current: <Text style={{ color: c.text, fontWeight: "800" }}>{currentTitle}</Text>
        </Text>

        <View style={styles.row}>
          <Pressable
            onPress={() => attachToEvent(item)}
            style={[
              styles.btn,
              isUsingSelected
                ? [styles.btnGhost, { borderColor: c.border }]
                : [styles.btnPrimary, { backgroundColor: c.primary }],
              (loading || !attachScriptId) && styles.disabled,
            ]}
            disabled={loading || !attachScriptId || isUsingSelected}
          >
            <Text style={isUsingSelected ? [styles.btnGhostText, { color: c.textMuted }] : styles.btnText}>
              {attachLabel}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => detachFromEvent(item)}
            style={[styles.btn, styles.btnDanger, (loading || !item.script_id) && styles.disabled]}
            disabled={loading || !item.script_id}
          >
            <Text style={styles.btnText}>Detach</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]}>
      <FlatList
        data={scripts}
        keyExtractor={(item) => item.id}
        renderItem={renderScript}
        contentContainerStyle={styles.content}
        refreshing={loading}
        onRefresh={refreshAll}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <View style={styles.headerRow}>
              <Text style={[styles.h1, { color: c.text }]}>Scripts</Text>

              <Pressable onPress={goProfile} style={[styles.headerBtn, { borderColor: c.border }]}>
                <Text style={[styles.headerBtnText, { color: c.textMuted }]}>Profile</Text>
              </Pressable>
            </View>

            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Create Script</Text>

              <Text style={[styles.label, { color: c.textMuted }]}>Title</Text>
              <TextInput
                value={title}
                onChangeText={(v) => {
                  setTitle(v);
                  setCreateSectionsOverride(null);
                }}
                style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
                placeholder="Script title"
                placeholderTextColor={c.textMuted}
                maxLength={SCRIPT_TITLE_MAX}
              />
              <Text style={[styles.meta, { color: c.textMuted }]}>{title.trim().length}/{SCRIPT_TITLE_MAX}</Text>

              <Text style={[styles.label, { color: c.textMuted }]}>Intention</Text>
              <TextInput
                value={intention}
                onChangeText={(v) => {
                  setIntention(v);
                  setCreateSectionsOverride(null);
                }}
                style={[styles.input, styles.multi, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
                multiline
                placeholder="What is this script for?"
                placeholderTextColor={c.textMuted}
                maxLength={SCRIPT_INTENTION_MAX}
              />
              <Text style={[styles.meta, { color: c.textMuted }]}>{intention.trim().length}/{SCRIPT_INTENTION_MAX}</Text>

              <View style={styles.row}>
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={[styles.label, { color: c.textMuted }]}>Duration (minutes)</Text>
                  <TextInput
                    value={durationMinutes}
                    onChangeText={(v) => {
                      setDurationMinutes(v);
                      setCreateSectionsOverride(null);
                    }}
                    keyboardType="numeric"
                    style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
                    placeholder="20"
                    placeholderTextColor={c.textMuted}
                    maxLength={3}
                  />
                </View>

                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={[styles.label, { color: c.textMuted }]}>Tone</Text>
                  <TextInput
                    value={tone}
                    onChangeText={(v) => {
                      setTone(v);
                      setCreateSectionsOverride(null);
                    }}
                    style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
                    placeholder="calm"
                    placeholderTextColor={c.textMuted}
                    maxLength={SCRIPT_TONE_MAX}
                  />
                </View>
              </View>

              <Text style={[styles.label, { color: c.textMuted }]}>Language</Text>
              <View style={styles.row}>
                {SCRIPT_LANGUAGES.map((lang) => {
                  const on = scriptLanguage === lang;
                  return (
                    <Pressable
                      key={lang}
                      onPress={() => {
                        setScriptLanguage(lang);
                        setCreateSectionsOverride(null);
                      }}
                      style={[
                        styles.btn,
                        on ? [styles.btnPrimary, { backgroundColor: c.primary }] : [styles.btnGhost, { borderColor: c.border }],
                      ]}
                    >
                      <Text style={on ? styles.btnText : [styles.btnGhostText, { color: c.textMuted }]}>{lang}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.label, { color: c.textMuted }]}>Section preview</Text>
              <View style={[styles.section, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                {previewCreateSections.map((s, idx) => (
                  <View key={`${s.name}-${idx}`} style={{ marginBottom: 8 }}>
                    <Text style={[styles.meta, { color: c.text }]}>
                      {idx + 1}. {s.name} ({s.minutes}m)
                    </Text>
                    <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={2}>
                      {s.text}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={styles.row}>
                <Pressable
                  onPress={handleCreateScript}
                  style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, loading && styles.disabled]}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>{loading ? "Working..." : "Create script"}</Text>
                </Pressable>

                <Pressable
                  onPress={handleGenerateAiScript}
                  style={[
                    styles.btn,
                    styles.btnGhost,
                    { borderColor: c.border },
                    (loading || generatingAi) && styles.disabled,
                  ]}
                  disabled={loading || generatingAi}
                >
                  <Text style={[styles.btnGhostText, { color: c.textMuted }]}>
                    {generatingAi ? "Generating..." : "Generate with AI"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={refreshAll}
                  style={[styles.btn, styles.btnGhost, { borderColor: c.border }, loading && styles.disabled]}
                  disabled={loading}
                >
                  <Text style={[styles.btnGhostText, { color: c.textMuted }]}>Refresh</Text>
                </Pressable>
              </View>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                {isCircleMember
                  ? "Egregor Circle: unlimited AI event script generation."
                  : `Free AI event scripts today: ${createAiQuota?.usedToday ?? 0}/${createAiQuota?.limit ?? 3}`}
              </Text>
            </View>

            <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Attach Script to Event</Text>
              <Text style={[styles.meta, { color: c.textMuted }]}>
                Tap "Attach to event" on a script, then choose one of your hosted events.
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: c.textMuted }]}>{loading ? "Loading..." : "No scripts yet."}</Text>
        }
      />

      <Modal
        visible={attachOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.background, borderColor: c.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.text }]}>Attach Script</Text>
              <Pressable onPress={() => setAttachOpen(false)} style={[styles.modalClose, { backgroundColor: c.cardAlt }]}>
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>

            <Text style={[styles.modalMeta, { color: c.textMuted }]}>
              Selected script:{" "}
              <Text style={{ fontWeight: "800", color: c.text }}>
                {selectedScript ? (selectedScript as any).title : "(none)"}
              </Text>
            </Text>

            <TextInput
              value={eventQuery}
              onChangeText={setEventQuery}
              style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              placeholder="Search your events (title, description, current script)"
              placeholderTextColor={c.textMuted}
            />

            {myEvents.length === 0 ? (
              <Text style={[styles.empty, { color: c.textMuted }]}>No hosted events found. Create one in Events first.</Text>
            ) : (
              <FlatList
                data={filteredEvents}
                keyExtractor={(e) => e.id}
                renderItem={renderEventRow}
                contentContainerStyle={{ paddingTop: 10, paddingBottom: 6, gap: 10 }}
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={editOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.background, borderColor: c.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: c.text }]}>Edit Script</Text>
              <Pressable
                onPress={() => setEditOpen(false)}
                style={[styles.modalClose, { backgroundColor: c.cardAlt }]}
                disabled={loading}
              >
                <Text style={styles.btnText}>Close</Text>
              </Pressable>
            </View>

            <Text style={[styles.label, { color: c.textMuted }]}>Title</Text>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              placeholder="Script title"
              placeholderTextColor={c.textMuted}
              maxLength={SCRIPT_TITLE_MAX}
            />
            <Text style={[styles.meta, { color: c.textMuted }]}>{editTitle.trim().length}/{SCRIPT_TITLE_MAX}</Text>

            <Text style={[styles.label, { color: c.textMuted }]}>Intention</Text>
            <TextInput
              value={editIntention}
              onChangeText={setEditIntention}
              style={[styles.input, styles.multi, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
              multiline
              placeholder="What is this script for?"
              placeholderTextColor={c.textMuted}
              maxLength={SCRIPT_INTENTION_MAX}
            />
            <Text style={[styles.meta, { color: c.textMuted }]}>{editIntention.trim().length}/{SCRIPT_INTENTION_MAX}</Text>

            <View style={styles.row}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Text style={[styles.label, { color: c.textMuted }]}>Duration (minutes)</Text>
                <TextInput
                  value={editDurationMinutes}
                  onChangeText={setEditDurationMinutes}
                  keyboardType="numeric"
                  style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
                  placeholder="20"
                  placeholderTextColor={c.textMuted}
                  maxLength={3}
                />
              </View>

              <View style={{ flex: 1, minWidth: 140 }}>
                <Text style={[styles.label, { color: c.textMuted }]}>Tone</Text>
                <TextInput
                  value={editTone}
                  onChangeText={setEditTone}
                  style={[styles.input, { backgroundColor: c.cardAlt, borderColor: c.border, color: c.text }]}
                  placeholder="calm"
                  placeholderTextColor={c.textMuted}
                  maxLength={SCRIPT_TONE_MAX}
                />
              </View>
            </View>

            <Text style={[styles.label, { color: c.textMuted }]}>Language</Text>
            <View style={styles.row}>
              {SCRIPT_LANGUAGES.map((lang) => {
                const on = editLanguage === lang;
                return (
                  <Pressable
                    key={lang}
                    onPress={() => setEditLanguage(lang)}
                    style={[
                      styles.btn,
                      on ? [styles.btnPrimary, { backgroundColor: c.primary }] : [styles.btnGhost, { borderColor: c.border }],
                    ]}
                  >
                    <Text style={on ? styles.btnText : [styles.btnGhostText, { color: c.textMuted }]}>{lang}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: c.textMuted }]}>Section preview</Text>
            <View style={[styles.section, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
              {previewEditSections.map((s, idx) => (
                <View key={`${s.name}-${idx}`} style={{ marginBottom: 8 }}>
                  <Text style={[styles.meta, { color: c.text }]}>
                    {idx + 1}. {s.name} ({s.minutes}m)
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={2}>
                    {s.text}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.row}>
              <Pressable
                onPress={saveScriptEdit}
                style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, loading && styles.disabled]}
                disabled={loading || !editingScript}
              >
                <Text style={styles.btnText}>{loading ? "Working..." : "Save changes"}</Text>
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
  content: { padding: 16, paddingBottom: 32 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  h1: { color: "white", fontSize: 28, fontWeight: "800" },

  headerBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3E4C78",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  headerBtnText: { color: "#C8D3FF", fontWeight: "900" },

  section: {
    backgroundColor: "#151C33",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
  },
  sectionTitle: {
    color: "#DCE4FF",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },

  label: { color: "#B9C3E6", fontSize: 12, marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: "#0E1428",
    borderColor: "#2A365E",
    borderWidth: 1,
    color: "white",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multi: { minHeight: 72, textAlignVertical: "top" },

  row: { flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" },

  btn: {
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 110,
  },
  btnPrimary: { backgroundColor: "#5B8CFF" },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#3E4C78",
  },
  btnDanger: { backgroundColor: "#FB7185" },
  btnText: { color: "white", fontWeight: "800" },
  btnGhostText: { color: "#C8D3FF", fontWeight: "800" },
  disabled: { opacity: 0.45 },

  card: {
    backgroundColor: "#121A31",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27345C",
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: { color: "white", fontSize: 16, fontWeight: "700", marginBottom: 6 },
  meta: { color: "#93A3D9", fontSize: 12, lineHeight: 16 },
  metaSmall: { color: "#6F83C6", fontSize: 11, marginTop: 10 },

  empty: { color: "#9EB0E3", marginTop: 10 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    padding: 16,
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "85%",
    backgroundColor: "#0B1020",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2A365E",
    padding: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  modalTitle: { color: "white", fontSize: 18, fontWeight: "900" },
  modalClose: {
    backgroundColor: "#3E4C78",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalMeta: { color: "#B9C3E6", marginBottom: 10 },

  eventCard: {
    backgroundColor: "#121A31",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#27345C",
    padding: 12,
  },
  eventTitle: { color: "white", fontSize: 14, fontWeight: "800" },
  eventMeta: { color: "#93A3D9", fontSize: 12, marginTop: 4 },
});



