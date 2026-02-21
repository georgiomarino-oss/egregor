import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../../supabase/client";
import type { Database } from "../../types/db";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type PresenceRow = Database["public"]["Tables"]["event_presence"]["Row"];
type EventMessageRow = Database["public"]["Tables"]["event_messages"]["Row"];
type NotificationLogRow = Database["public"]["Tables"]["notification_log"]["Row"];
type UserNotificationReadRow = Database["public"]["Tables"]["user_notification_reads"]["Row"];

export type NotificationItem = {
  id: string;
  kind: "chat" | "live" | "soon" | "streak" | "community" | "news" | "invite";
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
  showCommunityFeed: boolean;
};

const KEY_PROFILE_PREFS = "profile:prefs:v1";
const KEY_NOTIFICATIONS_READ = "notifications:read:v1";
const READ_IDS_CACHE_MS = 20_000;

let readIdsCache: string[] = [];
let readIdsCacheAt = 0;

const DEFAULT_PREFS: ProfilePrefs = {
  notifyLiveStart: true,
  notifyNewsEvents: true,
  notifyFriendInvites: true,
  notifyStreakReminders: true,
  showCommunityFeed: true,
};

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function notificationPriority(kind: NotificationItem["kind"]) {
  if (kind === "news") return 6;
  if (kind === "live") return 5;
  if (kind === "chat") return 4;
  if (kind === "soon") return 3;
  if (kind === "streak") return 2;
  if (kind === "community") return 1;
  if (kind === "invite") return 1;
  return 0;
}

function normalizePrefs(raw: any): ProfilePrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  return {
    notifyLiveStart: !!raw.notifyLiveStart,
    notifyNewsEvents: !!raw.notifyNewsEvents,
    notifyFriendInvites: !!raw.notifyFriendInvites,
    notifyStreakReminders: !!raw.notifyStreakReminders,
    showCommunityFeed: raw.showCommunityFeed !== false,
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

async function getCurrentUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return String(user?.id ?? "").trim();
}

function normalizeIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean))).slice(0, 500);
}

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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

  const [{ data: eventsRows }, { data: latestMessages }, { data: myPresenceRows }, { data: serverRows }] =
    await Promise.all([
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
      uid
        ? supabase
            .from("notification_log")
            .select("id,kind,event_id,dedupe_key,created_at,title,body,metadata")
            .eq("user_id", uid)
            .order("created_at", { ascending: false })
            .limit(80)
        : Promise.resolve({
            data: [] as Pick<
              NotificationLogRow,
              "id" | "kind" | "event_id" | "dedupe_key" | "created_at" | "title" | "body" | "metadata"
            >[],
          }),
    ]);

  const events = (eventsRows ?? []) as Pick<
    EventRow,
    "id" | "title" | "intention_statement" | "start_time_utc" | "end_time_utc" | "timezone"
  >[];
  const msgs = (latestMessages ?? []) as Pick<EventMessageRow, "id" | "event_id" | "body" | "created_at">[];
  const myPresence = (myPresenceRows ?? []) as Pick<PresenceRow, "last_seen_at">[];
  const server = (serverRows ?? []) as Pick<
    NotificationLogRow,
    "id" | "kind" | "event_id" | "dedupe_key" | "created_at" | "title" | "body" | "metadata"
  >[];

  const next: NotificationItem[] = [];

  for (const row of server) {
    const id = String((row as any).id ?? "").trim();
    if (!id) continue;

    const kindRaw = String((row as any).kind ?? "").trim().toLowerCase();
    const atIso = String((row as any).created_at ?? new Date().toISOString());
    const rowEventId = String((row as any).event_id ?? "").trim();
    const rowTitle = String((row as any).title ?? "").trim();
    const rowBody = String((row as any).body ?? "").trim();

    if (kindRaw === "chat") {
      next.push({
        id,
        kind: "chat",
        title: rowTitle || "New message in your circle",
        body: rowBody || "Open the event room to catch up.",
        atIso,
        eventId: rowEventId || undefined,
      });
      continue;
    }

    if (kindRaw === "journal_shared") {
      if (!prefs.showCommunityFeed) continue;
      next.push({
        id,
        kind: "community",
        title: rowTitle || "New anonymous manifestation shared",
        body: rowBody || "A new shared manifestation has been added to the community feed.",
        atIso,
      });
    }
  }

  const hasServerCommunity = next.some((n) => n.kind === "community");

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

  if (prefs.showCommunityFeed && !hasServerCommunity) {
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

  const deduped = Array.from(
    next.reduce((acc, item) => {
      if (!acc.has(item.id)) acc.set(item.id, item);
      return acc;
    }, new Map<string, NotificationItem>()).values()
  );

  deduped.sort((a, b) => {
    const pa = notificationPriority(a.kind);
    const pb = notificationPriority(b.kind);
    if (pa !== pb) return pb - pa;
    return safeTimeMs(b.atIso) - safeTimeMs(a.atIso);
  });
  return deduped.slice(0, 40);
}

async function readLocalNotificationIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_NOTIFICATIONS_READ);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeIds(parsed.map((v) => String(v)));
  } catch {
    return [];
  }
}

async function writeLocalNotificationIds(ids: string[]) {
  const uniq = normalizeIds(ids);
  await AsyncStorage.setItem(KEY_NOTIFICATIONS_READ, JSON.stringify(uniq));
}

export async function readNotificationIds(forceFresh = false): Promise<string[]> {
  const now = Date.now();
  if (!forceFresh && now - readIdsCacheAt <= READ_IDS_CACHE_MS) {
    return readIdsCache;
  }

  const local = await readLocalNotificationIds();
  const uid = await getCurrentUserId();
  if (!uid) {
    readIdsCache = local;
    readIdsCacheAt = now;
    return local;
  }

  const { data, error } = await supabase
    .from("user_notification_reads")
    .select("notification_id,read_at,user_id")
    .eq("user_id", uid)
    .order("read_at", { ascending: false })
    .limit(500);

  if (error) {
    readIdsCache = local;
    readIdsCacheAt = now;
    return local;
  }

  const remote = ((data ?? []) as UserNotificationReadRow[])
    .map((r) => String(r.notification_id ?? "").trim())
    .filter(Boolean);
  const merged = normalizeIds([...remote, ...local]);

  if (!sameIds(merged, local)) {
    try {
      await writeLocalNotificationIds(merged);
    } catch {
      // ignore local cache write errors
    }
  }

  readIdsCache = merged;
  readIdsCacheAt = now;
  return merged;
}

async function writeNotificationIds(ids: string[]) {
  const uniq = normalizeIds(ids);
  await writeLocalNotificationIds(uniq);

  const uid = await getCurrentUserId();
  if (uid && uniq.length > 0) {
    const rows = uniq.map((notificationId) => ({
      user_id: uid,
      notification_id: notificationId,
      read_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("user_notification_reads")
      .upsert(rows, { onConflict: "user_id,notification_id" });
    if (error) {
      console.log("[notifications] read sync failed", error.message);
    }
  }

  readIdsCache = uniq;
  readIdsCacheAt = Date.now();
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
