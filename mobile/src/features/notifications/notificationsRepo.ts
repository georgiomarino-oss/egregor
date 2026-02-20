import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../../supabase/client";
import type { Database } from "../../types/db";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type PresenceRow = Database["public"]["Tables"]["event_presence"]["Row"];
type EventMessageRow = Database["public"]["Tables"]["event_messages"]["Row"];

export type NotificationItem = {
  id: string;
  kind: "live" | "soon" | "streak" | "community" | "news" | "invite";
  title: string;
  body: string;
  atIso: string;
  eventId?: string;
};

type ProfilePrefs = {
  notifyLiveStart: boolean;
  notifyNewsEvents: boolean;
  notifyFriendInvites: boolean;
  notifyStreakReminders: boolean;
};

const KEY_PROFILE_PREFS = "profile:prefs:v1";
const KEY_NOTIFICATIONS_READ = "notifications:read:v1";

const DEFAULT_PREFS: ProfilePrefs = {
  notifyLiveStart: true,
  notifyNewsEvents: true,
  notifyFriendInvites: true,
  notifyStreakReminders: true,
};

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function normalizePrefs(raw: any): ProfilePrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  return {
    notifyLiveStart: !!raw.notifyLiveStart,
    notifyNewsEvents: !!raw.notifyNewsEvents,
    notifyFriendInvites: !!raw.notifyFriendInvites,
    notifyStreakReminders: !!raw.notifyStreakReminders,
  };
}

async function loadPrefs(): Promise<ProfilePrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PROFILE_PREFS);
    return normalizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function listNotifications(): Promise<NotificationItem[]> {
  const prefs = await loadPrefs();
  const nowMs = Date.now();
  const soonWindowMs = 60 * 60 * 1000;
  const crisisKeywords = ["earthquake", "flood", "wildfire", "hurricane", "war", "crisis"];

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid = user?.id ?? "";

  const [{ data: eventsRows }, { data: latestMessages }, { data: myPresenceRows }] = await Promise.all([
    supabase
      .from("events")
      .select("id,title,intention_statement,start_time_utc,end_time_utc,timezone")
      .order("start_time_utc", { ascending: true })
      .limit(120),
    supabase
      .from("event_messages")
      .select("id,event_id,body,created_at")
      .order("created_at", { ascending: false })
      .limit(25),
    uid
      ? supabase
          .from("event_presence")
          .select("last_seen_at")
          .eq("user_id", uid)
          .order("last_seen_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as Pick<PresenceRow, "last_seen_at">[] }),
  ]);

  const events = (eventsRows ?? []) as Pick<
    EventRow,
    "id" | "title" | "intention_statement" | "start_time_utc" | "end_time_utc" | "timezone"
  >[];
  const msgs = (latestMessages ?? []) as Pick<EventMessageRow, "id" | "event_id" | "body" | "created_at">[];
  const myPresence = (myPresenceRows ?? []) as Pick<PresenceRow, "last_seen_at">[];

  const next: NotificationItem[] = [];

  if (prefs.notifyLiveStart) {
    for (const e of events) {
      const startMs = safeTimeMs((e as any).start_time_utc);
      const endMs = safeTimeMs((e as any).end_time_utc);
      if (!startMs) continue;

      const isLive = startMs <= nowMs && (endMs <= 0 || nowMs <= endMs);
      if (isLive) {
        next.push({
          id: `live:${e.id}`,
          kind: "live",
          title: `${String((e as any).title ?? "Event")} is live now`,
          body: "Join now to sync with the active circle.",
          atIso: String((e as any).start_time_utc ?? new Date().toISOString()),
          eventId: String((e as any).id ?? ""),
        });
        continue;
      }

      const msUntil = startMs - nowMs;
      if (msUntil > 0 && msUntil <= soonWindowMs) {
        const mins = Math.max(1, Math.round(msUntil / 60_000));
        next.push({
          id: `soon:${e.id}`,
          kind: "soon",
          title: `${String((e as any).title ?? "Event")} starts in ${mins}m`,
          body: "Tap to open the room before the session begins.",
          atIso: String((e as any).start_time_utc ?? new Date().toISOString()),
          eventId: String((e as any).id ?? ""),
        });
      }
    }
  }

  if (prefs.notifyNewsEvents) {
    for (const e of events) {
      const title = String((e as any).title ?? "").toLowerCase();
      const intention = String((e as any).intention_statement ?? "").toLowerCase();
      const looksLikeCrisis = crisisKeywords.some(
        (kw) => title.includes(kw) || intention.includes(kw)
      );
      if (!looksLikeCrisis) continue;
      next.push({
        id: `news:${e.id}`,
        kind: "news",
        title: "Compassion alert event available",
        body: String((e as any).title ?? "Crisis support circle"),
        atIso: String((e as any).start_time_utc ?? new Date().toISOString()),
        eventId: String((e as any).id ?? ""),
      });
    }
  }

  if (prefs.notifyStreakReminders && uid) {
    const hasPresenceToday = myPresence.some((r) => {
      const t = safeTimeMs((r as any).last_seen_at);
      if (!t) return false;
      const d = new Date(t);
      const now = new Date();
      return (
        d.getUTCFullYear() === now.getUTCFullYear() &&
        d.getUTCMonth() === now.getUTCMonth() &&
        d.getUTCDate() === now.getUTCDate()
      );
    });
    if (!hasPresenceToday) {
      next.push({
        id: "streak:today",
        kind: "streak",
        title: "Keep your streak alive",
        body: "Join one live circle today to keep your momentum.",
        atIso: new Date().toISOString(),
      });
    }
  }

  const community = msgs
    .filter((m) => String((m as any).body ?? "").trim().length > 0)
    .slice(0, 4);
  for (const m of community) {
    next.push({
      id: `community:${String((m as any).id ?? "")}`,
      kind: "community",
      title: "New community intention shared",
      body: String((m as any).body ?? ""),
      atIso: String((m as any).created_at ?? new Date().toISOString()),
      eventId: String((m as any).event_id ?? ""),
    });
  }

  if (prefs.notifyFriendInvites) {
    next.push({
      id: "invite:share",
      kind: "invite",
      title: "Invite friends to your circle",
      body: "Share Egregor and build your own intention group.",
      atIso: new Date().toISOString(),
    });
  }

  next.sort((a, b) => safeTimeMs(b.atIso) - safeTimeMs(a.atIso));
  return next.slice(0, 40);
}

export async function readNotificationIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_NOTIFICATIONS_READ);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v)).filter(Boolean);
  } catch {
    return [];
  }
}

async function writeNotificationIds(ids: string[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean))).slice(0, 300);
  await AsyncStorage.setItem(KEY_NOTIFICATIONS_READ, JSON.stringify(uniq));
}

export async function markNotificationRead(id: string) {
  if (!id) return;
  const cur = await readNotificationIds();
  if (cur.includes(id)) return;
  await writeNotificationIds([id, ...cur]);
}

export async function markAllNotificationsRead() {
  const items = await listNotifications();
  await writeNotificationIds(items.map((i) => i.id));
}

export async function getUnreadNotificationCount(): Promise<number> {
  const [items, readIds] = await Promise.all([listNotifications(), readNotificationIds()]);
  const read = new Set(readIds);
  let unread = 0;
  for (const item of items) {
    if (!read.has(item.id)) unread += 1;
  }
  return unread;
}

