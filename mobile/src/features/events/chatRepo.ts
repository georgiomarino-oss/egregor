// mobile/src/features/events/chatRepo.ts
import { supabase } from "../../supabase/client";

export type EventMessageRow = {
  id: string;
  event_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export async function listMessages(eventId: string, limit = 50): Promise<EventMessageRow[]> {
  // NOTE: we cast table name to any so this works even before you regenerate db types.
  const { data, error } = await (supabase as any)
    .from("event_messages")
    .select("id,event_id,user_id,body,created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as EventMessageRow[];
}

export async function sendMessage(eventId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error("Not signed in.");

  const payload = {
    event_id: eventId,
    user_id: user.id,
    body: trimmed,
  };

  const { error } = await (supabase as any).from("event_messages").insert(payload);
  if (error) throw error;
}

export function subscribeMessages(
  eventId: string,
  onChange: () => void
): { unsubscribe: () => void } {
  // Realtime changefeed for this event’s messages
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
      () => onChange()
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}
