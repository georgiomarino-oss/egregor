import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type RevenueCatEvent = {
  id?: string;
  event_timestamp_ms?: number;
  type?: string;
  app_user_id?: string;
  aliases?: string[];
  entitlement_id?: string | null;
  entitlement_ids?: string[] | null;
  product_id?: string | null;
  store?: string | null;
  environment?: string | null;
  expiration_at_ms?: number | null;
  original_transaction_id?: string | null;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-egregor-webhook-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_ENTITLEMENT_ID =
  String(Deno.env.get("RC_DEFAULT_ENTITLEMENT_ID") ?? "").trim() ||
  "egregor_circle";

const REPLAY_MAX_AGE_HOURS = Math.max(
  1,
  Number(
    String(Deno.env.get("RC_REPLAY_MAX_AGE_HOURS") ?? "").trim() || "720"
  ) || 720
);
const REPLAY_MAX_FUTURE_MINUTES = Math.max(
  1,
  Number(
    String(Deno.env.get("RC_REPLAY_MAX_FUTURE_MINUTES") ?? "").trim() || "15"
  ) || 15
);

const ACTIVE_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "NON_RENEWING_PURCHASE",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "TRANSFER",
]);

const FORCED_INACTIVE_TYPES = new Set(["EXPIRATION"]);

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

function safeText(v: unknown) {
  return String(v ?? "").trim();
}

function asMs(value: unknown) {
  const ms = Number(value ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms);
}

function toIsoFromMs(value: unknown): string | null {
  const ms = asMs(value);
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function findBestUserId(event: RevenueCatEvent) {
  const direct = safeText(event.app_user_id);
  if (isLikelyUuid(direct)) return direct;

  const aliases = Array.isArray(event.aliases) ? event.aliases : [];
  for (const alias of aliases) {
    const id = safeText(alias);
    if (isLikelyUuid(id)) return id;
  }

  return "";
}

function parseExpiresAt(event: RevenueCatEvent) {
  return toIsoFromMs(event.expiration_at_ms);
}

function parseEventTimestamp(event: RevenueCatEvent) {
  return toIsoFromMs(event.event_timestamp_ms);
}

function determineActive(eventTypeRaw: string, expiresAtIso: string | null) {
  const eventType = eventTypeRaw.toUpperCase();
  if (FORCED_INACTIVE_TYPES.has(eventType)) return false;

  if (expiresAtIso) {
    const expiresMs = new Date(expiresAtIso).getTime();
    if (Number.isFinite(expiresMs)) {
      if (expiresMs > Date.now()) return true;
      if (expiresMs <= Date.now()) return false;
    }
  }

  return ACTIVE_TYPES.has(eventType);
}

function extractEntitlementIds(event: RevenueCatEvent) {
  const fromList = Array.isArray(event.entitlement_ids) ? event.entitlement_ids : [];
  const fromSingle = safeText(event.entitlement_id);
  const merged = [...fromList.map((v) => safeText(v)).filter(Boolean)];
  if (fromSingle) merged.push(fromSingle);

  const uniq = Array.from(new Set(merged.filter(Boolean)));
  if (uniq.length > 0) return uniq;
  return [DEFAULT_ENTITLEMENT_ID];
}

function requireWebhookAuth(req: Request) {
  const token = String(Deno.env.get("REVENUECAT_WEBHOOK_AUTH_TOKEN") ?? "").trim();
  if (!token) return true;

  const authHeader = safeText(req.headers.get("authorization"));
  const bearer =
    authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : authHeader;
  const rawToken = safeText(req.headers.get("x-egregor-webhook-token"));
  return bearer === token || rawToken === token;
}

function checkReplayWindow(eventTimestampIso: string | null) {
  if (!eventTimestampIso) {
    return { blocked: false, reason: "" };
  }

  const eventMs = new Date(eventTimestampIso).getTime();
  if (!Number.isFinite(eventMs)) {
    return { blocked: false, reason: "" };
  }

  const nowMs = Date.now();
  const maxAgeMs = REPLAY_MAX_AGE_HOURS * 60 * 60 * 1000;
  const maxFutureMs = REPLAY_MAX_FUTURE_MINUTES * 60 * 1000;
  if (eventMs > nowMs + maxFutureMs) {
    return {
      blocked: true,
      reason: `event timestamp too far in future (> ${REPLAY_MAX_FUTURE_MINUTES}m)`,
    };
  }
  if (nowMs - eventMs > maxAgeMs) {
    return {
      blocked: true,
      reason: `event timestamp too old (> ${REPLAY_MAX_AGE_HOURS}h)`,
    };
  }

  return { blocked: false, reason: "" };
}

async function sha256Hex(input: string) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildWebhookEventId(event: RevenueCatEvent, payload: unknown) {
  const direct = safeText(event.id);
  if (direct) return `rc:${direct}`;

  const asJson = JSON.stringify(payload ?? event ?? {});
  const hash = await sha256Hex(asJson);
  const eventMs = asMs(event.event_timestamp_ms);
  if (eventMs > 0) return `hash:${eventMs}:${hash}`;
  return `hash:${hash}`;
}

async function updateWebhookLog(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  patch: Record<string, unknown>
) {
  const nowIso = new Date().toISOString();
  await supabase
    .from("revenuecat_webhook_events")
    .update({
      ...patch,
      updated_at: nowIso,
    })
    .eq("event_id", eventId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  if (!requireWebhookAuth(req)) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceRoleKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    });
  }

  const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const event = (payload?.event ?? payload) as RevenueCatEvent;
  const eventType = safeText(event?.type).toUpperCase();
  if (!eventType) {
    return jsonResponse(400, { error: "Missing RevenueCat event type." });
  }

  const eventId = await buildWebhookEventId(event, payload);
  const userId = findBestUserId(event);
  const entitlementIds = extractEntitlementIds(event);
  const eventTimestamp = parseEventTimestamp(event);
  const receivedAt = new Date().toISOString();

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: insertLogError } = await supabase
    .from("revenuecat_webhook_events")
    .insert({
      event_id: eventId,
      user_id: userId || null,
      event_type: eventType,
      app_user_id: safeText(event.app_user_id) || null,
      entitlement_ids: entitlementIds,
      product_id: safeText(event.product_id) || null,
      store: safeText(event.store) || null,
      environment: safeText(event.environment) || null,
      event_timestamp: eventTimestamp,
      process_status: "received",
      raw_payload: payload,
      metadata: {
        source: "revenuecat_webhook",
      },
      received_at: receivedAt,
      processed_at: null,
      created_at: receivedAt,
      updated_at: receivedAt,
    });

  if (insertLogError) {
    if (safeText((insertLogError as any)?.code) === "23505") {
      return jsonResponse(200, {
        ok: true,
        duplicate: true,
        eventId,
        eventType,
      });
    }
    return jsonResponse(500, {
      error: `Could not log webhook event: ${clip(
        safeText((insertLogError as any)?.message || "unknown error"),
        400
      )}`,
    });
  }

  const replayWindow = checkReplayWindow(eventTimestamp);
  if (replayWindow.blocked) {
    await updateWebhookLog(supabase, eventId, {
      process_status: "ignored",
      error_message: replayWindow.reason,
      processed_at: new Date().toISOString(),
    });
    return jsonResponse(200, {
      ok: true,
      ignored: true,
      reason: replayWindow.reason,
      eventId,
      eventType,
    });
  }

  if (!userId) {
    await updateWebhookLog(supabase, eventId, {
      process_status: "ignored",
      error_message: "No UUID app_user_id/alias found.",
      processed_at: new Date().toISOString(),
    });
    return jsonResponse(200, {
      ok: true,
      ignored: true,
      reason: "No UUID app_user_id/alias found.",
      eventId,
      eventType,
    });
  }

  const expiresAt = parseExpiresAt(event);
  const isActive = determineActive(eventType, expiresAt);
  const metadata = {
    raw_event: payload,
    received_at: receivedAt,
    webhook_event_id: eventId,
  };

  const { data: existingRows, error: existingRowsError } = await supabase
    .from("user_subscription_state")
    .select("entitlement_id,last_event_timestamp,last_event_id,last_event_type")
    .eq("user_id", userId)
    .eq("provider", "revenuecat")
    .in("entitlement_id", entitlementIds);

  if (existingRowsError) {
    await updateWebhookLog(supabase, eventId, {
      process_status: "failed",
      error_message: clip(existingRowsError.message, 400),
      processed_at: new Date().toISOString(),
    });
    return jsonResponse(500, {
      error: `Could not read current subscription state: ${clip(
        existingRowsError.message,
        400
      )}`,
      eventId,
    });
  }

  const existingByEntitlement: Record<
    string,
    { lastEventTimestamp: string | null; lastEventId: string | null; lastEventType: string | null }
  > = {};
  for (const row of (existingRows ?? []) as any[]) {
    const entitlementId = safeText(row?.entitlement_id);
    if (!entitlementId) continue;
    existingByEntitlement[entitlementId] = {
      lastEventTimestamp: safeText(row?.last_event_timestamp) || null,
      lastEventId: safeText(row?.last_event_id) || null,
      lastEventType: safeText(row?.last_event_type) || null,
    };
  }

  const incomingEventMs = eventTimestamp ? new Date(eventTimestamp).getTime() : 0;
  const staleSkippedEntitlementIds: string[] = [];
  const missingTimestampSkippedEntitlementIds: string[] = [];

  const rows = entitlementIds
    .filter((entitlementId) => {
      const existing = existingByEntitlement[entitlementId];
      if (!existing) return true;

      const existingMs = existing.lastEventTimestamp
        ? new Date(existing.lastEventTimestamp).getTime()
        : 0;
      if (!Number.isFinite(existingMs) || existingMs <= 0) return true;

      if (!Number.isFinite(incomingEventMs) || incomingEventMs <= 0) {
        missingTimestampSkippedEntitlementIds.push(entitlementId);
        return false;
      }

      if (incomingEventMs < existingMs) {
        staleSkippedEntitlementIds.push(entitlementId);
        return false;
      }

      return true;
    })
    .map((entitlementId) => ({
      user_id: userId,
      provider: "revenuecat",
      entitlement_id: entitlementId,
      is_active: isActive,
      product_id: safeText(event.product_id) || null,
      store: safeText(event.store) || null,
      environment: safeText(event.environment) || null,
      expires_at: expiresAt,
      original_transaction_id: safeText(event.original_transaction_id) || null,
      last_event_type: eventType,
      last_event_id: eventId,
      last_event_timestamp: eventTimestamp,
      metadata,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) {
    const reason =
      staleSkippedEntitlementIds.length > 0
        ? "Event is older than latest entitlement state."
        : "Event timestamp missing while newer entitlement state already exists.";
    await updateWebhookLog(supabase, eventId, {
      process_status: "ignored",
      error_message: reason,
      processed_at: new Date().toISOString(),
      metadata: {
        source: "revenuecat_webhook",
        stale_skipped_entitlement_ids: staleSkippedEntitlementIds,
        missing_timestamp_skipped_entitlement_ids:
          missingTimestampSkippedEntitlementIds,
      },
    });
    return jsonResponse(200, {
      ok: true,
      ignored: true,
      eventId,
      reason,
      staleSkippedEntitlementIds,
      missingTimestampSkippedEntitlementIds,
    });
  }

  const { error } = await supabase.from("user_subscription_state").upsert(rows, {
    onConflict: "user_id,provider,entitlement_id",
    ignoreDuplicates: false,
  });

  if (error) {
    await updateWebhookLog(supabase, eventId, {
      process_status: "failed",
      error_message: clip(error.message, 400),
      processed_at: new Date().toISOString(),
    });
    return jsonResponse(500, {
      error: `Could not upsert subscription state: ${clip(error.message, 400)}`,
      eventId,
    });
  }

  await updateWebhookLog(supabase, eventId, {
    user_id: userId,
    process_status: "processed",
    error_message: null,
    processed_at: new Date().toISOString(),
    metadata: {
      source: "revenuecat_webhook",
      entitlement_count: rows.length,
      is_active: isActive,
      stale_skipped_entitlement_ids: staleSkippedEntitlementIds,
      missing_timestamp_skipped_entitlement_ids:
        missingTimestampSkippedEntitlementIds,
    },
  });

  return jsonResponse(200, {
    ok: true,
    eventId,
    userId,
    eventType,
    entitlementIds,
    isActive,
    expiresAt,
    updated: rows.length,
    staleSkippedEntitlementIds,
    missingTimestampSkippedEntitlementIds,
  });
});
