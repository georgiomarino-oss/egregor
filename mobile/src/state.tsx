import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase/client";
import { unregisterPushTokenForCurrentUser } from "./features/notifications/pushRepo";

export type AppTheme = "light" | "dark" | "cosmic";
const KEY_APP_THEME = "prefs:appTheme";
const KEY_HIGH_CONTRAST = "prefs:highContrast";

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
  signOut: () => Promise<void>;
};

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [theme, setThemeState] = useState<AppTheme>("cosmic");
  const [highContrast, setHighContrastState] = useState(false);

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
    }
    await supabase.auth.signOut();
    // session will be cleared by onAuthStateChange; this is just belt-and-braces
    setSession(null);
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
      signOut,
    }),
    [initializing, session, theme, highContrast]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
