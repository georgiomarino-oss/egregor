import React, { useEffect, useMemo, useState } from "react";
import { Text, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parseJsonSafe, apiFetch } from "./src/api";
import { AppStateContext, TOKEN_KEY, type AppStateShape } from "./src/state";
import type {
  EventItem,
  GeneratedScript,
  RootStackParamList,
  ScriptListItem,
  Tone
} from "./src/types";

import AuthScreen from "./src/screens/AuthScreen";
import EventsScreen from "./src/screens/EventsScreen";
import ScriptsScreen from "./src/screens/ScriptsScreen";
import { API_BASE } from "./src/config";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  // Auth
  const [email, setEmail] = useState("georg@example.com");
  const [displayName, setDisplayName] = useState("Georg");
  const [token, setToken] = useState("");
  const [authStatus, setAuthStatus] = useState("");

  // Create event
  const [newTitle, setNewTitle] = useState("Global Peace Circle");
  const [newIntention, setNewIntention] = useState(
    "May people everywhere experience peace, clarity and compassion."
  );
  const [newDescription, setNewDescription] = useState(
    "A short guided group intention for collective wellbeing."
  );
  const [newStartLocal, setNewStartLocal] = useState("");
  const [newEndLocal, setNewEndLocal] = useState("");
  const [newTimezone, setNewTimezone] = useState("Europe/London");
  const [createEventStatus, setCreateEventStatus] = useState("");

  // Events / presence
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventsError, setEventsError] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [presenceStatus, setPresenceStatus] = useState("");
  const [presenceError, setPresenceError] = useState("");

  // Script generation
  const [scriptIntention, setScriptIntention] = useState(
    "May communities experience peace, healing, and unity."
  );
  const [scriptDuration, setScriptDuration] = useState("10");
  const [scriptTone, setScriptTone] = useState<Tone>("calm");
  const [generatedScript, setGeneratedScript] = useState<GeneratedScript | null>(null);
  const [generatedScriptId, setGeneratedScriptId] = useState("");
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState("");

  // Script list / attach
  const [scripts, setScripts] = useState<ScriptListItem[]>([]);
  const [scriptsError, setScriptsError] = useState("");
  const [selectedScriptId, setSelectedScriptId] = useState("");
  const [attachStatus, setAttachStatus] = useState("");

  // Load token on app start
  useEffect(() => {
    (async () => {
      try {
        const saved = (await AsyncStorage.getItem(TOKEN_KEY)) || "";
        if (saved) setToken(saved);
      } catch {
        // ignore storage errors
      }
    })();
  }, []);

  // Persist token
  useEffect(() => {
    (async () => {
      try {
        if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
        else await AsyncStorage.removeItem(TOKEN_KEY);
      } catch {
        // ignore storage errors
      }
    })();
  }, [token]);

  async function loadEvents(): Promise<void> {
    try {
      setEventsError("");

      const res = await apiFetch("/api/events", { cache: "no-store" });
      const data = (await parseJsonSafe(res)) as { events?: EventItem[]; error?: string };

      if (!res.ok) throw new Error(data.error || "Failed to load events");

      const list = Array.isArray(data.events) ? data.events : [];
      setEvents(list);

      if (!selectedEventId && list.length > 0) {
        setSelectedEventId(list[0].id);
      } else if (selectedEventId && !list.some((e) => e.id === selectedEventId)) {
        setSelectedEventId(list[0]?.id || "");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load events";
      setEventsError(msg);
    }
  }

  async function loadScripts(): Promise<void> {
    if (!token) {
      setScripts([]);
      setScriptsError("");
      return;
    }

    try {
      setScriptsError("");

      const res = await apiFetch("/api/scripts", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = (await parseJsonSafe(res)) as { scripts?: ScriptListItem[]; error?: string };

      if (!res.ok) throw new Error(data.error || "Failed to load scripts");

      const list = Array.isArray(data.scripts) ? data.scripts : [];
      setScripts(list);

      if (generatedScriptId && list.some((s) => s.id === generatedScriptId)) {
        setSelectedScriptId(generatedScriptId);
      } else if (!selectedScriptId && list.length > 0) {
        setSelectedScriptId(list[0].id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load scripts";
      setScriptsError(msg);
    }
  }

  // Initial events load
  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload scripts when token changes
  useEffect(() => {
    loadScripts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Heartbeat while joined
  useEffect(() => {
    if (!isJoined) return;

    void sendHeartbeat();

    const id = setInterval(() => {
      void sendHeartbeat();
      void loadEvents();
    }, 10_000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJoined, selectedEventId, token]);

  async function handleSignup(): Promise<void> {
    setAuthStatus("");

    try {
      const res = await apiFetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName })
      });

      const data = (await parseJsonSafe(res)) as { token?: string; error?: string };

      if (!res.ok) throw new Error(data.error || "Signup failed");

      setToken(data.token || "");
      setAuthStatus("✅ Signed in.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Signup failed";
      setAuthStatus(`❌ ${msg}`);
    }
  }

  function handleLogout(): void {
    setToken("");
    setScripts([]);
    setSelectedScriptId("");
    setAttachStatus("");
    setGeneratedScript(null);
    setGeneratedScriptId("");
    setIsJoined(false);
    setPresenceStatus("");
    setPresenceError("");
    setAuthStatus("Logged out.");
  }

  async function handleCreateEvent(): Promise<void> {
    setCreateEventStatus("");

    try {
      if (!token) throw new Error("Please sign up first.");
      if (!newStartLocal || !newEndLocal) {
        throw new Error("Please provide start and end date/time.");
      }

      const startIso = new Date(newStartLocal).toISOString();
      const endIso = new Date(newEndLocal).toISOString();

      if (new Date(endIso) <= new Date(startIso)) {
        throw new Error("End time must be after start time.");
      }

      const res = await apiFetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription || undefined,
          intentionStatement: newIntention,
          startTimeUtc: startIso,
          endTimeUtc: endIso,
          timezone: newTimezone,
          visibility: "PUBLIC",
          guidanceMode: "AI"
        })
      });

      const data = (await parseJsonSafe(res)) as { event?: EventItem; error?: string };

      if (!res.ok) throw new Error(data.error || "Failed to create event.");

      setCreateEventStatus("✅ Event created.");
      await loadEvents();

      if (data.event?.id) setSelectedEventId(data.event.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create event.";
      setCreateEventStatus(`❌ ${msg}`);
    }
  }

  async function handleJoinLive(): Promise<void> {
    try {
      setPresenceError("");
      setPresenceStatus("");

      if (!token) throw new Error("Please sign up first.");
      if (!selectedEventId) throw new Error("Please select an event.");

      const res = await apiFetch(`/api/events/${selectedEventId}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({})
      });

      const data = (await parseJsonSafe(res)) as { activeNow?: number; error?: string };

      if (!res.ok) throw new Error(data.error || "Failed to join.");

      setIsJoined(true);
      setPresenceStatus(`✅ Joined live session. Active now: ${data.activeNow ?? 0}`);
      await loadEvents();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to join.";
      setPresenceError(msg);
    }
  }

  async function handleLeaveLive(): Promise<void> {
    try {
      setPresenceError("");
      setPresenceStatus("");

      if (!token) throw new Error("Please sign up first.");
      if (!selectedEventId) throw new Error("Please select an event.");

      const res = await apiFetch(`/api/events/${selectedEventId}/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({})
      });

      const data = (await parseJsonSafe(res)) as { activeNow?: number; error?: string };

      if (!res.ok) throw new Error(data.error || "Failed to leave.");

      setIsJoined(false);
      setPresenceStatus(`✅ Left live session. Active now: ${data.activeNow ?? 0}`);
      await loadEvents();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to leave.";
      setPresenceError(msg);
    }
  }

  async function sendHeartbeat(): Promise<void> {
    if (!token || !selectedEventId || !isJoined) return;

    try {
      await apiFetch(`/api/events/${selectedEventId}/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({})
      });
    } catch {
      // intentionally silent
    }
  }

  async function handleGenerateScript(): Promise<void> {
    setScriptError("");
    setScriptLoading(true);
    setAttachStatus("");

    try {
      if (!token) throw new Error("Please sign up first to get a token.");

      const duration = Number(scriptDuration);
      if (!Number.isFinite(duration) || duration < 3 || duration > 60) {
        throw new Error("Duration must be between 3 and 60.");
      }

      const res = await apiFetch("/api/scripts/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          intention: scriptIntention,
          durationMinutes: duration,
          tone: scriptTone
        })
      });

      const data = (await parseJsonSafe(res)) as {
        script?: GeneratedScript;
        scriptId?: string;
        error?: string;
      };

      if (!res.ok) throw new Error(data.error || "Failed to generate script.");

      setGeneratedScript(data.script || null);
      setGeneratedScriptId(data.scriptId || "");
      if (data.scriptId) setSelectedScriptId(data.scriptId);

      await loadScripts();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to generate script.";
      setScriptError(msg);
    } finally {
      setScriptLoading(false);
    }
  }

  async function handleAttachScript(): Promise<void> {
    setAttachStatus("");

    try {
      if (!token) throw new Error("Please sign up first.");
      if (!selectedEventId) throw new Error("Please select an event.");
      if (!selectedScriptId) throw new Error("Please select a script.");

      const res = await apiFetch(`/api/events/${selectedEventId}/attach-script`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ scriptId: selectedScriptId })
      });

      const data = (await parseJsonSafe(res)) as { error?: string };

      if (!res.ok) throw new Error(data.error || "Failed to attach script.");

      setAttachStatus("✅ Script attached to event.");
      await loadEvents();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to attach script.";
      setAttachStatus(`❌ ${msg}`);
    }
  }

  const contextValue: AppStateShape = useMemo(
    () => ({
      // auth
      email,
      setEmail,
      displayName,
      setDisplayName,
      token,
      setToken,
      authStatus,
      setAuthStatus,

      // create event
      newTitle,
      setNewTitle,
      newIntention,
      setNewIntention,
      newDescription,
      setNewDescription,
      newStartLocal,
      setNewStartLocal,
      newEndLocal,
      setNewEndLocal,
      newTimezone,
      setNewTimezone,
      createEventStatus,
      setCreateEventStatus,

      // events / presence
      events,
      setEvents,
      eventsError,
      setEventsError,
      selectedEventId,
      setSelectedEventId,
      isJoined,
      setIsJoined,
      presenceStatus,
      setPresenceStatus,
      presenceError,
      setPresenceError,

      // script generation
      scriptIntention,
      setScriptIntention,
      scriptDuration,
      setScriptDuration,
      scriptTone,
      setScriptTone,
      generatedScript,
      setGeneratedScript,
      generatedScriptId,
      setGeneratedScriptId,
      scriptLoading,
      setScriptLoading,
      scriptError,
      setScriptError,

      // script list / attach
      scripts,
      setScripts,
      scriptsError,
      setScriptsError,
      selectedScriptId,
      setSelectedScriptId,
      attachStatus,
      setAttachStatus,

      // actions
      loadEvents,
      loadScripts,
      handleSignup,
      handleLogout,
      handleCreateEvent,
      handleJoinLive,
      handleLeaveLive,
      sendHeartbeat,
      handleGenerateScript,
      handleAttachScript
    }),
    [
      email,
      displayName,
      token,
      authStatus,
      newTitle,
      newIntention,
      newDescription,
      newStartLocal,
      newEndLocal,
      newTimezone,
      createEventStatus,
      events,
      eventsError,
      selectedEventId,
      isJoined,
      presenceStatus,
      presenceError,
      scriptIntention,
      scriptDuration,
      scriptTone,
      generatedScript,
      generatedScriptId,
      scriptLoading,
      scriptError,
      scripts,
      scriptsError,
      selectedScriptId,
      attachStatus
    ]
  );

  return (
    <SafeAreaProvider>
      <AppStateContext.Provider value={contextValue}>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen
              name="Auth"
              component={AuthScreen}
              options={{
                headerRight: () => <Text style={styles.smallApi}>API: {API_BASE}</Text>
              }}
            />
            <Stack.Screen name="Events" component={EventsScreen} />
            <Stack.Screen name="Scripts" component={ScriptsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </AppStateContext.Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  smallApi: { fontSize: 10, color: "#444", maxWidth: 180 }
});
