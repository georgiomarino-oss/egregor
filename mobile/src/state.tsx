import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";

export type AppStateContextValue = {
  initializing: boolean;
  session: Session | null;
  user: User | null;
  signedIn: boolean;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

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

  const signOut = async () => {
    const uid = session?.user?.id ?? null;
    if (uid) {
      try {
        await supabase.from("event_presence").delete().eq("user_id", uid);
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
      refreshSession,
      signOut,
    }),
    [initializing, session]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
