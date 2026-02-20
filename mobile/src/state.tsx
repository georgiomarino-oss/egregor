import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase/client";
import {
  logoutBilling,
  purchaseCircleMembership,
  refreshBillingSnapshot,
  restoreCircleMembership,
  type CirclePackage,
} from "./features/billing/billingRepo";
import { logMonetizationEvent } from "./features/billing/billingAnalyticsRepo";
import { unregisterPushTokenForCurrentUser } from "./features/notifications/pushRepo";

export type AppTheme = "light" | "dark" | "cosmic";
const KEY_APP_THEME = "prefs:appTheme";
const KEY_HIGH_CONTRAST = "prefs:highContrast";
const MEMBERSHIP_SYNC_MAX_WAIT_MS = 12_000;
const MEMBERSHIP_SYNC_POLL_MS = 1_500;

export type CircleActionResult = {
  ok: boolean;
  message: string;
};

export type AppStateContextValue = {
  initializing: boolean;
  session: Session | null;
  user: User | null;
  signedIn: boolean;
  theme: AppTheme;
  highContrast: boolean;
  setTheme: (nextTheme: AppTheme) => Promise<void>;
  setHighContrast: (enabled: boolean) => Promise<void>;
  refreshSession: () => Promise<void>;
  billingReady: boolean;
  billingAvailable: boolean;
  billingError: string | null;
  isCircleMember: boolean;
  circleExpiresAt: string | null;
  circlePackages: CirclePackage[];
  refreshBilling: () => Promise<void>;
  purchaseCircle: (packageIdentifier?: string) => Promise<CircleActionResult>;
  restoreCircle: () => Promise<CircleActionResult>;
  signOut: () => Promise<void>;
};

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined);

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerCircleMembership(args: {
  userId: string;
  shouldBeMember: boolean;
  maxWaitMs?: number;
  pollMs?: number;
}) {
  const start = Date.now();
  const maxWaitMs = Math.max(1_000, args.maxWaitMs ?? MEMBERSHIP_SYNC_MAX_WAIT_MS);
  const pollMs = Math.max(500, args.pollMs ?? MEMBERSHIP_SYNC_POLL_MS);
  let lastError = "";

  while (Date.now() - start <= maxWaitMs) {
    const { data, error } = await supabase.rpc("is_circle_member", { p_user_id: args.userId });
    if (!error) {
      if (!!data === args.shouldBeMember) {
        return { synced: true, waitedMs: Date.now() - start, error: "" };
      }
    } else {
      lastError = String(error.message ?? "unknown error");
    }

    const elapsed = Date.now() - start;
    if (elapsed >= maxWaitMs) break;
    await sleepMs(Math.min(pollMs, maxWaitMs - elapsed));
  }

  return { synced: false, waitedMs: Date.now() - start, error: lastError };
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [theme, setThemeState] = useState<AppTheme>("cosmic");
  const [highContrast, setHighContrastState] = useState(false);
  const [billingReady, setBillingReady] = useState(false);
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [isCircleMember, setIsCircleMember] = useState(false);
  const [circleExpiresAt, setCircleExpiresAt] = useState<string | null>(null);
  const [circlePackages, setCirclePackages] = useState<CirclePackage[]>([]);

  const refreshSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setSession(null);
      return;
    }
    setSession(data.session ?? null);
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (error) {
          setSession(null);
          setInitializing(false);
          return;
        }
        setSession(data.session ?? null);
        setInitializing(false);
      } catch {
        if (!mounted) return;
        setSession(null);
        setInitializing(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession ?? null);
      setInitializing(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY_APP_THEME);
        if (!mounted) return;
        if (raw === "light" || raw === "dark" || raw === "cosmic") {
          setThemeState(raw);
        }
      } catch {
        // ignore and keep default
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY_HIGH_CONTRAST);
        if (!mounted) return;
        setHighContrastState(raw === "1");
      } catch {
        // ignore and keep default
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setTheme = async (nextTheme: AppTheme) => {
    setThemeState(nextTheme);
    try {
      await AsyncStorage.setItem(KEY_APP_THEME, nextTheme);
    } catch {
      // ignore
    }
  };

  const setHighContrast = async (enabled: boolean) => {
    setHighContrastState(enabled);
    try {
      await AsyncStorage.setItem(KEY_HIGH_CONTRAST, enabled ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const applyBillingSnapshot = (snapshot: {
    available: boolean;
    error: string | null;
    isCircleMember: boolean;
    expiresAt: string | null;
    packages: CirclePackage[];
  }) => {
    setBillingAvailable(snapshot.available);
    setBillingError(snapshot.error);
    setIsCircleMember(snapshot.isCircleMember);
    setCircleExpiresAt(snapshot.expiresAt);
    setCirclePackages(snapshot.packages);
  };

  const resetBilling = () => {
    setBillingReady(true);
    setBillingAvailable(false);
    setBillingError(null);
    setIsCircleMember(false);
    setCircleExpiresAt(null);
    setCirclePackages([]);
  };

  const refreshBilling = async () => {
    const uid = session?.user?.id ?? "";
    if (!uid) {
      resetBilling();
      return;
    }

    void logMonetizationEvent({
      userId: uid,
      eventName: "billing_status_refresh",
      stage: "attempt",
      metadata: { source: "AppStateProvider.refreshBilling" },
    });

    setBillingReady(false);
    const snapshot = await refreshBillingSnapshot(uid);
    applyBillingSnapshot(snapshot);
    setBillingReady(true);

    if (snapshot.error) {
      void logMonetizationEvent({
        userId: uid,
        eventName: "billing_status_refresh",
        stage: "failure",
        isCircleMember: snapshot.isCircleMember,
        errorMessage: snapshot.error,
        metadata: {
          billingAvailable: snapshot.available,
          billingConfigured: snapshot.configured,
          packageCount: snapshot.packages.length,
        },
      });
      return;
    }

    void logMonetizationEvent({
      userId: uid,
      eventName: "billing_status_refresh",
      stage: "success",
      isCircleMember: snapshot.isCircleMember,
      metadata: {
        billingAvailable: snapshot.available,
        billingConfigured: snapshot.configured,
        packageCount: snapshot.packages.length,
        expiresAt: snapshot.expiresAt,
      },
    });
  };

  const purchaseCircle = async (packageIdentifier?: string): Promise<CircleActionResult> => {
    const uid = session?.user?.id ?? "";
    if (!uid) return { ok: false, message: "Please sign in first." };

    void logMonetizationEvent({
      userId: uid,
      eventName: "circle_purchase",
      stage: "attempt",
      packageIdentifier,
      metadata: { source: "AppStateProvider.purchaseCircle" },
    });

    setBillingReady(false);
    const snapshot = await purchaseCircleMembership({ userId: uid, packageIdentifier });
    applyBillingSnapshot(snapshot);
    setBillingReady(true);

    if (snapshot.error) {
      const stage = snapshot.error === "Purchase cancelled." ? "cancelled" : "failure";
      void logMonetizationEvent({
        userId: uid,
        eventName: "circle_purchase",
        stage,
        packageIdentifier,
        isCircleMember: snapshot.isCircleMember,
        errorMessage: snapshot.error,
        metadata: {
          billingAvailable: snapshot.available,
          billingConfigured: snapshot.configured,
          packageCount: snapshot.packages.length,
        },
      });
      return { ok: false, message: snapshot.error };
    }
    if (!snapshot.isCircleMember) {
      const message = "Purchase did not activate Circle access yet.";
      void logMonetizationEvent({
        userId: uid,
        eventName: "circle_purchase",
        stage: "failure",
        packageIdentifier,
        isCircleMember: snapshot.isCircleMember,
        errorMessage: message,
        metadata: {
          billingAvailable: snapshot.available,
          billingConfigured: snapshot.configured,
          packageCount: snapshot.packages.length,
        },
      });
      return { ok: false, message: "Purchase did not activate Circle access yet." };
    }

    void logMonetizationEvent({
      userId: uid,
      eventName: "circle_purchase",
      stage: "success",
      packageIdentifier,
      isCircleMember: snapshot.isCircleMember,
      metadata: {
        expiresAt: snapshot.expiresAt,
        packageCount: snapshot.packages.length,
      },
    });

    void logMonetizationEvent({
      userId: uid,
      eventName: "circle_membership_sync",
      stage: "attempt",
      packageIdentifier,
      isCircleMember: snapshot.isCircleMember,
      metadata: {
        source: "purchase",
        shouldBeMember: true,
      },
    });
    const sync = await waitForServerCircleMembership({
      userId: uid,
      shouldBeMember: true,
    });
    void logMonetizationEvent({
      userId: uid,
      eventName: "circle_membership_sync",
      stage: sync.synced ? "success" : "failure",
      packageIdentifier,
      isCircleMember: snapshot.isCircleMember,
      errorMessage: sync.synced ? null : sync.error || "server membership not synced in wait window",
      metadata: {
        source: "purchase",
        shouldBeMember: true,
        waitedMs: sync.waitedMs,
        maxWaitMs: MEMBERSHIP_SYNC_MAX_WAIT_MS,
        pollMs: MEMBERSHIP_SYNC_POLL_MS,
      },
    });

    if (!sync.synced) {
      return {
        ok: true,
        message:
          "Egregor Circle is active. Server sync may take up to a minute before unlimited AI appears.",
      };
    }
    return { ok: true, message: "Egregor Circle is now active." };
  };

  const restoreCircle = async (): Promise<CircleActionResult> => {
    const uid = session?.user?.id ?? "";
    if (!uid) return { ok: false, message: "Please sign in first." };

    void logMonetizationEvent({
      userId: uid,
      eventName: "circle_restore",
      stage: "attempt",
      metadata: { source: "AppStateProvider.restoreCircle" },
    });

    setBillingReady(false);
    const snapshot = await restoreCircleMembership(uid);
    applyBillingSnapshot(snapshot);
    setBillingReady(true);

    if (snapshot.error) {
      void logMonetizationEvent({
        userId: uid,
        eventName: "circle_restore",
        stage: "failure",
        isCircleMember: snapshot.isCircleMember,
        errorMessage: snapshot.error,
        metadata: {
          billingAvailable: snapshot.available,
          billingConfigured: snapshot.configured,
          packageCount: snapshot.packages.length,
        },
      });
      return { ok: false, message: snapshot.error };
    }
    if (!snapshot.isCircleMember) {
      const message = "No active Circle entitlement found to restore.";
      void logMonetizationEvent({
        userId: uid,
        eventName: "circle_restore",
        stage: "failure",
        isCircleMember: snapshot.isCircleMember,
        errorMessage: message,
        metadata: {
          billingAvailable: snapshot.available,
          billingConfigured: snapshot.configured,
          packageCount: snapshot.packages.length,
        },
      });
      return { ok: false, message };
    }

    void logMonetizationEvent({
      userId: uid,
      eventName: "circle_restore",
      stage: "success",
      isCircleMember: snapshot.isCircleMember,
      metadata: {
        expiresAt: snapshot.expiresAt,
        packageCount: snapshot.packages.length,
      },
    });

    void logMonetizationEvent({
      userId: uid,
      eventName: "circle_membership_sync",
      stage: "attempt",
      isCircleMember: snapshot.isCircleMember,
      metadata: {
        source: "restore",
        shouldBeMember: true,
      },
    });
    const sync = await waitForServerCircleMembership({
      userId: uid,
      shouldBeMember: true,
    });
    void logMonetizationEvent({
      userId: uid,
      eventName: "circle_membership_sync",
      stage: sync.synced ? "success" : "failure",
      isCircleMember: snapshot.isCircleMember,
      errorMessage: sync.synced ? null : sync.error || "server membership not synced in wait window",
      metadata: {
        source: "restore",
        shouldBeMember: true,
        waitedMs: sync.waitedMs,
        maxWaitMs: MEMBERSHIP_SYNC_MAX_WAIT_MS,
        pollMs: MEMBERSHIP_SYNC_POLL_MS,
      },
    });

    if (!sync.synced) {
      return {
        ok: true,
        message:
          "Restore succeeded. Server sync may take up to a minute before unlimited AI appears.",
      };
    }
    return { ok: true, message: "Circle purchase restored." };
  };

  useEffect(() => {
    let cancelled = false;
    const uid = session?.user?.id ?? "";
    if (!uid) {
      resetBilling();
      return;
    }

    setBillingReady(false);
    void refreshBillingSnapshot(uid).then((snapshot) => {
      if (cancelled) return;
      applyBillingSnapshot(snapshot);
      setBillingReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const signOut = async () => {
    const uid = session?.user?.id ?? null;
    if (uid) {
      try {
        await supabase.from("event_presence").delete().eq("user_id", uid);
      } catch {
        // best effort: auth signout should still proceed
      }
      try {
        await unregisterPushTokenForCurrentUser();
      } catch {
        // best effort: auth signout should still proceed
      }
      try {
        await logoutBilling();
      } catch {
        // best effort: auth signout should still proceed
      }
    }
    await supabase.auth.signOut();
    // session will be cleared by onAuthStateChange; this is just belt-and-braces
    setSession(null);
    resetBilling();
  };

  const value = useMemo<AppStateContextValue>(
    () => ({
      initializing,
      session,
      user: session?.user ?? null,
      signedIn: !!session?.user,
      theme,
      highContrast,
      setTheme,
      setHighContrast,
      refreshSession,
      billingReady,
      billingAvailable,
      billingError,
      isCircleMember,
      circleExpiresAt,
      circlePackages,
      refreshBilling,
      purchaseCircle,
      restoreCircle,
      signOut,
    }),
    [
      initializing,
      session,
      theme,
      highContrast,
      billingReady,
      billingAvailable,
      billingError,
      isCircleMember,
      circleExpiresAt,
      circlePackages,
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
