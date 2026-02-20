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

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function safeText(v: unknown) {
  return String(v ?? "").trim();
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
  const ms = Number(event.expiration_at_ms ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
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

  const payload = (await req.json().catch(() => ({}))) as any;
  const event = (payload?.event ?? payload) as RevenueCatEvent;
  const eventType = safeText(event?.type).toUpperCase();
  if (!eventType) {
    return jsonResponse(400, { error: "Missing RevenueCat event type." });
  }

  const userId = findBestUserId(event);
  if (!userId) {
    return jsonResponse(200, {
      ok: true,
      ignored: true,
      reason: "No UUID app_user_id/alias found.",
      eventType,
    });
  }

  const entitlementIds = extractEntitlementIds(event);
  const expiresAt = parseExpiresAt(event);
  const isActive = determineActive(eventType, expiresAt);
  const metadata = {
    raw_event: payload,
    received_at: new Date().toISOString(),
  };

  const rows = entitlementIds.map((entitlementId) => ({
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
    last_event_id: safeText(event.id) || null,
    metadata,
    updated_at: new Date().toISOString(),
  }));

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase.from("user_subscription_state").upsert(rows, {
    onConflict: "user_id,provider,entitlement_id",
    ignoreDuplicates: false,
  });

  if (error) {
    return jsonResponse(500, {
      error: `Could not upsert subscription state: ${clip(error.message, 400)}`,
    });
  }

  return jsonResponse(200, {
    ok: true,
    userId,
    eventType,
    entitlementIds,
    isActive,
    expiresAt,
    updated: rows.length,
  });
});
