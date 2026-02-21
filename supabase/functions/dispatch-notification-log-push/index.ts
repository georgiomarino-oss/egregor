import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type RequestBody = {
  lookbackMinutes?: number;
  maxRows?: number;
  dryRun?: boolean;
};

type NotificationLogRow = {
  id: string;
  kind: string;
  user_id: string;
  event_id: string | null;
  dedupe_key: string;
  created_at: string;
  title: string | null;
  body: string | null;
  metadata: Record<string, unknown> | null;
  push_sent_at: string | null;
};

type PushTokenRow = {
  user_id: string;
  expo_push_token: string;
};

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  data: Record<string, unknown>;
};

type ExpoPushTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string; [k: string]: unknown };
};

type DeliveryTarget = {
  rowId: string;
  userId: string;
  token: string;
  message: ExpoPushMessage;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-egregor-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_LOOKBACK_MINUTES = 180;
const DEFAULT_MAX_ROWS = 300;
const DB_IN_CHUNK = 200;
const EXPO_MAX_BATCH = 100;
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const PUSHABLE_KINDS = new Set([
  "live_soon",
  "live_now",
  "journal_shared",
  "news_alert",
  "streak_reminder",
]);

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

function safeInt(input: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function chunk<T>(arr: T[], size: number) {
  const next: T[][] = [];
  for (let i = 0; i < arr.length; i += size) next.push(arr.slice(i, i + size));
  return next;
}

function isExpoPushToken(token: string) {
  return /^ExponentPushToken\[[^\]]+\]$/.test(token) || /^ExpoPushToken\[[^\]]+\]$/.test(token);
}

function fallbackTitle(kind: string) {
  if (kind === "live_now") return "Event is live now";
  if (kind === "live_soon") return "Event starts soon";
  if (kind === "news_alert") return "Compassion alert event available";
  if (kind === "journal_shared") return "New anonymous manifestation shared";
  if (kind === "streak_reminder") return "Keep your streak alive";
  return "New notification";
}

function fallbackBody(kind: string) {
  if (kind === "live_now") return "Join now to sync with the active circle.";
  if (kind === "live_soon") return "Tap to open the room before the session begins.";
  if (kind === "news_alert") return "A new crisis-support prayer circle is available. Tap to join.";
  if (kind === "journal_shared") return "A new shared manifestation has been added to the community feed.";
  if (kind === "streak_reminder") return "Join one live circle today to keep your momentum.";
  return "Open Egregor to view details.";
}

function kindToType(kind: string) {
  if (kind === "live_now") return "event_live_now";
  if (kind === "live_soon") return "event_live_soon";
  if (kind === "news_alert") return "event_news_alert";
  if (kind === "journal_shared") return "community_journal";
  if (kind === "streak_reminder") return "streak_reminder";
  return "general";
}

async function sendExpoPushBatch(batch: DeliveryTarget[]) {
  if (batch.length === 0) {
    return {
      successTargets: [] as DeliveryTarget[],
      failed: 0,
      invalidTokens: new Set<string>(),
    };
  }

  const response = await fetch(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(batch.map((target) => target.message)),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Expo push API failed (${response.status}): ${clip(raw, 400)}`);
  }

  const body = (await response.json().catch(() => ({}))) as {
    data?: ExpoPushTicket[];
    errors?: unknown[];
  };
  const tickets = Array.isArray(body.data) ? body.data : [];

  const successTargets: DeliveryTarget[] = [];
  const invalidTokens = new Set<string>();
  let failed = 0;

  for (let i = 0; i < batch.length; i += 1) {
    const target = batch[i];
    const ticket = tickets[i] ?? {};
    const status = String(ticket.status ?? "").toLowerCase();
    if (status === "ok") {
      successTargets.push(target);
      continue;
    }

    failed += 1;
    const detailErr = String(ticket.details?.error ?? "");
    if (detailErr === "DeviceNotRegistered") invalidTokens.add(target.token);
  }

  return { successTargets, failed, invalidTokens };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed. Use POST." });

  const cronToken = Deno.env.get("NOTIFICATION_PUSH_CRON_TOKEN")?.trim() ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  if (cronToken) {
    const token = req.headers.get("x-egregor-cron-token")?.trim() ?? "";
    const apikey = req.headers.get("apikey")?.trim() ?? "";
    const authHeader = req.headers.get("authorization")?.trim() ?? "";
    const bearer =
      authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

    const tokenOk = token === cronToken;
    const schedulerAuthOk = !!anonKey && apikey === anonKey && bearer === anonKey;
    if (!tokenOk && !schedulerAuthOk) return jsonResponse(401, { error: "Unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      error: "Missing required env vars. Expected SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const lookbackMinutes = safeInt(body.lookbackMinutes, DEFAULT_LOOKBACK_MINUTES, 5, 1440);
  const maxRows = safeInt(body.maxRows, DEFAULT_MAX_ROWS, 1, 1000);
  const dryRun = !!body.dryRun;
  const sinceIso = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();

  try {
    const { data: rowsData, error: rowsErr } = await supabase
      .from("notification_log")
      .select("id,kind,user_id,event_id,dedupe_key,created_at,title,body,metadata,push_sent_at")
      .is("push_sent_at", null)
      .in("kind", [...PUSHABLE_KINDS])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(maxRows);

    if (rowsErr) {
      return jsonResponse(500, { error: `Could not query notification_log: ${rowsErr.message}` });
    }

    const rows = (rowsData ?? []) as NotificationLogRow[];
    if (rows.length === 0) {
      return jsonResponse(200, {
        ok: true,
        lookbackMinutes,
        maxRows,
        pendingRows: 0,
        pushTargets: 0,
        sentRows: 0,
        failed: 0,
        note: "No pending notification rows matched.",
      });
    }

    const candidateUserIds = Array.from(
      new Set(rows.map((r) => String(r.user_id ?? "").trim()).filter(Boolean))
    );

    const tokenRows: PushTokenRow[] = [];
    for (const idsChunk of chunk(candidateUserIds, DB_IN_CHUNK)) {
      if (idsChunk.length === 0) continue;
      const { data, error } = await supabase
        .from("user_push_tokens")
        .select("user_id,expo_push_token")
        .in("user_id", idsChunk);
      if (error) {
        return jsonResponse(500, { error: `Could not query user_push_tokens: ${error.message}` });
      }
      tokenRows.push(...((data ?? []) as PushTokenRow[]));
    }

    const tokensByUserId = new Map<string, Set<string>>();
    for (const row of tokenRows) {
      const userId = String(row.user_id ?? "").trim();
      const token = String(row.expo_push_token ?? "").trim();
      if (!userId || !token || !isExpoPushToken(token)) continue;
      const set = tokensByUserId.get(userId) ?? new Set<string>();
      set.add(token);
      tokensByUserId.set(userId, set);
    }

    const noTokenRowIds = new Set<string>();
    const targets: DeliveryTarget[] = [];

    for (const row of rows) {
      const rowId = String(row.id ?? "").trim();
      const userId = String(row.user_id ?? "").trim();
      const kind = String(row.kind ?? "").trim().toLowerCase();
      if (!rowId || !userId || !PUSHABLE_KINDS.has(kind)) continue;

      const tokens = tokensByUserId.get(userId);
      if (!tokens || tokens.size === 0) {
        noTokenRowIds.add(rowId);
        continue;
      }

      const eventId = String(row.event_id ?? "").trim();
      const title = clip(String(row.title ?? "").trim() || fallbackTitle(kind), 140);
      const messageBody = clip(String(row.body ?? "").trim() || fallbackBody(kind), 280);
      const metadata =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {};

      for (const token of tokens) {
        targets.push({
          rowId,
          userId,
          token,
          message: {
            to: token,
            title,
            body: messageBody,
            sound: "default",
            data: {
              type: kindToType(kind),
              kind,
              eventId,
              notificationId: rowId,
              dedupeKey: String(row.dedupe_key ?? ""),
              ...metadata,
            },
          },
        });
      }
    }

    if (dryRun) {
      return jsonResponse(200, {
        ok: true,
        dryRun: true,
        lookbackMinutes,
        maxRows,
        pendingRows: rows.length,
        noTokenRows: noTokenRowIds.size,
        pushTargets: targets.length,
        preview: targets.slice(0, 10).map((t) => ({
          rowId: t.rowId,
          userId: t.userId,
          title: t.message.title,
          body: t.message.body,
          eventId: t.message.data.eventId ?? null,
          kind: t.message.data.kind ?? null,
        })),
      });
    }

    const successRowIds = new Set<string>();
    const invalidTokens = new Set<string>();
    let failed = 0;

    for (const batch of chunk(targets, EXPO_MAX_BATCH)) {
      const { successTargets, failed: failedCount, invalidTokens: batchInvalidTokens } =
        await sendExpoPushBatch(batch);
      failed += failedCount;
      for (const target of successTargets) successRowIds.add(target.rowId);
      for (const token of batchInvalidTokens) invalidTokens.add(token);
    }

    if (invalidTokens.size > 0) {
      await supabase
        .from("user_push_tokens")
        .delete()
        .in("expo_push_token", [...invalidTokens]);
    }

    const rowsToMarkSent = Array.from(new Set([...successRowIds, ...noTokenRowIds]));
    for (const idsChunk of chunk(rowsToMarkSent, DB_IN_CHUNK)) {
      if (idsChunk.length === 0) continue;
      const { error: updateErr } = await supabase
        .from("notification_log")
        .update({ push_sent_at: new Date().toISOString() })
        .is("push_sent_at", null)
        .in("id", idsChunk);
      if (updateErr) {
        return jsonResponse(500, {
          error: `Push dispatched, but could not update notification_log.push_sent_at: ${updateErr.message}`,
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      lookbackMinutes,
      maxRows,
      pendingRows: rows.length,
      noTokenRows: noTokenRowIds.size,
      pushTargets: targets.length,
      sentRows: successRowIds.size,
      markedSentRows: rowsToMarkSent.length,
      failed,
      invalidTokensRemoved: invalidTokens.size,
    });
  } catch (e) {
    return jsonResponse(500, {
      error: e instanceof Error ? e.message : "Unknown error",
    });
  }
});
