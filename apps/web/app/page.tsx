"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type EventItem = {
  id: string;
  hostUserId: string;
  themeId?: string | null;
  title: string;
  description?: string | null;
  intentionStatement: string;
  visibility: string;
  guidanceMode: string;
  scriptId?: string | null;
  startTimeUtc: string;
  endTimeUtc: string;
  timezone: string;
  status: string;
  activeCountSnapshot?: number;
  totalJoinCount?: number;
  activeNow?: number;
};

type ScriptSection = {
  name: string;
  minutes: number;
  text: string;
};

type GeneratedScript = {
  title: string;
  durationMinutes: number;
  tone: "calm" | "uplifting" | "focused";
  sections: ScriptSection[];
  speakerNotes?: string;
};

type ScriptListItem = {
  id: string;
  title: string;
  intention: string;
  durationMinutes: number;
  tone: string;
  createdAt: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
const TOKEN_KEY = "egregor_token";

export default function HomePage() {
  // Auth / identity
  const [email, setEmail] = useState("georg@example.com");
  const [displayName, setDisplayName] = useState("Georg");
  const [token, setToken] = useState("");

  // Create event form
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

  // Presence
  const [presenceStatus, setPresenceStatus] = useState("");
  const [presenceError, setPresenceError] = useState("");
  const [isJoined, setIsJoined] = useState(false);

  // Events
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventsError, setEventsError] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");

  // Scripts generate
  const [scriptIntention, setScriptIntention] = useState(
    "May communities experience peace, healing, and unity."
  );
  const [scriptDuration, setScriptDuration] = useState(10);
  const [scriptTone, setScriptTone] = useState<
    "calm" | "uplifting" | "focused"
  >("calm");
  const [generatedScript, setGeneratedScript] = useState<GeneratedScript | null>(
    null
  );
  const [generatedScriptId, setGeneratedScriptId] = useState("");
  const [scriptError, setScriptError] = useState("");
  const [scriptLoading, setScriptLoading] = useState(false);

  // Scripts list + attach
  const [scripts, setScripts] = useState<ScriptListItem[]>([]);
  const [scriptsError, setScriptsError] = useState("");
  const [selectedScriptId, setSelectedScriptId] = useState("");
  const [attachStatus, setAttachStatus] = useState("");

  // Hydrate token from localStorage once
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOKEN_KEY) || "";
      if (saved) setToken(saved);
    } catch {
      // ignore storage errors
    }
  }, []);

  // Persist token whenever it changes
  useEffect(() => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore storage errors
    }
  }, [token]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId),
    [events, selectedEventId]
  );

  async function loadEvents() {
    try {
      setEventsError("");
      const res = await fetch(`${API_BASE}/api/events`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load events");

      const list: EventItem[] = Array.isArray(data?.events) ? data.events : [];
      setEvents(list);

      // Auto-select first if nothing selected
      if (!selectedEventId && list.length > 0) {
        setSelectedEventId(list[0].id);
      }
    } catch (e: any) {
      setEventsError(e?.message || "Failed to load events");
    }
  }

  async function loadScripts() {
    if (!token) {
      setScripts([]);
      setScriptsError("");
      return;
    }

    try {
      setScriptsError("");
      const res = await fetch(`${API_BASE}/api/scripts`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load scripts");

      const list: ScriptListItem[] = Array.isArray(data?.scripts)
        ? data.scripts
        : [];
      setScripts(list);

      // Prefer latest generated in-session, else first script
      if (generatedScriptId && list.some((s) => s.id === generatedScriptId)) {
        setSelectedScriptId(generatedScriptId);
      } else if (!selectedScriptId && list.length > 0) {
        setSelectedScriptId(list[0].id);
      }
    } catch (e: any) {
      setScriptsError(e?.message || "Failed to load scripts");
    }
  }

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadScripts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Heartbeat loop while joined
  useEffect(() => {
    if (!isJoined) return;
    if (!selectedEventId) return;
    if (!token) return;

    // immediate ping
    sendHeartbeat();

    const id = setInterval(() => {
      sendHeartbeat();
      loadEvents(); // refresh counters while joined
    }, 10_000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJoined, selectedEventId, token]);

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    setScriptError("");

    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Signup failed");

      setToken(data.token || "");
      alert("Signed in and token saved locally.");
    } catch (err: any) {
      setScriptError(err?.message || "Signup failed");
    }
  }

  function handleLogout() {
    setToken("");
    setScripts([]);
    setSelectedScriptId("");
    setAttachStatus("");
    setGeneratedScript(null);
    setGeneratedScriptId("");
    setIsJoined(false);
    setPresenceStatus("");
    setPresenceError("");
  }

  async function handleCreateEvent(e: FormEvent) {
    e.preventDefault();
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

      const res = await fetch(`${API_BASE}/api/events`, {
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

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create event.");

      setCreateEventStatus("✅ Event created.");
      await loadEvents();

      // Auto-select newly created event if returned
      if (data?.event?.id) {
        setSelectedEventId(data.event.id);
      }
    } catch (err: any) {
      setCreateEventStatus(`❌ ${err?.message || "Failed to create event."}`);
    }
  }

  async function handleGenerateScript(e: FormEvent) {
    e.preventDefault();
    setScriptError("");
    setScriptLoading(true);
    setAttachStatus("");

    try {
      if (!token) throw new Error("Please sign up first to get a token.");

      const res = await fetch(`${API_BASE}/api/scripts/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          intention: scriptIntention,
          durationMinutes: Number(scriptDuration),
          tone: scriptTone
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate script.");

      setGeneratedScript(data.script || null);
      setGeneratedScriptId(data.scriptId || "");
      if (data.scriptId) setSelectedScriptId(data.scriptId);

      await loadScripts();
    } catch (err: any) {
      setScriptError(err?.message || "Failed to generate script.");
    } finally {
      setScriptLoading(false);
    }
  }

  async function handleAttachScript() {
    setAttachStatus("");

    try {
      if (!token) throw new Error("Please sign up first.");
      if (!selectedEventId) throw new Error("Please select an event.");
      if (!selectedScriptId) throw new Error("Please select a script.");

      const res = await fetch(
        `${API_BASE}/api/events/${selectedEventId}/attach-script`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ scriptId: selectedScriptId })
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to attach script.");

      setAttachStatus("✅ Script attached to event.");
      await loadEvents();
    } catch (e: any) {
      setAttachStatus(`❌ ${e?.message || "Failed to attach script."}`);
    }
  }

  // Presence handlers
  async function handleJoinLive() {
    try {
      setPresenceError("");
      setPresenceStatus("");

      if (!token) throw new Error("Please sign up first.");
      if (!selectedEventId) throw new Error("Please select an event.");

      // NOTE: no Content-Type header because body is empty
      const res = await fetch(`${API_BASE}/api/events/${selectedEventId}/join`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to join.");

      setIsJoined(true);
      setPresenceStatus(`✅ Joined live session. Active now: ${data?.activeNow ?? 0}`);
      await loadEvents();
    } catch (e: any) {
      setPresenceError(e?.message || "Failed to join.");
    }
  }

  async function handleLeaveLive() {
    try {
      setPresenceError("");
      setPresenceStatus("");

      if (!token) throw new Error("Please sign up first.");
      if (!selectedEventId) throw new Error("Please select an event.");

      // NOTE: no Content-Type header because body is empty
      const res = await fetch(`${API_BASE}/api/events/${selectedEventId}/leave`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to leave.");

      setIsJoined(false);
      setPresenceStatus(`✅ Left live session. Active now: ${data?.activeNow ?? 0}`);
      await loadEvents();
    } catch (e: any) {
      setPresenceError(e?.message || "Failed to leave.");
    }
  }

  async function sendHeartbeat() {
    if (!token || !selectedEventId || !isJoined) return;

    try {
      // NOTE: no Content-Type header because body is empty
      await fetch(`${API_BASE}/api/events/${selectedEventId}/heartbeat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    } catch {
      // silent by design
    }
  }

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: 24,
        fontFamily: "Arial, sans-serif"
      }}
    >
      <h1>Egregor</h1>
      <p>Collective intention for positive change.</p>

      {/* 1) Auth */}
      <section
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8
        }}
      >
        <h2 style={{ marginTop: 0 }}>1) Sign up / Get token</h2>
        <form onSubmit={handleSignup} style={{ display: "grid", gap: 8 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
          />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" style={{ width: 180 }}>
              Sign up
            </button>
            <button
              type="button"
              onClick={handleLogout}
              style={{ width: 180 }}
              disabled={!token}
            >
              Log out
            </button>
          </div>
        </form>
        <p style={{ wordBreak: "break-all" }}>
          <strong>Token:</strong> {token || "(none yet)"}
        </p>
      </section>

      {/* 2) Create Event */}
      <section
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8
        }}
      >
        <h2 style={{ marginTop: 0 }}>2) Create Event</h2>

        <form
          onSubmit={handleCreateEvent}
          style={{ display: "grid", gap: 8, maxWidth: 760 }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Event title"
          />

          <textarea
            value={newIntention}
            onChange={(e) => setNewIntention(e.target.value)}
            rows={3}
            placeholder="Intention statement"
          />

          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={2}
            placeholder="Description (optional)"
          />

          <label>
            Start (local):
            <input
              type="datetime-local"
              value={newStartLocal}
              onChange={(e) => setNewStartLocal(e.target.value)}
              style={{ marginLeft: 8 }}
            />
          </label>

          <label>
            End (local):
            <input
              type="datetime-local"
              value={newEndLocal}
              onChange={(e) => setNewEndLocal(e.target.value)}
              style={{ marginLeft: 8 }}
            />
          </label>

          <input
            value={newTimezone}
            onChange={(e) => setNewTimezone(e.target.value)}
            placeholder="Timezone (e.g. Europe/London)"
          />

          <button type="submit" style={{ width: 180 }}>
            Create event
          </button>
        </form>

        {createEventStatus ? <p>{createEventStatus}</p> : null}
      </section>

      {/* 3) Events */}
      <section
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8
        }}
      >
        <h2 style={{ marginTop: 0 }}>3) Events</h2>
        <button onClick={loadEvents}>Refresh events</button>
        {eventsError ? <p style={{ color: "crimson" }}>{eventsError}</p> : null}

        <ul>
          {events.map((ev) => (
            <li key={ev.id} style={{ marginBottom: 10 }}>
              <strong>{ev.title}</strong>
              <div>{ev.intentionStatement}</div>
              <small>
                <div>Active now: {ev.activeNow ?? 0}</div>
                <div>Total joined: {ev.totalJoinCount ?? 0}</div>
                <div>
                  {new Date(ev.startTimeUtc).toLocaleString()} →{" "}
                  {new Date(ev.endTimeUtc).toLocaleString()} ({ev.timezone})
                </div>
              </small>
              <div>
                <small>Attached script: {ev.scriptId || "(none)"}</small>
              </div>
            </li>
          ))}
        </ul>

        <div style={{ marginTop: 12 }}>
          <label>
            Selected event:
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={{ marginLeft: 8, minWidth: 360 }}
            >
              <option value="">-- choose event --</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} ({new Date(ev.startTimeUtc).toLocaleString()})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            onClick={handleJoinLive}
            disabled={!token || !selectedEventId || isJoined}
          >
            Join live
          </button>
          <button
            onClick={handleLeaveLive}
            disabled={!token || !selectedEventId || !isJoined}
          >
            Leave live
          </button>
        </div>

        {presenceStatus ? <p>{presenceStatus}</p> : null}
        {presenceError ? <p style={{ color: "crimson" }}>{presenceError}</p> : null}

        {selectedEvent ? (
          <p style={{ marginTop: 8 }}>
            <small>
              Selected: <strong>{selectedEvent.title}</strong> | current script:{" "}
              {selectedEvent.scriptId || "(none)"}
            </small>
          </p>
        ) : null}
      </section>

      {/* 4) AI Script Generator */}
      <section
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8
        }}
      >
        <h2 style={{ marginTop: 0 }}>4) AI Guided Script Generator</h2>
        <form onSubmit={handleGenerateScript} style={{ display: "grid", gap: 8 }}>
          <textarea
            value={scriptIntention}
            onChange={(e) => setScriptIntention(e.target.value)}
            rows={4}
            placeholder="Intention"
          />
          <input
            type="number"
            min={3}
            max={60}
            value={scriptDuration}
            onChange={(e) => setScriptDuration(Number(e.target.value))}
          />
          <select
            value={scriptTone}
            onChange={(e) =>
              setScriptTone(e.target.value as "calm" | "uplifting" | "focused")
            }
          >
            <option value="calm">calm</option>
            <option value="uplifting">uplifting</option>
            <option value="focused">focused</option>
          </select>
          <button type="submit" style={{ width: 250 }} disabled={scriptLoading}>
            {scriptLoading ? "Generating..." : "Generate AI Script"}
          </button>
        </form>

        {scriptError ? <p style={{ color: "crimson" }}>{scriptError}</p> : null}

        {generatedScript ? (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: "1px solid #eee",
              borderRadius: 8
            }}
          >
            <h3 style={{ marginTop: 0 }}>{generatedScript.title}</h3>
            <p>
              <strong>Duration:</strong> {generatedScript.durationMinutes} min |{" "}
              <strong>Tone:</strong> {generatedScript.tone}
            </p>

            {Array.isArray(generatedScript.sections) &&
              generatedScript.sections.map((s, idx) => (
                <div key={idx} style={{ marginBottom: 10 }}>
                  <strong>
                    {s.name} ({s.minutes} min)
                  </strong>
                  <div>{s.text}</div>
                </div>
              ))}

            {generatedScript.speakerNotes ? (
              <p>
                <strong>Speaker notes:</strong> {generatedScript.speakerNotes}
              </p>
            ) : null}

            {generatedScriptId ? (
              <p>
                <small>
                  Saved script id: <code>{generatedScriptId}</code>
                </small>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 5) Attach Script */}
      <section
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8
        }}
      >
        <h2 style={{ marginTop: 0 }}>5) Attach Script to Event</h2>

        <div style={{ display: "grid", gap: 8, maxWidth: 700 }}>
          <label>
            Choose script:
            <select
              value={selectedScriptId}
              onChange={(e) => setSelectedScriptId(e.target.value)}
              style={{ marginLeft: 8, minWidth: 320 }}
            >
              <option value="">-- choose script --</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} | {s.tone} | {s.durationMinutes}m |{" "}
                  {new Date(s.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={loadScripts} disabled={!token}>
              Refresh scripts
            </button>
            <button
              onClick={handleAttachScript}
              disabled={!token || !selectedEventId || !selectedScriptId}
            >
              Attach selected script
            </button>
          </div>
        </div>

        {scriptsError ? <p style={{ color: "crimson" }}>{scriptsError}</p> : null}
        {attachStatus ? <p>{attachStatus}</p> : null}
      </section>
    </main>
  );
}
