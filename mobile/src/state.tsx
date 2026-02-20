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
import { unregisterPushTokenForCurrentUser } from "./features/notifications/pushRepo";

export type AppTheme = "light" | "dark" | "cosmic";
const KEY_APP_THEME = "prefs:appTheme";
const KEY_HIGH_CONTRAST = "prefs:highContrast";

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

    setBillingReady(false);
    const snapshot = await refreshBillingSnapshot(uid);
    applyBillingSnapshot(snapshot);
    setBillingReady(true);
  };

  const purchaseCircle = async (packageIdentifier?: string): Promise<CircleActionResult> => {
    const uid = session?.user?.id ?? "";
    if (!uid) return { ok: false, message: "Please sign in first." };

    setBillingReady(false);
    const snapshot = await purchaseCircleMembership({ userId: uid, packageIdentifier });
    applyBillingSnapshot(snapshot);
    setBillingReady(true);

    if (snapshot.error) {
      return { ok: false, message: snapshot.error };
    }
    if (!snapshot.isCircleMember) {
      return { ok: false, message: "Purchase did not activate Circle access yet." };
    }
    return { ok: true, message: "Egregor Circle is now active." };
  };

  const restoreCircle = async (): Promise<CircleActionResult> => {
    const uid = session?.user?.id ?? "";
    if (!uid) return { ok: false, message: "Please sign in first." };

    setBillingReady(false);
    const snapshot = await restoreCircleMembership(uid);
    applyBillingSnapshot(snapshot);
    setBillingReady(true);

    if (snapshot.error) {
      return { ok: false, message: snapshot.error };
    }
    if (!snapshot.isCircleMember) {
      return { ok: false, message: "No active Circle entitlement found to restore." };
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
