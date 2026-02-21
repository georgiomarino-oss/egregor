import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DB_IN_CHUNK = 200;

const EVENT_CHILD_TABLES = [
  "chat_push_queue",
  "event_chat_messages",
  "event_messages",
  "event_participants",
  "event_presence",
  "event_reads",
  "event_run_state",
  "event_typing",
] as const;

const USER_SCOPED_DELETE_TARGETS = [
  { table: "ai_generation_usage_daily", column: "user_id" },
  { table: "chat_push_queue", column: "created_by_user_id" },
  { table: "event_chat_messages", column: "user_id" },
  { table: "event_messages", column: "user_id" },
  { table: "event_participants", column: "user_id" },
  { table: "event_presence", column: "user_id" },
  { table: "event_reads", column: "user_id" },
  { table: "event_typing", column: "user_id" },
  { table: "events", column: "host_user_id" },
  { table: "manifestation_journal_entries", column: "user_id" },
  { table: "monetization_event_log", column: "user_id" },
  { table: "notification_log", column: "user_id" },
  { table: "revenuecat_webhook_events", column: "user_id" },
  { table: "scripts", column: "author_user_id" },
  { table: "user_notification_prefs", column: "user_id" },
  { table: "user_notification_reads", column: "user_id" },
  { table: "user_push_tokens", column: "user_id" },
  { table: "user_subscription_state", column: "user_id" },
] as const;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function parseBearerToken(req: Request) {
  const authHeader = String(req.headers.get("authorization") ?? "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
}

function uniqueNonEmpty(values: unknown[]) {
  return Array.from(
    new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))
  );
}

function chunk<T>(arr: T[], size: number) {
  const next: T[][] = [];
  for (let i = 0; i < arr.length; i += size) next.push(arr.slice(i, i + size));
  return next;
}

async function deleteByEq(args: {
  supabase: ReturnType<typeof createClient>;
  table: string;
  column: string;
  value: string;
}) {
  const { supabase, table, column, value } = args;
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error) {
    throw new Error(`Could not delete ${table} by ${column}: ${error.message}`);
  }
}

async function deleteByIn(args: {
  supabase: ReturnType<typeof createClient>;
  table: string;
  column: string;
  values: string[];
}) {
  const { supabase, table, column } = args;
  const values = uniqueNonEmpty(args.values);
  if (values.length === 0) return;
  for (const idsChunk of chunk(values, DB_IN_CHUNK)) {
    const { error } = await supabase.from(table).delete().in(column, idsChunk);
    if (error) {
      throw new Error(`Could not delete ${table} by ${column}: ${error.message}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed. Use POST." });

  const requestBody = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceRoleKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(200, {
      ok: false,
      error: "Missing required env vars. Expected SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    });
  }

  const tokenFromHeader = parseBearerToken(req);
  const tokenFromBody = String(requestBody.accessToken ?? "").trim();
  const token = tokenFromHeader || tokenFromBody;
  if (!token) return jsonResponse(200, { ok: false, error: "Missing access token." });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !user) {
    return jsonResponse(200, {
      ok: false,
      error: userErr?.message || "Could not resolve authenticated user.",
    });
  }

  const userId = String(user.id ?? "").trim();
  if (!userId) return jsonResponse(200, { ok: false, error: "Authenticated user id missing." });

  const cleanupSteps: string[] = [];

  try {
    const { data: scriptRows, error: scriptsErr } = await supabaseAdmin
      .from("scripts")
      .select("id")
      .eq("author_user_id", userId);
    if (scriptsErr) {
      throw new Error(`Could not load authored scripts: ${scriptsErr.message}`);
    }
    const scriptIds = uniqueNonEmpty((scriptRows ?? []).map((row: any) => row.id));

    if (scriptIds.length > 0) {
      for (const idsChunk of chunk(scriptIds, DB_IN_CHUNK)) {
        const { error: detachErr } = await supabaseAdmin
          .from("events")
          .update({ script_id: null })
          .in("script_id", idsChunk);
        if (detachErr) {
          throw new Error(`Could not detach scripts from events: ${detachErr.message}`);
        }
      }
      cleanupSteps.push("events.script_id=null (detached authored scripts)");
    }

    const { data: hostedRows, error: hostedErr } = await supabaseAdmin
      .from("events")
      .select("id")
      .eq("host_user_id", userId);
    if (hostedErr) {
      throw new Error(`Could not load hosted events: ${hostedErr.message}`);
    }
    const hostedEventIds = uniqueNonEmpty((hostedRows ?? []).map((row: any) => row.id));

    if (hostedEventIds.length > 0) {
      for (const table of EVENT_CHILD_TABLES) {
        await deleteByIn({
          supabase: supabaseAdmin,
          table,
          column: "event_id",
          values: hostedEventIds,
        });
        cleanupSteps.push(`${table}.event_id`);
      }

      await deleteByIn({
        supabase: supabaseAdmin,
        table: "notification_log",
        column: "event_id",
        values: hostedEventIds,
      });
      cleanupSteps.push("notification_log.event_id");

      await deleteByIn({
        supabase: supabaseAdmin,
        table: "events",
        column: "id",
        values: hostedEventIds,
      });
      cleanupSteps.push("events.id");
    }

    for (const target of USER_SCOPED_DELETE_TARGETS) {
      await deleteByEq({
        supabase: supabaseAdmin,
        table: target.table,
        column: target.column,
        value: userId,
      });
      cleanupSteps.push(`${target.table}.${target.column}`);
    }

    await deleteByEq({
      supabase: supabaseAdmin,
      table: "revenuecat_webhook_events",
      column: "app_user_id",
      value: userId,
    });
    cleanupSteps.push("revenuecat_webhook_events.app_user_id");

    await deleteByEq({
      supabase: supabaseAdmin,
      table: "profiles",
      column: "id",
      value: userId,
    });
    cleanupSteps.push("profiles.id");

    const { error: deleteAuthErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteAuthErr) {
      throw new Error(`Could not delete auth user: ${deleteAuthErr.message}`);
    }

    return jsonResponse(200, {
      ok: true,
      userId,
      deletedAt: new Date().toISOString(),
      cleanupSteps,
    });
  } catch (e) {
    return jsonResponse(200, {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown error",
      userId,
      cleanupSteps,
    });
  }
});
