import { supabase } from "../../supabase/client";

export type EventRunMode = "idle" | "running" | "paused" | "ended";

export type EventRunStateV1 = {
  version: 1;
  mode: EventRunMode;
  sectionIndex: number;
  startedAt?: string;
  pausedAt?: string;
  elapsedBeforePauseSec?: number;
};

export type EventRunStateRow = {
  event_id: string;
  state: EventRunStateV1 | Record<string, any>;
  updated_at: string;
  created_at: string;
};

const DEFAULT_STATE: EventRunStateV1 = {
  version: 1,
  mode: "idle",
  sectionIndex: 0,
};

export async function getRunState(eventId: string): Promise<EventRunStateRow | null> {
  const { data, error } = await supabase
    .from("event_run_state")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function ensureRunState(eventId: string): Promise<EventRunStateRow> {
  const existing = await getRunState(eventId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("event_run_state")
    .insert({
      event_id: eventId,
      state: DEFAULT_STATE,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as EventRunStateRow;
}

export async function upsertRunState(eventId: string, state: EventRunStateV1): Promise<EventRunStateRow> {
  const { data, error } = await supabase
    .from("event_run_state")
    .upsert({ event_id: eventId, state }, { onConflict: "event_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data as EventRunStateRow;
}

/**
 * Host-only: set run state using server time via RPC.
 * This avoids device clock drift.
 */
export async function setRunStateServerTime(args: {
  eventId: string;
  mode: EventRunMode;
  sectionIndex: number;
  elapsedBeforePauseSec?: number;
  resetTimer?: boolean;
}): Promise<EventRunStateRow> {
  const { eventId, mode, sectionIndex, elapsedBeforePauseSec = 0, resetTimer = false } = args;

  const { data, error } = await supabase.rpc("set_event_run_state", {
    p_event_id: eventId,
    p_mode: mode,
    p_section_index: sectionIndex,
    p_elapsed_before_pause_sec: elapsedBeforePauseSec,
    p_reset_timer: resetTimer,
  });

  if (error) throw error;
  return data as EventRunStateRow;
}

export function subscribeRunState(
  eventId: string,
  onChange: (row: EventRunStateRow) => void
): { unsubscribe: () => void } {
  const channel = supabase
    .channel(`event_run_state:${eventId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "event_run_state", filter: `event_id=eq.${eventId}` },
      (payload) => {
        const next = payload.new as EventRunStateRow | null;
        if (next) onChange(next);
      }
    )
    .subscribe();

  return { unsubscribe: () => supabase.removeChannel(channel) };
}

export function normalizeRunState(input: any): EventRunStateV1 {
  if (!input || typeof input !== "object") return { ...DEFAULT_STATE };

  const mode: EventRunMode =
    input.mode === "running" || input.mode === "paused" || input.mode === "ended" ? input.mode : "idle";
  const sectionIndex = Number.isFinite(input.sectionIndex) ? Math.max(0, input.sectionIndex) : 0;

  const startedAt = typeof input.startedAt === "string" ? input.startedAt : undefined;
  const pausedAt = typeof input.pausedAt === "string" ? input.pausedAt : undefined;
  const elapsedBeforePauseSec = Number.isFinite(input.elapsedBeforePauseSec)
    ? Math.max(0, input.elapsedBeforePauseSec)
    : undefined;

  return { version: 1, mode, sectionIndex, startedAt, pausedAt, elapsedBeforePauseSec };
}
