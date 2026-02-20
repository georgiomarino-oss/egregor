// mobile/src/features/events/chatRepo.ts
import { supabase } from "../../supabase/client";

export type EventMessageRow = {
  id: string;
  event_id: string;
  user_id: string;
  body: string;
  created_at: string;
  client_id?: string | null;
};

/**
 * Small UUID helper:
 * - uses crypto.randomUUID if available
 * - falls back to RFC4122-ish Math.random (fine for client_id dedupe)
 */
export function makeClientId(): string {
  const g: any = globalThis as any;
  if (g?.crypto?.randomUUID) return g.crypto.randomUUID();

  // fallback (RFC4122 v4-ish)
  const s: string[] = [];
  const hex = "0123456789abcdef";
  for (let i = 0; i < 36; i++) s[i] = hex[Math.floor(Math.random() * 16)];
  s[14] = "4";
  // eslint-disable-next-line no-bitwise
  s[19] = hex[(parseInt(s[19], 16) & 0x3) | 0x8];
  s[8] = s[13] = s[18] = s[23] = "-";
  return s.join("");
}

export async function listMessages(eventId: string, limit = 200): Promise<EventMessageRow[]> {
  const { data, error } = await (supabase as any)
    .from("event_messages")
    .select("id,event_id,user_id,body,created_at,client_id")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as EventMessageRow[];
}

/**
 * Sends a message with a client_id to allow dedupe between optimistic UI + realtime insert.
 * Returns the client_id used (caller can keep it for pending message reconciliation).
 */
export async function sendMessage(
  eventId: string,
  body: string,
  clientId?: string
): Promise<string> {
  const trimmed = body.trim();
  if (!trimmed) return clientId ?? "";

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error("Not signed in.");

  const cid = clientId ?? makeClientId();

  const payload = {
    event_id: eventId,
    user_id: user.id,
    body: trimmed,
    client_id: cid,
  };

  const { error } = await (supabase as any).from("event_messages").insert(payload);
  if (error) throw error;

  return cid;
}

/**
 * Subscribe to inserts and receive the inserted row directly (no refetch storms).
 */
export function subscribeMessages(
  eventId: string,
  onInsert: (row: EventMessageRow) => void
): { unsubscribe: () => void } {
  const channel = supabase
    .channel(`event_messages:${eventId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "event_messages",
        filter: `event_id=eq.${eventId}`,
      },
      (payload) => {
        const row = payload.new as EventMessageRow;
        onInsert(row);
      }
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}
