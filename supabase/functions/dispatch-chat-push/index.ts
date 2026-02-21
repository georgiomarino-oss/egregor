import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type RequestBody = {
  lookbackMinutes?: number;
  maxMessages?: number;
  activeWindowMs?: number;
  dryRun?: boolean;
};

type EventMessageRow = {
  id: string;
  event_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

type EventPresenceRow = {
  event_id: string;
  user_id: string;
  last_seen_at: string | null;
};

type EventTitleRow = {
  id: string;
  title: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

type PushTokenRow = {
  user_id: string;
  expo_push_token: string;
};

type NotificationLogRow = {
  dedupe_key: string;
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
  dedupeKey: string;
  eventId: string;
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

const DEFAULT_LOOKBACK_MINUTES = 20;
const DEFAULT_MAX_MESSAGES = 100;
const DEFAULT_ACTIVE_WINDOW_MS = 90_000;
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_MAX_BATCH = 100;
const DB_IN_CHUNK = 200;

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
  for (let i = 0; i < arr.length; i += size) {
    next.push(arr.slice(i, i + size));
  }
  return next;
}

function hasRecentPresence(
  lastSeenAtIso: string | null,
  activeWindowMs: number
): boolean {
  const ts = new Date(String(lastSeenAtIso ?? "")).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= activeWindowMs;
}

function isExpoPushToken(token: string) {
  return /^ExponentPushToken\[[^\]]+\]$/.test(token) || /^ExpoPushToken\[[^\]]+\]$/.test(token);
}

function coerceDisplayName(value: string | null | undefined, fallback: string) {
  const name = clip(String(value ?? "").trim(), 40);
  return name || fallback;
}

function buildMessageBody(senderName: string, body: string) {
  const content = clip(body, 120);
  if (!content) return `${senderName} sent a message in your circle.`;
  return `${senderName}: ${content}`;
}

async function fetchExistingDedupeKeys(
  supabase: ReturnType<typeof createClient>,
  dedupeKeys: string[]
) {
  const existing = new Set<string>();
  if (dedupeKeys.length === 0) return existing;

  const keyChunks = chunk(dedupeKeys, DB_IN_CHUNK);
  for (const keys of keyChunks) {
    const { data, error } = await supabase
      .from("notification_log")
      .select("dedupe_key")
      .eq("kind", "chat")
      .in("dedupe_key", keys);

    if (error) {
      throw new Error(`Could not query notification_log: ${error.message}`);
    }

    for (const row of (data ?? []) as NotificationLogRow[]) {
      const k = String(row.dedupe_key ?? "").trim();
      if (k) existing.add(k);
    }
  }

  return existing;
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
    if (detailErr === "DeviceNotRegistered") {
      invalidTokens.add(target.token);
    }
  }

  return { successTargets, failed, invalidTokens };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  const cronToken = Deno.env.get("CHAT_PUSH_CRON_TOKEN")?.trim() ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  if (cronToken) {
    const token = req.headers.get("x-egregor-cron-token")?.trim() ?? "";
    const apikey = req.headers.get("apikey")?.trim() ?? "";
    const authHeader = req.headers.get("authorization")?.trim() ?? "";
    const bearer =
      authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";

    const tokenOk = token === cronToken;
    const schedulerAuthOk = !!anonKey && apikey === anonKey && bearer === anonKey;
    if (!tokenOk && !schedulerAuthOk) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      error:
        "Missing required env vars. Expected SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const lookbackMinutes = safeInt(
    body.lookbackMinutes,
    DEFAULT_LOOKBACK_MINUTES,
    1,
    180
  );
  const maxMessages = safeInt(body.maxMessages, DEFAULT_MAX_MESSAGES, 1, 200);
  const activeWindowMs = safeInt(
    body.activeWindowMs,
    DEFAULT_ACTIVE_WINDOW_MS,
    30_000,
    900_000
  );
  const dryRun = !!body.dryRun;
  const sinceIso = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();

  try {
    const { data: messageRows, error: messageErr } = await supabase
      .from("event_messages")
      .select("id,event_id,user_id,body,created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(maxMessages);

    if (messageErr) {
      return jsonResponse(500, {
        error: `Could not query event_messages: ${messageErr.message}`,
      });
    }

    const messages = (messageRows ?? []) as EventMessageRow[];
    if (messages.length === 0) {
      return jsonResponse(200, {
        ok: true,
        lookbackMinutes,
        maxMessages,
        matchedMessages: 0,
        pushTargets: 0,
        sent: 0,
        failed: 0,
        note: "No recent messages matched.",
      });
    }

    const eventIds = Array.from(new Set(messages.map((m) => String(m.event_id)).filter(Boolean)));
    const senderIds = Array.from(new Set(messages.map((m) => String(m.user_id)).filter(Boolean)));

    const [{ data: eventRows, error: eventErr }, { data: presenceRows, error: presenceErr }, { data: profileRows, error: profileErr }] =
      await Promise.all([
        supabase.from("events").select("id,title").in("id", eventIds),
        supabase
          .from("event_presence")
          .select("event_id,user_id,last_seen_at")
          .in("event_id", eventIds),
        supabase.from("profiles").select("id,display_name").in("id", senderIds),
      ]);

    if (eventErr) {
      return jsonResponse(500, { error: `Could not query events: ${eventErr.message}` });
    }
    if (presenceErr) {
      return jsonResponse(500, {
        error: `Could not query event_presence: ${presenceErr.message}`,
      });
    }
    if (profileErr) {
      return jsonResponse(500, {
        error: `Could not query profiles: ${profileErr.message}`,
      });
    }

    const eventTitleById = new Map<string, string>();
    for (const row of (eventRows ?? []) as EventTitleRow[]) {
      eventTitleById.set(String(row.id), clip(String(row.title ?? "Live circle"), 80));
    }

    const senderNameById = new Map<string, string>();
    for (const row of (profileRows ?? []) as ProfileRow[]) {
      senderNameById.set(
        String(row.id),
        coerceDisplayName(row.display_name, "Someone")
      );
    }

    const activeUsersByEventId = new Map<string, Set<string>>();
    for (const row of (presenceRows ?? []) as EventPresenceRow[]) {
      if (!hasRecentPresence(row.last_seen_at, activeWindowMs)) continue;
      const eventId = String(row.event_id ?? "").trim();
      const userId = String(row.user_id ?? "").trim();
      if (!eventId || !userId) continue;

      const users = activeUsersByEventId.get(eventId) ?? new Set<string>();
      users.add(userId);
      activeUsersByEventId.set(eventId, users);
    }

    const candidateRecipientUserIds = new Set<string>();
    const candidateDedupeKeys = new Set<string>();
    for (const message of messages) {
      const eventId = String(message.event_id ?? "").trim();
      const senderId = String(message.user_id ?? "").trim();
      const activeUsers = activeUsersByEventId.get(eventId) ?? new Set<string>();
      for (const uid of activeUsers) {
        if (!uid || uid === senderId) continue;
        candidateRecipientUserIds.add(uid);
        candidateDedupeKeys.add(`chat:${message.id}:${uid}`);
      }
    }

    if (candidateRecipientUserIds.size === 0) {
      return jsonResponse(200, {
        ok: true,
        lookbackMinutes,
        maxMessages,
        matchedMessages: messages.length,
        pushTargets: 0,
        sent: 0,
        failed: 0,
        note: "No active recipients found.",
      });
    }

    const { data: tokenRows, error: tokenErr } = await supabase
      .from("user_push_tokens")
      .select("user_id,expo_push_token")
      .in("user_id", [...candidateRecipientUserIds]);

    if (tokenErr) {
      return jsonResponse(500, {
        error: `Could not query user_push_tokens: ${tokenErr.message}`,
      });
    }

    const tokensByUserId = new Map<string, Set<string>>();
    for (const row of (tokenRows ?? []) as PushTokenRow[]) {
      const userId = String(row.user_id ?? "").trim();
      const token = String(row.expo_push_token ?? "").trim();
      if (!userId || !token || !isExpoPushToken(token)) continue;
      const tokens = tokensByUserId.get(userId) ?? new Set<string>();
      tokens.add(token);
      tokensByUserId.set(userId, tokens);
    }

    const existingDedupeKeys = await fetchExistingDedupeKeys(
      supabase,
      [...candidateDedupeKeys]
    );

    const targets: DeliveryTarget[] = [];
    for (const message of messages) {
      const eventId = String(message.event_id ?? "").trim();
      const senderId = String(message.user_id ?? "").trim();
      const activeUsers = activeUsersByEventId.get(eventId) ?? new Set<string>();
      if (activeUsers.size === 0) continue;

      const senderName = senderNameById.get(senderId) ?? "Someone";
      const eventTitle = eventTitleById.get(eventId) ?? "Live circle";

      for (const recipientUserId of activeUsers) {
        if (!recipientUserId || recipientUserId === senderId) continue;
        const dedupeKey = `chat:${message.id}:${recipientUserId}`;
        if (existingDedupeKeys.has(dedupeKey)) continue;

        const tokens = tokensByUserId.get(recipientUserId);
        if (!tokens || tokens.size === 0) continue;

        for (const token of tokens) {
          targets.push({
            dedupeKey,
            eventId,
            userId: recipientUserId,
            token,
            message: {
              to: token,
              title: `${eventTitle} - New message`,
              body: buildMessageBody(senderName, message.body),
              sound: "default",
              data: {
                type: "event_chat",
                eventId,
                messageId: message.id,
              },
            },
          });
        }
      }
    }

    if (dryRun) {
      return jsonResponse(200, {
        ok: true,
        dryRun: true,
        lookbackMinutes,
        maxMessages,
        matchedMessages: messages.length,
        dedupeCandidates: candidateDedupeKeys.size,
        pushTargets: targets.length,
        preview: targets.slice(0, 8).map((t) => ({
          dedupeKey: t.dedupeKey,
          eventId: t.eventId,
          userId: t.userId,
          title: t.message.title,
          body: t.message.body,
        })),
      });
    }

    if (targets.length === 0) {
      return jsonResponse(200, {
        ok: true,
        lookbackMinutes,
        maxMessages,
        matchedMessages: messages.length,
        pushTargets: 0,
        sent: 0,
        failed: 0,
        note: "All candidates were deduped or missing tokens.",
      });
    }

    const targetBatches = chunk(targets, EXPO_MAX_BATCH);
    const successByDedupeKey = new Map<string, DeliveryTarget>();
    const invalidTokens = new Set<string>();
    let failed = 0;

    for (const batch of targetBatches) {
      const { successTargets, failed: failedCount, invalidTokens: batchInvalidTokens } =
        await sendExpoPushBatch(batch);
      failed += failedCount;
      for (const t of successTargets) {
        if (!successByDedupeKey.has(t.dedupeKey)) {
          successByDedupeKey.set(t.dedupeKey, t);
        }
      }
      for (const token of batchInvalidTokens) invalidTokens.add(token);
    }

    if (invalidTokens.size > 0) {
      await supabase
        .from("user_push_tokens")
        .delete()
        .in("expo_push_token", [...invalidTokens]);
    }

    const notificationRows = [...successByDedupeKey.values()].map((target) => ({
      kind: "chat",
      user_id: target.userId,
      event_id: target.eventId,
      dedupe_key: target.dedupeKey,
      title: clip(target.message.title, 140),
      body: clip(target.message.body, 280),
      metadata: target.message.data,
    }));
    for (const rowsChunk of chunk(notificationRows, DB_IN_CHUNK)) {
      if (rowsChunk.length === 0) continue;
      const { error: logErr } = await supabase.from("notification_log").insert(rowsChunk);
      if (logErr) {
        return jsonResponse(500, {
          error: `Push sent, but could not write notification_log: ${logErr.message}`,
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      lookbackMinutes,
      maxMessages,
      matchedMessages: messages.length,
      dedupeCandidates: candidateDedupeKeys.size,
      pushTargets: targets.length,
      sent: successByDedupeKey.size,
      failed,
      invalidTokensRemoved: invalidTokens.size,
    });
  } catch (e) {
    return jsonResponse(500, {
      error: e instanceof Error ? e.message : "Unknown error",
    });
  }
});
