import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type RequestBody = {
  mode?: "event" | "solo" | "solo_voice";
  intention?: string;
  durationMinutes?: number;
  tone?: string;
  language?: string;
  title?: string;
  lines?: unknown;
  voice?: string;
  speechRate?: number;
  style?: string;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_MODEL = "gpt-4.1-mini";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function clip(input: string, max: number) {
  const clean = String(input ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
}

function safeText(value: unknown, fallback = "") {
  const next = String(value ?? "").replace(/\s+/g, " ").trim();
  return next || fallback;
}

function clampMinutes(value: unknown, fallback = 20) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(240, Math.round(n)));
}

function clampSpeechRate(value: unknown, fallback = 0.85) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0.65, Math.min(1.2, n));
}

function parseJsonObject(text: string) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function concatByteArrays(parts: Uint8Array[]) {
  const total = parts.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of parts) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function chunkSpeechLines(lines: string[], maxChars: number) {
  const chunks: string[] = [];
  let current = "";
  for (const raw of lines) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    const next = current ? `${current}\n\n${line}` : line;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (line.length <= maxChars) {
      current = line;
      continue;
    }

    let start = 0;
    while (start < line.length) {
      const slice = line.slice(start, start + maxChars).trim();
      if (slice) chunks.push(slice);
      start += maxChars;
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks;
}

function fallbackEventPayload(args: {
  intention: string;
  durationMinutes: number;
  tone: string;
  language: string;
}) {
  const intention = safeText(args.intention, "Collective healing, clarity, and peace.");
  const durationMinutes = clampMinutes(args.durationMinutes, 20);
  const tone = safeText(args.tone, "calm").toLowerCase();
  const language = safeText(args.language, "English");

  const arrival = Math.max(1, Math.round(durationMinutes * 0.2));
  const focus = Math.max(1, Math.round(durationMinutes * 0.35));
  const integration = Math.max(1, durationMinutes - arrival - focus);

  return {
    title: clip(`${intention} Script`, 120),
    intention,
    durationMinutes,
    tone,
    language,
    sections: [
      {
        name: "Arrival",
        minutes: arrival,
        text: `Arrive with a ${tone} rhythm, steady breath, and shared focus.`,
      },
      {
        name: "Intention",
        minutes: focus,
        text: intention,
      },
      {
        name: "Integration",
        minutes: integration,
        text: "Hold the intention as one field, with gratitude and grounded presence.",
      },
    ],
    speakerNotes:
      "Use slow pacing, leave gentle pauses, and keep transitions smooth so the group moves as one.",
  };
}

function fallbackSoloPayload(args: {
  intention: string;
  tone: string;
  language: string;
}) {
  const intention = safeText(args.intention, "peace and healing");
  const tone = safeText(args.tone, "calm");
  const language = safeText(args.language, "English");

  const lead =
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
      `${lead} slowly and hold ${intention} in your awareness.`,
      `${lead} in steadiness, breathe out tension, and keep a ${tone} pace.`,
      "Feel yourself connected to the wider field of care, support, and healing.",
      "Close with gratitude for what is already shifting through collective intention.",
    ],
  };
}

function normalizeEventPayload(parsed: any, fallback: any) {
  const sections = Array.isArray(parsed?.sections)
    ? parsed.sections
        .map((section: any, idx: number) => ({
          name: safeText(section?.name, `Section ${idx + 1}`),
          minutes: clampMinutes(section?.minutes, 1),
          text: safeText(section?.text, fallback.intention),
        }))
        .filter((section: any) => section.text.length > 0)
        .slice(0, 8)
    : [];

  return {
    title: clip(safeText(parsed?.title, fallback.title), 120),
    intention: clip(safeText(parsed?.intention, fallback.intention), 2000),
    durationMinutes: clampMinutes(parsed?.durationMinutes, fallback.durationMinutes),
    tone: clip(safeText(parsed?.tone, fallback.tone).toLowerCase(), 40),
    language: clip(safeText(parsed?.language, fallback.language), 40),
    sections: sections.length ? sections : fallback.sections,
    speakerNotes: clip(
      safeText(parsed?.speakerNotes, fallback.speakerNotes),
      1000
    ),
  };
}

function normalizeSoloPayload(parsed: any, fallback: any) {
  const lines = Array.isArray(parsed?.lines)
    ? parsed.lines
        .map((line: any) => clip(safeText(line, ""), 180))
        .filter((line: string) => !!line)
        .slice(0, 8)
    : [];

  return {
    title: clip(safeText(parsed?.title, fallback.title), 120),
    lines: lines.length ? lines : fallback.lines,
  };
}

async function requireAuthenticatedUser(req: Request) {
  const requireAuth = String(Deno.env.get("AI_GENERATION_REQUIRE_AUTH") ?? "1") !== "0";
  if (!requireAuth) return { ok: true as const };

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const anonKey = String(Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  const authHeader = String(req.headers.get("authorization") ?? "").trim();

  if (!supabaseUrl || !anonKey) {
    return { ok: false as const, status: 500, error: "Supabase env is not configured." };
  }
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false as const, status: 401, error: "Missing bearer token." };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user) {
    return { ok: false as const, status: 401, error: "Unauthorized." };
  }

  return { ok: true as const, userId: data.user.id };
}

function buildSystemPrompt(mode: "event" | "solo") {
  if (mode === "solo") {
    return [
      "You are Egregor's spiritual guidance writer.",
      "Voice: grounded, inclusive, uplifting, and practical.",
      "Use Egregor language of collective intention in action.",
      "Never mention AI, models, prompts, fallback, or backend systems.",
      "Return JSON only.",
      "Schema:",
      '{ "title": string, "lines": string[] }',
      "Output 4 to 8 short lines.",
      "No markdown, no prose outside JSON.",
    ].join(" ");
  }
  return [
    "You are Egregor's spiritual guidance writer for synchronized group practice.",
    "Voice: grounded, inclusive, uplifting, and practical.",
    "Use Egregor language of collective intention in action.",
    "Never mention AI, models, prompts, fallback, or backend systems.",
    "Return JSON only.",
    "Schema:",
    '{ "title": string, "intention": string, "durationMinutes": number, "tone": string, "language": string, "sections": [{ "name": string, "minutes": number, "text": string }], "speakerNotes": string }',
    "Use 3 to 6 sections and make total section minutes approximately durationMinutes.",
    "No markdown, no prose outside JSON.",
  ].join(" ");
}

function buildUserPrompt(input: {
  mode: "event" | "solo";
  intention: string;
  durationMinutes: number;
  tone: string;
  language: string;
}) {
  return [
    `Mode: ${input.mode}`,
    `Intention: ${input.intention}`,
    `DurationMinutes: ${input.durationMinutes}`,
    `Tone: ${input.tone}`,
    `Language: ${input.language}`,
    "Keep language spiritually warm, practical, and easy to read aloud.",
    "Write in Egregor's tone: collective intention, coherence, compassion, and grounded action.",
  ].join("\n");
}

async function generateWithOpenAI(input: {
  mode: "event" | "solo";
  intention: string;
  durationMinutes: number;
  tone: string;
  language: string;
}) {
  const apiKey = String(Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = String(Deno.env.get("OPENAI_MODEL") ?? "").trim() || DEFAULT_MODEL;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(input.mode) },
        { role: "user", content: buildUserPrompt(input) },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${clip(body, 400)}`);
  }

  const json = (await response.json().catch(() => ({}))) as any;
  const content = String(json?.choices?.[0]?.message?.content ?? "").trim();
  const parsed = parseJsonObject(content);
  if (!parsed) {
    throw new Error("OpenAI response did not contain valid JSON.");
  }
  return parsed;
}

async function generateSoloVoiceWithOpenAI(input: {
  title: string;
  intention: string;
  lines: string[];
  tone: string;
  language: string;
  voice?: string;
  speechRate: number;
  style: string;
}) {
  const apiKey = String(Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const requestedModel = String(Deno.env.get("OPENAI_TTS_MODEL") ?? "").trim();
  const modelCandidates = [
    requestedModel || "gpt-4o-mini-tts",
    "gpt-4o-mini-tts",
    "tts-1-hd",
    "tts-1",
  ].filter((value, idx, arr) => !!value && arr.indexOf(value) === idx);
  const voice = clip(safeText(input.voice, String(Deno.env.get("OPENAI_TTS_VOICE") ?? "alloy")), 40);
  const scriptLines = input.lines
    .map((line) => clip(safeText(line, ""), 260))
    .filter((line) => !!line)
    .slice(0, 140);
  const fallbackLine = `I hold this prayer for ${input.intention}. I breathe in peace, and I release fear with trust.`;
  const spokenChunks = chunkSpeechLines(
    scriptLines.length ? scriptLines : [fallbackLine],
    1200
  ).slice(0, 32);
  if (!spokenChunks.length) {
    throw new Error("No script lines were available for speech generation.");
  }

  const errors: string[] = [];
  for (const model of modelCandidates) {
    const chunksAudio: Uint8Array[] = [];
    let mimeType = "audio/mpeg";
    let modelFailed = false;

    for (const chunk of spokenChunks) {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          voice,
          response_format: "mp3",
          speed: input.speechRate,
          ...(model.includes("gpt-4o-mini-tts") && input.style
            ? { instructions: input.style }
            : {}),
          input: chunk,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        errors.push(`${model}: ${response.status} ${clip(body, 220)}`);
        modelFailed = true;
        break;
      }

      const audioBytes = new Uint8Array(await response.arrayBuffer());
      if (!audioBytes.length) {
        errors.push(`${model}: empty audio response`);
        modelFailed = true;
        break;
      }
      mimeType = String(response.headers.get("content-type") ?? "audio/mpeg").trim() || "audio/mpeg";
      chunksAudio.push(audioBytes);
    }

    if (modelFailed || !chunksAudio.length) {
      continue;
    }

    return {
      audioBase64: bytesToBase64(concatByteArrays(chunksAudio)),
      mimeType,
    };
  }

  throw new Error(`OpenAI speech request failed. ${clip(errors.join(" | "), 700)}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const modeRaw = safeText(body.mode, "event").toLowerCase();
  const mode: "event" | "solo" | "solo_voice" =
    modeRaw === "solo_voice" ? "solo_voice" : modeRaw === "solo" ? "solo" : "event";

  if (mode !== "solo_voice") {
    const auth = await requireAuthenticatedUser(req);
    if (!auth.ok) {
      return jsonResponse(auth.status, { error: auth.error });
    }
  }

  const intention = clip(
    safeText(body.intention, "Collective peace and healing."),
    2000
  );
  const durationMinutes = clampMinutes(body.durationMinutes, mode === "event" ? 20 : 5);
  const tone = clip(safeText(body.tone, "calm").toLowerCase(), 40);
  const language = clip(safeText(body.language, "English"), 40);

  if (mode === "solo") {
    const fallback = fallbackSoloPayload({ intention, tone, language });
    try {
      const parsed = await generateWithOpenAI({
        mode,
        intention,
        durationMinutes,
        tone,
        language,
      });
      const payload = normalizeSoloPayload(parsed, fallback);
      return jsonResponse(200, {
        ok: true,
        source: "openai",
        payload,
      });
    } catch (e) {
      return jsonResponse(200, {
        ok: true,
        source: "fallback",
        payload: fallback,
        warning: e instanceof Error ? e.message : "OpenAI generation failed.",
      });
    }
  }

  if (mode === "solo_voice") {
    const title = clip(safeText(body.title, "Solo Guided Prayer"), 120);
    const lines = Array.isArray(body.lines)
      ? body.lines
          .map((line) => clip(safeText(line, ""), 220))
          .filter((line: string) => !!line)
          .slice(0, 140)
      : [];
    const speechRate = clampSpeechRate(body.speechRate, 0.85);
    const style = clip(
      safeText(
        body.style,
        "Speak slowly, calmly, and intentionally with gentle pauses between phrases. Keep a warm spiritual tone."
      ),
      320
    );

    try {
      const payload = await generateSoloVoiceWithOpenAI({
        title,
        intention,
        lines,
        tone,
        language,
        voice: safeText(body.voice, ""),
        speechRate,
        style,
      });
      return jsonResponse(200, {
        ok: true,
        source: "openai",
        payload,
      });
    } catch (e) {
      return jsonResponse(200, {
        ok: true,
        source: "fallback",
        payload: {
          audioBase64: "",
          mimeType: "audio/mpeg",
        },
        warning: e instanceof Error ? e.message : "OpenAI speech generation failed.",
      });
    }
  }

  const fallback = fallbackEventPayload({
    intention,
    durationMinutes,
    tone,
    language,
  });
  try {
    const parsed = await generateWithOpenAI({
      mode,
      intention,
      durationMinutes,
      tone,
      language,
    });
    const payload = normalizeEventPayload(parsed, fallback);
    return jsonResponse(200, {
      ok: true,
      source: "openai",
      payload,
    });
  } catch (e) {
    return jsonResponse(200, {
      ok: true,
      source: "fallback",
      payload: fallback,
      warning: e instanceof Error ? e.message : "OpenAI generation failed.",
    });
  }
});
