import { useCallback, useEffect, useState } from "react";
import {
  ensureRunState,
  normalizeRunState,
  setRunStateServerTime,
  subscribeRunState,
  type EventRunMode,
  type EventRunStateV1,
} from "./runStateRepo";

type UseEventRoomRunStateParams = {
  eventId: string;
  hasValidEventId: boolean;
  sectionCount: number;
  activeEventIdRef: React.MutableRefObject<string>;
  logTelemetry: (eventName: string, details?: Record<string, unknown>) => void;
};

const RUN_STATE_RESYNC_MS = 60_000;

function nowIso() {
  return new Date().toISOString();
}

function secondsBetweenIso(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 1000));
}

export function useEventRoomRunState({
  eventId,
  hasValidEventId,
  sectionCount,
  activeEventIdRef,
  logTelemetry,
}: UseEventRoomRunStateParams) {
  const [runState, setRunState] = useState<EventRunStateV1>({
    version: 1,
    mode: "idle",
    sectionIndex: 0,
  });
  const [runReady, setRunReady] = useState(false);
  const [runErr, setRunErr] = useState("");

  useEffect(() => {
    setRunState({ version: 1, mode: "idle", sectionIndex: 0 });
    setRunReady(false);
    setRunErr("");
  }, [eventId]);

  const clampSectionIndex = useCallback(
    (idx: number) => {
      if (sectionCount <= 0) return 0;
      return Math.min(Math.max(0, idx), sectionCount - 1);
    },
    [sectionCount]
  );

  const loadRunState = useCallback(
    async (reason = "manual") => {
      if (!hasValidEventId) {
        setRunReady(false);
        return;
      }

      const targetEventId = eventId;
      try {
        logTelemetry("run_state_resync_attempt", { reason });
        const row = await ensureRunState(targetEventId);
        if (activeEventIdRef.current !== targetEventId) return;
        setRunState(normalizeRunState(row.state));
        setRunReady(true);
        logTelemetry("run_state_resync_success", { reason });
      } catch (e: any) {
        if (activeEventIdRef.current !== targetEventId) return;
        logTelemetry("run_state_resync_error", { reason, message: e?.message ?? "Unknown error" });
      }
    },
    [eventId, hasValidEventId, activeEventIdRef, logTelemetry]
  );

  useEffect(() => {
    if (!hasValidEventId) return;

    let disposed = false;
    const resync = async () => {
      if (disposed) return;
      await loadRunState("interval");
    };

    void loadRunState("initial");
    const intervalId = setInterval(() => {
      void resync();
    }, RUN_STATE_RESYNC_MS);

    const sub = subscribeRunState(eventId, (row) => {
      if (disposed || activeEventIdRef.current !== eventId) return;
      setRunState(normalizeRunState(row.state));
      setRunReady(true);
    });

    return () => {
      disposed = true;
      clearInterval(intervalId);
      logTelemetry("run_state_resync_stop");
      sub.unsubscribe();
    };
  }, [eventId, hasValidEventId, activeEventIdRef, loadRunState, logTelemetry]);

  const hostSetViaServer = useCallback(
    async (
      mode: EventRunMode,
      sectionIndex: number,
      elapsedBeforePauseSec: number,
      resetTimer: boolean
    ) => {
      if (!hasValidEventId) return;

      const targetEventId = eventId;
      const row = await setRunStateServerTime({
        eventId: targetEventId,
        mode,
        sectionIndex,
        elapsedBeforePauseSec,
        resetTimer,
      });
      if (activeEventIdRef.current !== targetEventId) return;

      setRunState(normalizeRunState(row.state));
      setRunReady(true);
    },
    [eventId, hasValidEventId, activeEventIdRef]
  );

  const hostStart = useCallback(async () => {
    try {
      setRunErr("");
      const idx = clampSectionIndex(runState.sectionIndex ?? 0);
      await hostSetViaServer("running", idx, 0, true);
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to start.");
    }
  }, [clampSectionIndex, hostSetViaServer, runState.sectionIndex]);

  const hostRestart = useCallback(async () => {
    try {
      setRunErr("");
      const idx = clampSectionIndex(runState.sectionIndex ?? 0);
      await hostSetViaServer("running", idx, 0, true);
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to restart.");
    }
  }, [clampSectionIndex, hostSetViaServer, runState.sectionIndex]);

  const hostPause = useCallback(async () => {
    if (runState.mode !== "running" || !runState.startedAt) return;

    try {
      setRunErr("");
      const elapsedThisRun = secondsBetweenIso(runState.startedAt, nowIso());
      const accumulated = (runState.elapsedBeforePauseSec ?? 0) + elapsedThisRun;

      await hostSetViaServer("paused", clampSectionIndex(runState.sectionIndex), accumulated, false);
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to pause.");
    }
  }, [clampSectionIndex, hostSetViaServer, runState]);

  const hostResume = useCallback(async () => {
    if (runState.mode !== "paused") return;

    try {
      setRunErr("");
      await hostSetViaServer(
        "running",
        clampSectionIndex(runState.sectionIndex),
        runState.elapsedBeforePauseSec ?? 0,
        false
      );
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to resume.");
    }
  }, [clampSectionIndex, hostSetViaServer, runState]);

  const hostEnd = useCallback(async () => {
    try {
      setRunErr("");
      await hostSetViaServer(
        "ended",
        clampSectionIndex(runState.sectionIndex),
        runState.elapsedBeforePauseSec ?? 0,
        false
      );
    } catch (e: any) {
      setRunErr(e?.message ?? "Failed to end session.");
    }
  }, [clampSectionIndex, hostSetViaServer, runState]);

  const hostGoTo = useCallback(
    async (idx: number) => {
      const nextIndex = clampSectionIndex(idx);

      if (runState.mode === "running") {
        await hostSetViaServer("running", nextIndex, 0, true);
        return;
      }
      if (runState.mode === "paused") {
        await hostSetViaServer("paused", nextIndex, 0, true);
        return;
      }
      await hostSetViaServer(runState.mode, nextIndex, 0, true);
    },
    [clampSectionIndex, hostSetViaServer, runState.mode]
  );

  return {
    runState,
    runReady,
    runErr,
    setRunErr,
    clampSectionIndex,
    loadRunState,
    hostStart,
    hostRestart,
    hostPause,
    hostResume,
    hostEnd,
    hostGoTo,
  };
}
