import { supabase } from "../../supabase/client";

export type AiGenerationMode = "event_script" | "solo_guidance";

export type AiQuotaResult = {
  allowed: boolean;
  isPremium: boolean;
  usedToday: number;
  limit: number | null;
  remaining: number | null;
};

export type EventScriptSection = {
  name: string;
  minutes: number;
  text: string;
};

export type GeneratedEventScript = {
  title: string;
  intention: string;
  durationMinutes: number;
  tone: string;
  language: string;
  sections: EventScriptSection[];
  speakerNotes?: string;
  source: "openai" | "fallback";
};

export type GeneratedSoloGuidance = {
  title: string;
  lines: string[];
  source: "openai" | "fallback";
};

type GenerateFunctionResponse = {
  ok?: boolean;
  source?: string;
  payload?: any;
  error?: string;
};

type QuotaRpcRow = {
  is_premium?: boolean | null;
  used_today?: number | null;
  limit_daily?: number | null;
  remaining?: number | null;
  allowed?: boolean | null;
};

const FREE_DAILY_LIMITS: Record<AiGenerationMode, number> = {
  event_script: 3,
  solo_guidance: 2,
};
const SOLO_LINE_LIMIT = 8;
const SOLO_LINE_MAX_CHARS = 180;

function safeText(value: unknown, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function clampMinutes(value: unknown, fallback = 20) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(240, Math.round(n)));
}

function normalizeMode(mode: AiGenerationMode) {
  return mode === "solo_guidance" ? "solo" : "event";
}

function buildQuotaResult(args: {
  isPremium: boolean;
  usedToday: number;
  mode: AiGenerationMode;
}): AiQuotaResult {
  const { isPremium, usedToday, mode } = args;
  if (isPremium) {
    return {
      allowed: true,
      isPremium: true,
      usedToday,
      limit: null,
      remaining: null,
    };
  }
  const limit = FREE_DAILY_LIMITS[mode];
  const remaining = Math.max(0, limit - usedToday);
  return {
    allowed: usedToday < limit,
    isPremium: false,
    usedToday,
    limit,
    remaining,
  };
}

function mapQuotaRowToResult(row: QuotaRpcRow | null, mode: AiGenerationMode): AiQuotaResult {
  if (!row || typeof row !== "object") {
    return buildQuotaResult({ isPremium: false, usedToday: 0, mode });
  }
  const isPremium = !!row.is_premium;
  const usedToday = Math.max(0, Number(row.used_today ?? 0) || 0);
  const limit = row.limit_daily === null || row.limit_daily === undefined
    ? null
    : Math.max(0, Number(row.limit_daily) || 0);
  const remaining = row.remaining === null || row.remaining === undefined
    ? null
    : Math.max(0, Number(row.remaining) || 0);

  return {
    isPremium,
    usedToday,
    limit,
    remaining,
    allowed: row.allowed !== false,
  };
}

async function invokeQuotaRpc(fn: "get_ai_generation_quota" | "consume_ai_generation_quota", mode: AiGenerationMode) {
  const { data, error } = await supabase.rpc(fn, { p_mode: mode });
  if (error) throw new Error(error.message || `${fn} failed`);
  const rows = Array.isArray(data) ? (data as QuotaRpcRow[]) : [];
  return mapQuotaRowToResult(rows[0] ?? null, mode);
}

export async function getAiQuotaSnapshot(args: {
  userId: string;
  mode: AiGenerationMode;
  isPremium: boolean;
}) {
  if (!args.userId.trim()) {
    return buildQuotaResult({ isPremium: args.isPremium, usedToday: 0, mode: args.mode });
  }

  try {
    return await invokeQuotaRpc("get_ai_generation_quota", args.mode);
  } catch {
    return buildQuotaResult({
      isPremium: args.isPremium,
      usedToday: 0,
      mode: args.mode,
    });
  }
}

export async function consumeAiGenerationQuota(args: {
  userId: string;
  mode: AiGenerationMode;
  isPremium: boolean;
}): Promise<AiQuotaResult> {
  const userId = args.userId.trim();
  if (!userId) {
    return {
      allowed: false,
      isPremium: args.isPremium,
      usedToday: 0,
      limit: args.isPremium ? null : FREE_DAILY_LIMITS[args.mode],
      remaining: args.isPremium ? null : FREE_DAILY_LIMITS[args.mode],
    };
  }

  try {
    return await invokeQuotaRpc("consume_ai_generation_quota", args.mode);
  } catch {
    if (args.isPremium) {
      return {
        allowed: true,
        isPremium: true,
        usedToday: 0,
        limit: null,
        remaining: null,
      };
    }
    return {
      allowed: false,
      isPremium: false,
      usedToday: 0,
      limit: FREE_DAILY_LIMITS[args.mode],
      remaining: 0,
    };
  }
}

function fallbackEventScript(args: {
  intention: string;
  durationMinutes: number;
  tone: string;
  language: string;
}): GeneratedEventScript {
  const intention = safeText(args.intention, "Collective peace and clarity.");
  const tone = safeText(args.tone, "calm").toLowerCase();
  const language = safeText(args.language, "English");
  const durationMinutes = clampMinutes(args.durationMinutes, 20);

  const arrival = Math.max(1, Math.round(durationMinutes * 0.2));
  const intentionMinutes = Math.max(1, Math.round(durationMinutes * 0.3));
  const integration = Math.max(
    1,
    durationMinutes - arrival - intentionMinutes
  );

  return {
    title: `${safeText(intention, "Guided Prayer").slice(0, 50)} Script`,
    intention,
    durationMinutes,
    tone,
    language,
    sections: [
      {
        name: "Arrival",
        minutes: arrival,
        text: `Breathe in and arrive with a ${tone} rhythm.`,
      },
      {
        name: "Intention",
        minutes: intentionMinutes,
        text: intention,
      },
      {
        name: "Integration",
        minutes: integration,
        text: "Hold this intention with gratitude and grounded focus.",
      },
    ],
    speakerNotes:
      "Speak slowly, pause between lines, and keep the pacing steady for group synchronization.",
    source: "fallback",
  };
}

function fallbackSoloGuidance(args: {
  intention: string;
  tone: string;
  language: string;
}): GeneratedSoloGuidance {
  const intention = safeText(args.intention, "peace and healing");
  const tone = safeText(args.tone, "calm");
  const language = safeText(args.language, "English");

  const prefix =
    language.toLowerCase().startsWith("span")
      ? "Respira"
      : language.toLowerCase().startsWith("port")
        ? "Respire"
        : language.toLowerCase().startsWith("fren")
          ? "Respirez"
          : "Breathe";

  return {
    title: "Solo Guided Prayer",
    lines: [
      `${prefix} slowly and hold ${intention} in your heart.`,
      `${prefix} in steadiness, breathe out tension, and keep a ${tone} pace.`,
      "Visualize support, healing, and clarity surrounding this intention.",
      "Close with gratitude for what is already shifting.",
    ],
    source: "fallback",
  };
}

async function invokeGenerateFunction(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("generate-prayer-script", {
    body: payload,
  });
  if (error) {
    throw new Error(error.message || "AI generation failed.");
  }
  return (data ?? {}) as GenerateFunctionResponse;
}

export async function generateEventPrayerScript(args: {
  intention: string;
  durationMinutes: number;
  tone: string;
  language: string;
}): Promise<GeneratedEventScript> {
  const fallback = fallbackEventScript(args);
  try {
    const data = await invokeGenerateFunction({
      mode: normalizeMode("event_script"),
      intention: args.intention,
      durationMinutes: clampMinutes(args.durationMinutes, 20),
      tone: safeText(args.tone, "calm"),
      language: safeText(args.language, "English"),
    });

    const payload = data?.payload ?? {};
    const title = safeText(payload?.title, fallback.title);
    const intention = safeText(payload?.intention, fallback.intention);
    const durationMinutes = clampMinutes(payload?.durationMinutes, fallback.durationMinutes);
    const tone = safeText(payload?.tone, fallback.tone);
    const language = safeText(payload?.language, fallback.language);
    const sectionsRaw = Array.isArray(payload?.sections) ? payload.sections : [];
    const sections = sectionsRaw
      .map((section: any, idx: number) => ({
        name: safeText(section?.name, `Section ${idx + 1}`),
        minutes: clampMinutes(section?.minutes, 1),
        text: safeText(section?.text, intention),
      }))
      .filter((s: EventScriptSection) => s.text.length > 0)
      .slice(0, 8);

    if (sections.length === 0) return fallback;

    return {
      title,
      intention,
      durationMinutes,
      tone,
      language,
      sections,
      speakerNotes: safeText(payload?.speakerNotes, "") || undefined,
      source: data?.source === "openai" ? "openai" : "fallback",
    };
  } catch {
    return fallback;
  }
}

export async function generateSoloGuidance(args: {
  intention: string;
  durationMinutes: number;
  tone: string;
  language: string;
}): Promise<GeneratedSoloGuidance> {
  const fallback = fallbackSoloGuidance(args);
  try {
    const data = await invokeGenerateFunction({
      mode: normalizeMode("solo_guidance"),
      intention: args.intention,
      durationMinutes: clampMinutes(args.durationMinutes, 5),
      tone: safeText(args.tone, "calm"),
      language: safeText(args.language, "English"),
    });
    const payload = data?.payload ?? {};
    const rawLines = Array.isArray(payload?.lines) ? payload.lines : [];
    const lines = rawLines
      .map((line: any) => safeText(line, ""))
      .filter((line: string) => !!line)
      .map((line: string) =>
        line.length <= SOLO_LINE_MAX_CHARS ? line : `${line.slice(0, SOLO_LINE_MAX_CHARS - 1)}...`
      )
      .slice(0, SOLO_LINE_LIMIT);

    if (lines.length === 0) return fallback;

    return {
      title: safeText(payload?.title, "Solo Guided Prayer"),
      lines,
      source: data?.source === "openai" ? "openai" : "fallback",
    };
  } catch {
    return fallback;
  }
}
