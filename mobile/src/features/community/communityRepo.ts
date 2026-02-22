import { supabase } from "../../supabase/client";

export type CircleMemberProfile = {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
};

export type CircleRequestRow = {
  id: string;
  requester_user_id: string;
  target_user_id: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  message: string | null;
  created_at: string;
  updated_at: string;
};

export type DirectMessageRow = {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export type ConversationPreview = {
  peerUserId: string;
  peerName: string;
  peerAvatarUrl: string;
  lastMessageAt: string;
  lastMessageBody: string;
  unreadCount: number;
};

function compactDisplayName(profile: any) {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  const display = String(profile?.display_name ?? "").trim();
  if (first) return [first, last].filter(Boolean).join(" ");
  if (display) return display;
  return "Egregor Member";
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) throw new Error("Not signed in.");
  return user.id;
}

export async function getCircleSummary() {
  const uid = await getCurrentUserId();
  const [membersResp, incomingResp] = await Promise.all([
    (supabase as any)
      .from("circle_memberships")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", uid),
    (supabase as any)
      .from("circle_connection_requests")
      .select("id", { count: "exact", head: true })
      .eq("target_user_id", uid)
      .eq("status", "pending"),
  ]);
  return {
    membersCount: Number(membersResp.count ?? 0),
    pendingIncomingCount: Number(incomingResp.count ?? 0),
  };
}

export async function listCircleMembers() {
  const uid = await getCurrentUserId();
  const { data, error } = await (supabase as any)
    .from("circle_memberships")
    .select("member_user_id,created_at")
    .eq("owner_user_id", uid)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;

  const memberIds = (data ?? [])
    .map((row: any) => String(row.member_user_id ?? ""))
    .filter((id: string) => !!id);
  if (!memberIds.length) return [] as CircleMemberProfile[];

  const { data: profiles, error: profileErr } = await (supabase as any)
    .from("profiles")
    .select("id,display_name,first_name,last_name,avatar_url")
    .in("id", memberIds);
  if (profileErr) throw profileErr;

  const map = new Map<string, any>();
  for (const p of profiles ?? []) {
    map.set(String((p as any).id ?? ""), p);
  }

  return memberIds
    .map((id: string) => {
      const p = map.get(id) ?? {};
      return {
        id,
        displayName: compactDisplayName(p),
        firstName: String(p?.first_name ?? "").trim(),
        lastName: String(p?.last_name ?? "").trim(),
        avatarUrl: String(p?.avatar_url ?? ""),
      } as CircleMemberProfile;
    })
    .filter((row: CircleMemberProfile) => !!row.id);
}

export async function listDiscoverProfiles(limit = 80) {
  const uid = await getCurrentUserId();
  const members = await listCircleMembers();
  const memberSet = new Set(members.map((m: CircleMemberProfile) => m.id));
  memberSet.add(uid);

  const { data, error } = await (supabase as any)
    .from("profiles")
    .select("id,display_name,first_name,last_name,avatar_url,updated_at")
    .order("updated_at", { ascending: false })
    .limit(Math.max(20, Math.min(400, limit * 2)));
  if (error) throw error;

  const rows = (data ?? [])
    .map((p: any) => ({
      id: String(p?.id ?? ""),
      displayName: compactDisplayName(p),
      firstName: String(p?.first_name ?? "").trim(),
      lastName: String(p?.last_name ?? "").trim(),
      avatarUrl: String(p?.avatar_url ?? ""),
    }))
    .filter((p: CircleMemberProfile) => !!p.id && !memberSet.has(p.id));

  return rows.slice(0, limit);
}

export async function listIncomingCircleRequests() {
  const uid = await getCurrentUserId();
  const { data, error } = await (supabase as any)
    .from("circle_connection_requests")
    .select("id,requester_user_id,target_user_id,status,message,created_at,updated_at")
    .eq("target_user_id", uid)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) throw error;
  return (data ?? []) as CircleRequestRow[];
}

export async function listOutgoingCircleRequests() {
  const uid = await getCurrentUserId();
  const { data, error } = await (supabase as any)
    .from("circle_connection_requests")
    .select("id,requester_user_id,target_user_id,status,message,created_at,updated_at")
    .eq("requester_user_id", uid)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) throw error;
  return (data ?? []) as CircleRequestRow[];
}

export async function sendCircleRequest(targetUserId: string, message?: string) {
  const uid = await getCurrentUserId();
  const target = String(targetUserId ?? "").trim();
  if (!target) throw new Error("Missing user id.");
  if (uid === target) throw new Error("You cannot send a request to yourself.");

  const payload = {
    requester_user_id: uid,
    target_user_id: target,
    status: "pending",
    message: (message ?? "").trim() || null,
  };
  const { error } = await (supabase as any).from("circle_connection_requests").insert(payload);
  if (error) throw error;
}

export async function cancelCircleRequest(requestId: string) {
  const id = String(requestId ?? "").trim();
  if (!id) return;
  const { error } = await (supabase as any)
    .from("circle_connection_requests")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) throw error;
}

export async function respondToCircleRequest(requestId: string, accept: boolean) {
  const id = String(requestId ?? "").trim();
  if (!id) throw new Error("Missing request id.");
  const { data, error } = await (supabase as any).rpc("respond_circle_connection_request", {
    p_request_id: id,
    p_accept: !!accept,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export function subscribeCircleRequests(onChange: () => void) {
  const channel = supabase
    .channel("circle_connection_requests:realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "circle_connection_requests" },
      () => onChange()
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}

export function subscribeCircleMemberships(onChange: () => void) {
  const channel = supabase
    .channel("circle_memberships:realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "circle_memberships" }, () => onChange())
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}

export async function listConversationMessages(peerUserId: string, limit = 300) {
  const uid = await getCurrentUserId();
  const peer = String(peerUserId ?? "").trim();
  if (!peer) throw new Error("Missing peer user id.");

  const { data, error } = await (supabase as any)
    .from("direct_messages")
    .select("id,sender_user_id,recipient_user_id,body,created_at,read_at")
    .or(
      `and(sender_user_id.eq.${uid},recipient_user_id.eq.${peer}),and(sender_user_id.eq.${peer},recipient_user_id.eq.${uid})`
    )
    .order("created_at", { ascending: true })
    .limit(Math.max(20, Math.min(limit, 600)));
  if (error) throw error;
  return (data ?? []) as DirectMessageRow[];
}

export async function sendDirectMessage(peerUserId: string, body: string) {
  const uid = await getCurrentUserId();
  const peer = String(peerUserId ?? "").trim();
  const message = String(body ?? "").trim();
  if (!peer) throw new Error("Missing recipient.");
  if (!message) return;
  const { error } = await (supabase as any).from("direct_messages").insert({
    sender_user_id: uid,
    recipient_user_id: peer,
    body: message,
  });
  if (error) throw error;
}

export async function markConversationRead(peerUserId: string) {
  const uid = await getCurrentUserId();
  const peer = String(peerUserId ?? "").trim();
  if (!peer) return;
  const { error } = await (supabase as any)
    .from("direct_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", uid)
    .eq("sender_user_id", peer)
    .is("read_at", null);
  if (error) throw error;
}

export function subscribeDirectMessages(onInsert: (row: DirectMessageRow) => void) {
  const channel = supabase
    .channel("direct_messages:realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages" }, (payload) => {
      onInsert(payload.new as DirectMessageRow);
    })
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}

export async function listConversationPreviews() {
  const uid = await getCurrentUserId();
  const { data, error } = await (supabase as any)
    .from("direct_messages")
    .select("id,sender_user_id,recipient_user_id,body,created_at,read_at")
    .or(`sender_user_id.eq.${uid},recipient_user_id.eq.${uid}`)
    .order("created_at", { ascending: false })
    .limit(600);
  if (error) throw error;

  const rows = (data ?? []) as DirectMessageRow[];
  const byPeer = new Map<string, ConversationPreview>();

  for (const row of rows) {
    const sender = String(row.sender_user_id ?? "");
    const recipient = String(row.recipient_user_id ?? "");
    const peerUserId = sender === uid ? recipient : sender;
    if (!peerUserId) continue;
    if (!byPeer.has(peerUserId)) {
      byPeer.set(peerUserId, {
        peerUserId,
        peerName: "Egregor Member",
        peerAvatarUrl: "",
        lastMessageAt: String(row.created_at ?? ""),
        lastMessageBody: String(row.body ?? ""),
        unreadCount: 0,
      });
    }
    if (recipient === uid && !row.read_at) {
      const current = byPeer.get(peerUserId)!;
      current.unreadCount += 1;
    }
  }

  const peerIds = [...byPeer.keys()];
  if (!peerIds.length) return [] as ConversationPreview[];
  const { data: profiles, error: profilesErr } = await (supabase as any)
    .from("profiles")
    .select("id,display_name,first_name,last_name,avatar_url")
    .in("id", peerIds);
  if (profilesErr) throw profilesErr;

  const profileMap = new Map<string, any>();
  for (const profile of profiles ?? []) {
    profileMap.set(String((profile as any).id ?? ""), profile);
  }

  const out = [...byPeer.values()].map((item) => {
    const profile = profileMap.get(item.peerUserId) ?? {};
    return {
      ...item,
      peerName: compactDisplayName(profile),
      peerAvatarUrl: String(profile?.avatar_url ?? ""),
    };
  });
  out.sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));
  return out;
}
