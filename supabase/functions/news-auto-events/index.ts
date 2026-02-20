import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type NewsArticle = {
  title?: string;
  description?: string;
  url?: string;
  publishedAt?: string;
  source?: { id?: string | null; name?: string | null };
};

type NewsApiResponse = {
  status: string;
  totalResults?: number;
  articles?: NewsArticle[];
  code?: string;
  message?: string;
};

type RequestBody = {
  query?: string;
  language?: string;
  pageSize?: number;
  fromHours?: number;
  region?: string;
  timezone?: string;
  startOffsetMinutes?: number;
  durationMinutes?: number;
  dryRun?: boolean;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-egregor-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_QUERY =
  "(earthquake OR flood OR wildfire OR hurricane OR cyclone OR tsunami OR conflict OR war OR crisis)";
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_FROM_HOURS = 24;
const DEFAULT_START_OFFSET_MIN = 5;
const DEFAULT_DURATION_MIN = 30;

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
  const clean = input.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
}

function normalizeLanguage(raw: string | undefined) {
  const value = String(raw ?? "en").trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(value)) return "en";
  return value;
}

function normalizeRegion(raw: string | undefined) {
  const value = String(raw ?? "").trim();
  if (!value) return "GLOBAL";
  return clip(value.toUpperCase(), 50);
}

function buildIntention(headline: string) {
  return clip(
    `May safety, healing, and resilient support reach everyone affected by ${headline}.`,
    2000
  );
}

function buildDescription(article: NewsArticle) {
  const sourceName = clip(String(article.source?.name ?? "News source"), 80);
  const headline = clip(String(article.title ?? "Urgent world event"), 240);
  const desc = clip(String(article.description ?? "").trim(), 600);
  const url = String(article.url ?? "").trim();
  const lines = [
    `Auto-generated compassion event from: ${sourceName}.`,
    `Headline: ${headline}.`,
    desc ? `Summary: ${desc}` : "",
    url ? `Source link: ${url}` : "",
  ].filter(Boolean);
  return clip(lines.join(" "), 4000);
}

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildFingerprint(article: NewsArticle) {
  const url = String(article.url ?? "").trim().toLowerCase();
  const title = String(article.title ?? "").trim().toLowerCase();
  const source = String(article.source?.name ?? "").trim().toLowerCase();
  const publishedAt = String(article.publishedAt ?? "").trim().toLowerCase();
  const raw = url || `${source}|${title}|${publishedAt}`;
  const hash = await sha256Hex(raw);
  return `news:${hash}`;
}

async function fetchNewsArticles(args: {
  apiKey: string;
  baseUrl: string;
  query: string;
  language: string;
  pageSize: number;
  fromHours: number;
}) {
  const { apiKey, baseUrl, query, language, pageSize, fromHours } = args;
  const fromIso = new Date(
    Date.now() - Math.max(1, fromHours) * 60 * 60 * 1000
  ).toISOString();

  const params = new URLSearchParams({
    q: query,
    language,
    sortBy: "publishedAt",
    pageSize: String(Math.max(1, Math.min(pageSize, 100))),
    from: fromIso,
    searchIn: "title,description",
  });
  const url = `${baseUrl.replace(/\/+$/, "")}/v2/everything?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { "X-Api-Key": apiKey },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`News API failed (${response.status}): ${clip(body, 400)}`);
  }

  const data = (await response.json()) as NewsApiResponse;
  if (data.status !== "ok") {
    throw new Error(
      `News API returned non-ok status: ${clip(JSON.stringify(data), 400)}`
    );
  }

  return (data.articles ?? []).filter((a) => !!String(a.title ?? "").trim());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  const cronToken = Deno.env.get("NEWS_AUTOGEN_CRON_TOKEN")?.trim() ?? "";
  if (cronToken) {
    const token = req.headers.get("x-egregor-cron-token")?.trim() ?? "";
    if (token !== cronToken) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  const newsApiKey = Deno.env.get("NEWS_API_KEY")?.trim() ?? "";
  const hostUserId = Deno.env.get("NEWS_AUTOGEN_HOST_USER_ID")?.trim() ?? "";
  const defaultTimezone =
    Deno.env.get("NEWS_DEFAULT_TIMEZONE")?.trim() || "UTC";
  const newsApiBaseUrl =
    Deno.env.get("NEWS_API_BASE_URL")?.trim() || "https://newsapi.org";

  if (!supabaseUrl || !serviceRoleKey || !newsApiKey || !hostUserId) {
    return jsonResponse(500, {
      error:
        "Missing required env vars. Expected SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEWS_API_KEY, NEWS_AUTOGEN_HOST_USER_ID.",
    });
  }

  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const query = clip(
    String(body.query ?? DEFAULT_QUERY).trim() || DEFAULT_QUERY,
    500
  );
  const language = normalizeLanguage(body.language);
  const pageSize = Number.isFinite(body.pageSize)
    ? Number(body.pageSize)
    : DEFAULT_PAGE_SIZE;
  const fromHours = Number.isFinite(body.fromHours)
    ? Number(body.fromHours)
    : DEFAULT_FROM_HOURS;
  const startOffsetMinutes = Number.isFinite(body.startOffsetMinutes)
    ? Number(body.startOffsetMinutes)
    : DEFAULT_START_OFFSET_MIN;
  const durationMinutes = Number.isFinite(body.durationMinutes)
    ? Number(body.durationMinutes)
    : DEFAULT_DURATION_MIN;
  const sourceRegion = normalizeRegion(body.region);
  const timezone = String(body.timezone ?? defaultTimezone).trim() || "UTC";
  const dryRun = !!body.dryRun;

  try {
    const articles = await fetchNewsArticles({
      apiKey: newsApiKey,
      baseUrl: newsApiBaseUrl,
      query,
      language,
      pageSize,
      fromHours,
    });

    const startIso = new Date(
      Date.now() + Math.max(0, startOffsetMinutes) * 60_000
    ).toISOString();
    const endIso = new Date(
      new Date(startIso).getTime() + Math.max(5, durationMinutes) * 60_000
    ).toISOString();

    const candidateRows = await Promise.all(
      articles.map(async (article) => {
        const headline = clip(
          String(article.title ?? "Global compassion event").trim(),
          96
        );
        const title = clip(`Compassion Circle: ${headline}`, 120);
        const intention = buildIntention(headline);
        const fingerprint = await buildFingerprint(article);

        return {
          title,
          intention,
          intention_statement: intention,
          description: buildDescription(article),
          host_user_id: hostUserId,
          created_by: hostUserId,
          visibility: "PUBLIC",
          start_time_utc: startIso,
          end_time_utc: endIso,
          starts_at: startIso,
          duration_minutes: Math.max(5, durationMinutes),
          timezone,
          source: "news",
          source_region: sourceRegion,
          source_fingerprint: fingerprint,
        };
      })
    );

    const uniqueByFingerprint = new Map<
      string,
      (typeof candidateRows)[number]
    >();
    for (const row of candidateRows) {
      if (!row.source_fingerprint) continue;
      if (!uniqueByFingerprint.has(row.source_fingerprint)) {
        uniqueByFingerprint.set(row.source_fingerprint, row);
      }
    }
    const dedupedRows = [...uniqueByFingerprint.values()];

    if (dryRun) {
      return jsonResponse(200, {
        ok: true,
        dryRun: true,
        fetchedArticles: articles.length,
        dedupedCandidates: dedupedRows.length,
        preview: dedupedRows.slice(0, 5),
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const fingerprints = dedupedRows.map((r) => r.source_fingerprint);
    const { data: existingRows, error: existingErr } = await supabase
      .from("events")
      .select("source_fingerprint")
      .in("source_fingerprint", fingerprints);

    if (existingErr) {
      return jsonResponse(500, {
        error: `Could not query dedupe fingerprints: ${existingErr.message}`,
      });
    }

    const existing = new Set(
      ((existingRows ?? []) as { source_fingerprint: string | null }[])
        .map((r) => String(r.source_fingerprint ?? ""))
        .filter(Boolean)
    );
    const toInsert = dedupedRows.filter(
      (r) => !existing.has(r.source_fingerprint)
    );

    if (toInsert.length === 0) {
      return jsonResponse(200, {
        ok: true,
        fetchedArticles: articles.length,
        dedupedCandidates: dedupedRows.length,
        inserted: 0,
        skippedAsDuplicate: dedupedRows.length,
      });
    }

    const { error: upsertErr } = await supabase.from("events").upsert(toInsert, {
      onConflict: "source_fingerprint",
      ignoreDuplicates: true,
    });
    if (upsertErr) {
      return jsonResponse(500, { error: `Insert failed: ${upsertErr.message}` });
    }

    const { data: insertedRows, error: insertedErr } = await supabase
      .from("events")
      .select("id,title,source_region,source_fingerprint,start_time_utc")
      .eq("source", "news")
      .in(
        "source_fingerprint",
        toInsert.map((r) => r.source_fingerprint)
      )
      .order("created_at", { ascending: false });

    if (insertedErr) {
      return jsonResponse(200, {
        ok: true,
        fetchedArticles: articles.length,
        dedupedCandidates: dedupedRows.length,
        attemptedInsert: toInsert.length,
        inserted: null,
        warning: `Events inserted but post-insert fetch failed: ${insertedErr.message}`,
      });
    }

    return jsonResponse(200, {
      ok: true,
      fetchedArticles: articles.length,
      dedupedCandidates: dedupedRows.length,
      attemptedInsert: toInsert.length,
      inserted: (insertedRows ?? []).length,
      events: insertedRows ?? [],
    });
  } catch (e) {
    return jsonResponse(500, {
      error: e instanceof Error ? e.message : "Unknown error",
    });
  }
});
