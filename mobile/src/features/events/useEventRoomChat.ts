import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppStateStatus, FlatList, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { supabase } from "../../supabase/client";
import type { Database } from "../../types/db";

type EventMessageRow = Database["public"]["Tables"]["event_messages"]["Row"];
type EventMessageInsert = Database["public"]["Tables"]["event_messages"]["Insert"];

type UseEventRoomChatParams = {
  eventId: string;
  hasValidEventId: boolean;
  appState: AppStateStatus;
  activeEventIdRef: React.MutableRefObject<string>;
  userIdRef: React.MutableRefObject<string>;
  ensureUserId: () => Promise<string>;
  loadProfiles: (ids: string[]) => void | Promise<void>;
  logTelemetry: (eventName: string, details?: Record<string, unknown>) => void;
};

export const CHAT_MAX_CHARS = 1000;
export const ENERGY_GIFT_VALUES = [1, 3, 7] as const;

const CHAT_BOTTOM_THRESHOLD_PX = 120;
const CHAT_RESYNC_MS = 60_000;
const CHAT_RECENT_SNAPSHOT_SIZE = 200;
const CHAT_MAX_ROWS = 1000;
const CHAT_LOAD_EARLIER_PAGE_SIZE = 50;

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sortMessagesByCreatedAt(rows: EventMessageRow[]): EventMessageRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    const ta = safeTimeMs(a.created_at);
    const tb = safeTimeMs(b.created_at);
    if (ta !== tb) return ta - tb;

    const aid = String((a as any).id ?? "");
    const bid = String((b as any).id ?? "");
    return aid.localeCompare(bid);
  });
  return copy;
}

function upsertAndSortMessage(rows: EventMessageRow[], next: EventMessageRow): EventMessageRow[] {
  const id = String((next as any).id ?? "");
  if (!id) return sortMessagesByCreatedAt([...rows, next]);

  const idx = rows.findIndex((m: any) => String(m.id ?? "") === id);
  if (idx < 0) return sortMessagesByCreatedAt([...rows, next]);

  const copy = [...rows];
  copy[idx] = next;
  return sortMessagesByCreatedAt(copy);
}

function removeMessageById(rows: EventMessageRow[], id: string): EventMessageRow[] {
  if (!id) return rows;
  return rows.filter((m: any) => String((m as any).id ?? "") !== id);
}

function mergeAndTrimMessages(
  current: EventMessageRow[],
  incoming: EventMessageRow[],
  maxRows: number
): EventMessageRow[] {
  let merged = [...current];
  for (const row of incoming) {
    merged = upsertAndSortMessage(merged, row);
  }
  if (merged.length <= maxRows) return merged;
  return merged.slice(merged.length - maxRows);
}

function reconcileSnapshotMessages(
  current: EventMessageRow[],
  snapshot: EventMessageRow[],
  maxRows: number
): EventMessageRow[] {
  const snapshotSorted = sortMessagesByCreatedAt(snapshot).slice(-maxRows);
  if (snapshotSorted.length === 0) return [];

  const snapshotIds = new Set(
    snapshotSorted
      .map((m: any) => String((m as any)?.id ?? ""))
      .filter((id: string) => !!id)
  );
  const newestSnapshotMs = snapshotSorted.reduce(
    (max, row) => Math.max(max, safeTimeMs(row.created_at)),
    0
  );
  const oldestSnapshotMs = snapshotSorted.reduce((min, row) => {
    const t = safeTimeMs(row.created_at);
    if (t <= 0) return min;
    if (min <= 0) return t;
    return Math.min(min, t);
  }, 0);

  const olderHistory = current.filter((row: any) => {
    const t = safeTimeMs((row as any)?.created_at);
    return t > 0 && oldestSnapshotMs > 0 && t < oldestSnapshotMs;
  });

  const recentLocal = current.filter((row: any) => {
    const id = String((row as any)?.id ?? "");
    if (id && snapshotIds.has(id)) return false;
    return safeTimeMs((row as any)?.created_at) > newestSnapshotMs;
  });

  const merged = sortMessagesByCreatedAt([...olderHistory, ...snapshotSorted, ...recentLocal]);
  if (merged.length <= CHAT_MAX_ROWS) return merged;
  return merged.slice(merged.length - CHAT_MAX_ROWS);
}

function prependAndTrimMessages(
  current: EventMessageRow[],
  olderRows: EventMessageRow[],
  maxRows: number
): EventMessageRow[] {
  let merged = [...current];
  for (const row of olderRows) {
    merged = upsertAndSortMessage(merged, row);
  }
  if (merged.length <= maxRows) return merged;
  return merged.slice(merged.length - maxRows);
}

function mapChatSendError(message: string) {
  const m = String(message ?? "").toLowerCase();
  if (m.includes("too many messages")) {
    return {
      title: "Slow down",
      body: "You are sending messages too quickly. Please wait a few seconds and try again.",
    };
  }
  if (m.includes("cannot be empty")) {
    return {
      title: "Empty message",
      body: "Type a message before sending.",
    };
  }
  if (m.includes("exceeds 1000 characters")) {
    return {
      title: "Message too long",
      body: `Keep messages under ${CHAT_MAX_CHARS} characters.`,
    };
  }
  return {
    title: "Send failed",
    body: message || "Unknown error",
  };
}

export function useEventRoomChat({
  eventId,
  hasValidEventId,
  appState,
  activeEventIdRef,
  userIdRef,
  ensureUserId,
  loadProfiles,
  logTelemetry,
}: UseEventRoomChatParams) {
  const [messages, setMessages] = useState<EventMessageRow[]>([]);
  const [chatText, setChatText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingEnergy, setSendingEnergy] = useState<number | null>(null);
  const [pendingMessageCount, setPendingMessageCount] = useState(0);
  const [unreadMarkerMessageId, setUnreadMarkerMessageId] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasEarlierMessages, setHasEarlierMessages] = useState(false);

  const chatListRef = useRef<FlatList<EventMessageRow>>(null);
  const chatContentHeightRef = useRef(0);
  const chatScrollOffsetYRef = useRef(0);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const pendingScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPrependingHistoryRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const appStateRef = useRef<AppStateStatus>(appState);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  const scrollChatToEnd = useCallback((animated = true) => {
    try {
      chatListRef.current?.scrollToEnd({ animated });
    } catch {
      // ignore
    }
  }, []);

  const scheduleScrollToEnd = useCallback(
    (targetEventId: string, animated = true) => {
      if (pendingScrollTimeoutRef.current) {
        clearTimeout(pendingScrollTimeoutRef.current);
        pendingScrollTimeoutRef.current = null;
      }
      pendingScrollTimeoutRef.current = setTimeout(() => {
        pendingScrollTimeoutRef.current = null;
        if (activeEventIdRef.current !== targetEventId) return;
        if (appStateRef.current !== "active") return;
        scrollChatToEnd(animated);
      }, 30);
    },
    [activeEventIdRef, scrollChatToEnd]
  );

  useEffect(() => {
    return () => {
      if (pendingScrollTimeoutRef.current) {
        clearTimeout(pendingScrollTimeoutRef.current);
        pendingScrollTimeoutRef.current = null;
      }
    };
  }, []);

  const onChatScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    chatScrollOffsetYRef.current = contentOffset.y;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const nearBottom = distanceFromBottom <= CHAT_BOTTOM_THRESHOLD_PX;
    shouldAutoScrollRef.current = nearBottom;

    if (nearBottom) {
      setPendingMessageCount(0);
      setUnreadMarkerMessageId(null);
    }
  }, []);

  const onChatContentSizeChange = useCallback(
    (_: number, height: number) => {
      const previousHeight = chatContentHeightRef.current;
      chatContentHeightRef.current = height;

      if (isPrependingHistoryRef.current) {
        isPrependingHistoryRef.current = false;
        if (previousHeight > 0 && height > previousHeight) {
          const delta = height - previousHeight;
          const nextOffset = Math.max(0, chatScrollOffsetYRef.current + delta);
          chatScrollOffsetYRef.current = nextOffset;
          try {
            chatListRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
          } catch {
            // ignore
          }
        }
        return;
      }

      if (shouldAutoScrollRef.current) {
        scrollChatToEnd(false);
        return;
      }

      if (previousHeight > 0 && height > previousHeight) {
        const delta = height - previousHeight;
        const nextOffset = Math.max(0, chatScrollOffsetYRef.current + delta);
        chatScrollOffsetYRef.current = nextOffset;
        try {
          chatListRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
        } catch {
          // ignore
        }
      }
    },
    [scrollChatToEnd]
  );

  const loadMessages = useCallback(
    async (reason = "manual") => {
      if (!hasValidEventId) {
        setMessages([]);
        messageIdsRef.current = new Set();
        setHasEarlierMessages(false);
        return;
      }

      logTelemetry("chat_resync_attempt", { reason });
      const { data, error } = await supabase
        .from("event_messages")
        .select("id,event_id,user_id,body,created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(CHAT_RECENT_SNAPSHOT_SIZE);

      if (error) {
        logTelemetry("chat_resync_error", { reason, message: error.message });
        return;
      }
      if (activeEventIdRef.current !== eventId) return;

      const rows = (data ?? []) as EventMessageRow[];
      const knownIds = new Set(messageIdsRef.current);
      const currentUserId = userIdRef.current;
      const missedOtherMessages = rows
        .filter((row: any) => {
          const id = String((row as any)?.id ?? "");
          if (!id || knownIds.has(id)) return false;
          const rowUserId = String((row as any)?.user_id ?? "");
          return !currentUserId || rowUserId !== currentUserId;
        })
        .sort((a, b) => safeTimeMs(a.created_at) - safeTimeMs(b.created_at));

      setMessages((prev) => {
        const merged = reconcileSnapshotMessages(prev, rows, CHAT_RECENT_SNAPSHOT_SIZE);
        messageIdsRef.current = new Set(
          merged
            .map((m: any) => String((m as any)?.id ?? ""))
            .filter((id: string) => !!id)
        );
        return merged;
      });
      if (reason === "initial" || reason === "room_load" || reason === "manual") {
        setHasEarlierMessages(rows.length >= CHAT_RECENT_SNAPSHOT_SIZE);
      }
      if (shouldAutoScrollRef.current) {
        setPendingMessageCount(0);
        setUnreadMarkerMessageId(null);
      } else if (missedOtherMessages.length > 0) {
        const oldestMissedId = String((missedOtherMessages[0] as any)?.id ?? "");
        setPendingMessageCount((count) => count + missedOtherMessages.length);
        if (oldestMissedId) {
          setUnreadMarkerMessageId((cur) => cur ?? oldestMissedId);
        }
      }
      void loadProfiles(rows.map((m) => String((m as any).user_id ?? "")));
      logTelemetry("chat_resync_success", { reason, count: rows.length });
    },
    [activeEventIdRef, eventId, hasValidEventId, loadProfiles, logTelemetry, userIdRef]
  );

  const loadEarlierMessages = useCallback(async () => {
    if (!hasValidEventId || loadingEarlier || !hasEarlierMessages || messages.length === 0) return;
    const targetEventId = eventId;
    const isStale = () => activeEventIdRef.current !== targetEventId;
    const oldestLoadedCreatedAt = messages[0]?.created_at ?? null;
    if (!oldestLoadedCreatedAt) return;

    setLoadingEarlier(true);
    try {
      const { data, error } = await supabase
        .from("event_messages")
        .select("id,event_id,user_id,body,created_at")
        .eq("event_id", targetEventId)
        .lt("created_at", oldestLoadedCreatedAt)
        .order("created_at", { ascending: false })
        .limit(CHAT_LOAD_EARLIER_PAGE_SIZE + 1);

      if (isStale()) return;
      if (error) {
        logTelemetry("chat_load_earlier_error", { message: error.message });
        return;
      }

      const rows = (data ?? []) as EventMessageRow[];
      const hasMore = rows.length > CHAT_LOAD_EARLIER_PAGE_SIZE;
      const pageRows = sortMessagesByCreatedAt(rows.slice(0, CHAT_LOAD_EARLIER_PAGE_SIZE));
      setHasEarlierMessages(hasMore);
      if (pageRows.length === 0) return;

      isPrependingHistoryRef.current = true;
      shouldAutoScrollRef.current = false;
      setMessages((prev) => {
        const merged = prependAndTrimMessages(prev, pageRows, CHAT_MAX_ROWS);
        messageIdsRef.current = new Set(
          merged
            .map((m: any) => String((m as any)?.id ?? ""))
            .filter((id: string) => !!id)
        );
        return merged;
      });
      void loadProfiles(pageRows.map((m: any) => String((m as any).user_id ?? "")));
      logTelemetry("chat_load_earlier_success", { count: pageRows.length, hasMore });
    } finally {
      if (!isStale()) setLoadingEarlier(false);
    }
  }, [
    activeEventIdRef,
    eventId,
    hasEarlierMessages,
    hasValidEventId,
    loadProfiles,
    loadingEarlier,
    logTelemetry,
    messages,
  ]);

  const sendMessage = useCallback(async () => {
    const targetEventId = eventId;
    const isStale = () => activeEventIdRef.current !== targetEventId;
    const text = chatText.trim();
    if (!text) return;
    if (text.length > CHAT_MAX_CHARS) {
      Alert.alert("Message too long", `Keep messages under ${CHAT_MAX_CHARS} characters.`);
      return;
    }

    const uid = await ensureUserId();
    if (!uid) {
      Alert.alert("Not signed in", "Please sign in first.");
      return;
    }

    if (!hasValidEventId) return;

    setSending(true);
    try {
      const payload: EventMessageInsert = {
        event_id: targetEventId,
        user_id: uid,
        body: text,
      };

      const { error } = await supabase.from("event_messages").insert(payload);
      if (isStale()) return;
      if (error) {
        const mapped = mapChatSendError(error.message);
        Alert.alert(mapped.title, mapped.body);
        return;
      }

      setChatText("");
      shouldAutoScrollRef.current = true;
      setPendingMessageCount(0);
      setUnreadMarkerMessageId(null);
      scheduleScrollToEnd(targetEventId, true);
    } finally {
      if (!isStale()) setSending(false);
    }
  }, [activeEventIdRef, chatText, ensureUserId, eventId, hasValidEventId, scheduleScrollToEnd]);

  const sendEnergyGift = useCallback(
    async (amount: number) => {
      const targetEventId = eventId;
      const isStale = () => activeEventIdRef.current !== targetEventId;
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (!hasValidEventId) return;

      const uid = await ensureUserId();
      if (!uid) {
        Alert.alert("Not signed in", "Please sign in first.");
        return;
      }

      setSendingEnergy(amount);
      try {
        const payload: EventMessageInsert = {
          event_id: targetEventId,
          user_id: uid,
          body: `Sent ${amount} energy to this circle.`,
        };

        const { error } = await supabase.from("event_messages").insert(payload);
        if (isStale()) return;
        if (error) {
          const mapped = mapChatSendError(error.message);
          Alert.alert(mapped.title, mapped.body);
          return;
        }

        shouldAutoScrollRef.current = true;
        setPendingMessageCount(0);
        setUnreadMarkerMessageId(null);
        scheduleScrollToEnd(targetEventId, true);
      } finally {
        if (!isStale()) setSendingEnergy(null);
      }
    },
    [activeEventIdRef, ensureUserId, eventId, hasValidEventId, scheduleScrollToEnd]
  );

  useEffect(() => {
    if (!hasValidEventId) return;

    let disposed = false;
    const resync = () => {
      if (disposed) return;
      void loadMessages("interval");
    };

    void loadMessages("initial");
    const intervalId = setInterval(resync, CHAT_RESYNC_MS);

    const ch = supabase
      .channel(`chat:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_messages",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          if (activeEventIdRef.current !== eventId) return;
          const eventType = String((payload as any).eventType ?? "");
          const nextRow = (payload.new ?? null) as EventMessageRow | null;
          const prevRow = (payload.old ?? null) as EventMessageRow | null;
          const nextId = String((nextRow as any)?.id ?? "");
          const prevId = String((prevRow as any)?.id ?? "");
          const targetId = nextId || prevId;

          if (eventType === "DELETE") {
            if (!targetId) return;
            messageIdsRef.current.delete(targetId);
            setMessages((prev) => removeMessageById(prev, targetId));
            setPendingMessageCount((count) => Math.max(0, count - 1));
            setUnreadMarkerMessageId((cur) => (cur === targetId ? null : cur));
            return;
          }

          if (!nextRow) return;

          const rowUserId = String((nextRow as any).user_id ?? "");
          const currentUserId = userIdRef.current;
          const isMine = !!currentUserId && rowUserId === currentUserId;
          const insertedNew = !!nextId && !messageIdsRef.current.has(nextId);
          if (nextId) messageIdsRef.current.add(nextId);

          setMessages((prev) => {
            const merged = mergeAndTrimMessages(prev, [nextRow], CHAT_MAX_ROWS);
            const insertedIdx = merged.findIndex((m: any) => String((m as any).id ?? "") === nextId);
            const expectedTailIdx = Math.max(0, merged.length - 1);

            if (insertedNew && insertedIdx >= 0 && insertedIdx < expectedTailIdx) {
              logTelemetry("chat_reorder_correction", {
                insertedIdx,
                expectedTailIdx,
                createdAt: nextRow.created_at ?? null,
              });
            } else if (!insertedNew) {
              logTelemetry("chat_dedupe_hit", { id: nextId });
            }

            return merged;
          });

          void loadProfiles([rowUserId]);

          if (eventType !== "INSERT") return;

          if (shouldAutoScrollRef.current) {
            scheduleScrollToEnd(eventId, true);
            setPendingMessageCount(0);
            setUnreadMarkerMessageId(null);
          } else if (!isMine && insertedNew) {
            setPendingMessageCount((count) => {
              if (count === 0 && nextId) setUnreadMarkerMessageId(nextId);
              return count + 1;
            });
          }
        }
      )
      .subscribe((status) => {
        logTelemetry("chat_channel_status", { status });
      });

    return () => {
      disposed = true;
      clearInterval(intervalId);
      supabase.removeChannel(ch);
    };
  }, [activeEventIdRef, eventId, hasValidEventId, loadMessages, loadProfiles, logTelemetry, scheduleScrollToEnd, userIdRef]);

  const jumpToLatestMessages = useCallback(() => {
    setPendingMessageCount(0);
    setUnreadMarkerMessageId(null);
    shouldAutoScrollRef.current = true;
    scrollChatToEnd(true);
  }, [scrollChatToEnd]);

  const resetForEventChange = useCallback(() => {
    setPendingMessageCount(0);
    setUnreadMarkerMessageId(null);
    setLoadingEarlier(false);
    setHasEarlierMessages(false);
    setChatText("");
    setSending(false);
    setSendingEnergy(null);
    shouldAutoScrollRef.current = true;
    chatContentHeightRef.current = 0;
    chatScrollOffsetYRef.current = 0;
    isPrependingHistoryRef.current = false;
  }, []);

  const chatChars = chatText.length;

  return {
    chatListRef,
    messages,
    chatText,
    setChatText,
    sending,
    sendingEnergy,
    pendingMessageCount,
    unreadMarkerMessageId,
    loadingEarlier,
    hasEarlierMessages,
    chatChars,
    loadMessages,
    loadEarlierMessages,
    sendMessage,
    sendEnergyGift,
    jumpToLatestMessages,
    onChatScroll,
    onChatContentSizeChange,
    resetForEventChange,
  };
}

