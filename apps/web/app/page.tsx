"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type EventItem = {
  id: string;
  title: string;
  description?: string | null;
  intentionStatement: string;
  startTimeUtc: string;
  endTimeUtc: string;
  timezone: string;
  scriptId?: string | null;
  activeNow?: number; // add this
  totalJoinCount?: number;

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

type SavedScriptItem = {
  id: string;
  title: string;
  intention: string;
  durationMinutes: number;
  tone: string;
  createdAt: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export default function HomePage() {
  // ---------- Events ----------
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventsError, setEventsError] = useState("");

  // ---------- Auth ----------
  const [email, setEmail] = useState("georg@example.com");
  const [displayName, setDisplayName] = useState("Georg");
  const [token, setToken] = useState("");

  // ---------- Create Event ----------
  const [eventTitle, setEventTitle] = useState("Global Peace Circle");
  const [eventIntention, setEventIntention] = useState(
    "May people everywhere experience peace, clarity and compassion."
  );
  const [eventDescription, setEventDescription] = useState(
    "A short shared intention session."
  );
  const [eventStartLocal, setEventStartLocal] = useState("2026-02-11T19:00");
  const [eventEndLocal, setEventEndLocal] = useState("2026-02-11T19:20");
  const [eventTimezone, setEventTimezone] = useState("Europe/London");
  const [createEventStatus, setCreateEventStatus] = useState("");

  // ---------- Script generation ----------
  const [scriptIntention, setScriptIntention] = useState(
    "May communities experience peace, healing, and unity."
  );
  const [scriptDuration, setScriptDuration] = useState(10);
  const [scriptTone, setScriptTone] = useState<"calm" | "uplifting" | "focused">(
    "calm"
  );
  const [generatedScript, setGeneratedScript] = useState<GeneratedScript | null>(
    null
  );
  const [generatedScriptId, setGeneratedScriptId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [attachStatus, setAttachStatus] = useState("");
  const [presenceStatus, setPresenceStatus] = useState("");
  const [presenceError, setPresenceError] = useState("");
  const [isJoined, setIsJoined] = useState(false);

  const [scriptError, setScriptError] = useState("");
  const [scriptLoading, setScriptLoading] = useState(false);

  // ---------- Step 7: saved scripts panel ----------
  const [savedScripts, setSavedScripts] = useState<SavedScriptItem[]>([]);
  const [savedScriptsError, setSavedScriptsError] = useState("");
  const [selectedSavedScriptId, setSelectedSavedScriptId] = useState("");

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

const loaded = data.events || [];
setEvents(loaded);

if (!selectedEventId && loaded.length > 0) {
  setSelectedEventId(loaded[0].id);
}

      if (!selectedEventId && list.length > 0) {
        setSelectedEventId(list[0].id);
      }
    } catch (e: any) {
      setEventsError(e?.message || "Failed to load events");
    }
  }

  async function loadSavedScripts(activeToken?: string) {
    const useToken = activeToken || token;
    if (!useToken) {
      setSavedScripts([]);
      setSelectedSavedScriptId("");
      return;
    }

    try {
      setSavedScriptsError("");
      const res = await fetch(`${API_BASE}/api/scripts`, {
        headers: {
          Authorization: `Bearer ${useToken}`
        },
        cache: "no-store"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load scripts");

      const list: SavedScriptItem[] = Array.isArray(data?.scripts) ? data.scripts : [];
      setSavedScripts(list);

      if (!selectedSavedScriptId && list.length > 0) {
        setSelectedSavedScriptId(list[0].id);
      }
    } catch (e: any) {
      setSavedScriptsError(e?.message || "Failed to load scripts");
    }
  }

  <div style={{ display: "grid", gap: 8, marginBottom: 12, maxWidth: 520 }}>
  <label>
    Select event:
    <select
      value={selectedEventId}
      onChange={(e) => setSelectedEventId(e.target.value)}
      style={{ marginLeft: 8 }}
    >
      <option value="">-- choose --</option>
      {events.map((ev) => (
        <option key={ev.id} value={ev.id}>
          {ev.title} ({new Date(ev.startTimeUtc).toLocaleString()})
        </option>
      ))}
    </select>
  </label>

  <div style={{ display: "flex", gap: 8 }}>
    <button onClick={handleJoin} disabled={!token || !selectedEventId}>
      Join
    </button>
    <button onClick={handleLeave} disabled={!token || !selectedEventId || !isJoined}>
      Leave
    </button>
  </div>

  {presenceStatus ? <p>{presenceStatus}</p> : null}
  {presenceError ? <p style={{ color: "crimson" }}>{presenceError}</p> : null}
</div>

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      setToken(data.token);
      alert("Signed in and token received.");

      await loadSavedScripts(data.token);
    } catch (err: any) {
      setScriptError(err?.message || "Signup failed");
    }
  }

  async function handleCreateEvent(e: FormEvent) {
    e.preventDefault();
    setCreateEventStatus("");

    try {
      if (!token) throw new Error("Please sign up first to get a token.");

      const startIso = new Date(eventStartLocal).toISOString();
      const endIso = new Date(eventEndLocal).toISOString();

      const res = await fetch(`${API_BASE}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: eventTitle,
          description: eventDescription,
          intentionStatement: eventIntention,
          startTimeUtc: startIso,
          endTimeUtc: endIso,
          timezone: eventTimezone,
          visibility: "PUBLIC",
          guidanceMode: "AI"
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Create event failed");

      setCreateEventStatus("Event created.");
      await loadEvents();
      if (data?.event?.id) setSelectedEventId(data.event.id);
    } catch (err: any) {
      setCreateEventStatus(err?.message || "Create event failed");
    }
  }

  async function handleGenerateScript(e: FormEvent) {
    e.preventDefault();
    setScriptError("");
    setAttachStatus("");
    setScriptLoading(true);

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

      // refresh "My Scripts" panel and auto-select new script
      await loadSavedScripts(token);
      if (data.scriptId) setSelectedSavedScriptId(data.scriptId);
    } catch (err: any) {
      setScriptError(err?.message || "Failed to generate script.");
    } finally {
      setScriptLoading(false);
    }
  }

  async function handleAttachScriptWithId(scriptId: string) {
    setAttachStatus("");
    try {
      if (!token) throw new Error("Please sign up first.");
      if (!scriptId) throw new Error("Select a script first.");
      if (!selectedEventId) throw new Error("Select an event first.");

      const res = await fetch(
        `${API_BASE}/api/events/${selectedEventId}/attach-script`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ scriptId })
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Attach failed");

      setAttachStatus("✅ Script attached to event.");
      await loadEvents();
    } catch (err: any) {
      setAttachStatus(`❌ ${err?.message || "Attach failed"}`);
    }
  }

  async function handleJoin() {
  try {
    setPresenceError("");
    setPresenceStatus("");

    if (!token) throw new Error("Please sign up first to get a token.");
    if (!selectedEventId) throw new Error("Please select an event.");

    const res = await fetch(`${API_BASE}/api/events/${selectedEventId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Join failed");

    setIsJoined(true);
    setPresenceStatus("Joined event.");
    await loadEvents();
  } catch (e: any) {
    setPresenceError(e?.message || "Join failed");
  }
}

async function handleLeave() {
  try {
    setPresenceError("");
    setPresenceStatus("");

    if (!token) throw new Error("Please sign up first to get a token.");
    if (!selectedEventId) throw new Error("Please select an event.");

    const res = await fetch(`${API_BASE}/api/events/${selectedEventId}/leave`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Leave failed");

    setIsJoined(false);
    setPresenceStatus("Left event.");
    await loadEvents();
  } catch (e: any) {
    setPresenceError(e?.message || "Leave failed");
  }
}

async function sendHeartbeat() {
  if (!token || !selectedEventId || !isJoined) return;

  try {
    await fetch(`${API_BASE}/api/events/${selectedEventId}/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });
  } catch {
    // silent on heartbeat failure; next tick can recover
  }
}
useEffect(() => {
  if (!isJoined) return;

  // send one immediately
  sendHeartbeat();

  const id = setInterval(() => {
    sendHeartbeat();
  }, 10_000); // 10s

  return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isJoined, selectedEventId, token]);


  async function handleAttachGeneratedScript() {
    await handleAttachScriptWithId(generatedScriptId);
  }

  async function handleAttachSelectedSavedScript() {
    await handleAttachScriptWithId(selectedSavedScriptId);
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

      {/* 1) Sign up */}
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>1) Sign up / Get token</h2>
        <form onSubmit={handleSignup} style={{ display: "grid", gap: 8 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />
          <button type="submit" style={{ width: 180 }}>Sign up</button>
        </form>
        <p style={{ wordBreak: "break-all" }}>
          <strong>Token:</strong> {token || "(none yet)"}
        </p>
      </section>

      {/* 2) Create Event */}
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>2) Create Event</h2>
        <form onSubmit={handleCreateEvent} style={{ display: "grid", gap: 8 }}>
          <input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} placeholder="Title" />
          <textarea value={eventIntention} onChange={(e) => setEventIntention(e.target.value)} rows={3} placeholder="Intention statement" />
          <input value={eventDescription} onChange={(e) => setEventDescription(e.target.value)} placeholder="Description" />
          <label>
            Start (local):
            <input type="datetime-local" value={eventStartLocal} onChange={(e) => setEventStartLocal(e.target.value)} style={{ marginLeft: 8 }} />
          </label>
          <label>
            End (local):
            <input type="datetime-local" value={eventEndLocal} onChange={(e) => setEventEndLocal(e.target.value)} style={{ marginLeft: 8 }} />
          </label>
          <input value={eventTimezone} onChange={(e) => setEventTimezone(e.target.value)} placeholder="Timezone (e.g. Europe/London)" />
          <button type="submit" style={{ width: 180 }}>Create event</button>
        </form>
        {createEventStatus ? <p>{createEventStatus}</p> : null}
      </section>

      {/* 3) Events */}
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
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
                {new Date(ev.startTimeUtc).toLocaleString()} → {new Date(ev.endTimeUtc).toLocaleString()} ({ev.timezone})
              </small>
              <div><small>Attached script: {ev.scriptId || "(none)"}</small></div>
              <div>Active now: {ev.activeNow ?? 0}</div>
            </li>
          ))}
        </ul>

        <div style={{ marginTop: 12 }}>
          <label>
            Selected event:
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={{ marginLeft: 8, minWidth: 300 }}
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
      </section>

      {/* 4) AI Script Generator */}
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>4) AI Guided Script Generator</h2>

        <form onSubmit={handleGenerateScript} style={{ display: "grid", gap: 8 }}>
          <textarea value={scriptIntention} onChange={(e) => setScriptIntention(e.target.value)} rows={3} placeholder="Intention" />
          <input type="number" min={3} max={60} value={scriptDuration} onChange={(e) => setScriptDuration(Number(e.target.value))} />
          <select value={scriptTone} onChange={(e) => setScriptTone(e.target.value as "calm" | "uplifting" | "focused")}>
            <option value="calm">calm</option>
            <option value="uplifting">uplifting</option>
            <option value="focused">focused</option>
          </select>
          <button type="submit" disabled={scriptLoading} style={{ width: 220 }}>
            {scriptLoading ? "Generating..." : "Generate AI Script"}
          </button>
        </form>

        {scriptError ? <p style={{ color: "crimson" }}>{scriptError}</p> : null}

        {generatedScript ? (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fafafa" }}>
            <h3 style={{ marginTop: 0 }}>{generatedScript.title}</h3>
            <p><strong>Duration:</strong> {generatedScript.durationMinutes} min · <strong>Tone:</strong> {generatedScript.tone}</p>

            {generatedScript.sections.map((s, idx) => (
              <div key={idx} style={{ marginBottom: 10 }}>
                <strong>{s.name} ({s.minutes} min)</strong>
                <div>{s.text}</div>
              </div>
            ))}

            {generatedScript.speakerNotes ? (
              <p><strong>Speaker notes:</strong> {generatedScript.speakerNotes}</p>
            ) : null}

            <p><strong>Generated scriptId:</strong> {generatedScriptId || "(none)"}</p>

            <button onClick={handleAttachGeneratedScript} type="button" style={{ width: 280 }}>
              Attach generated script to selected event
            </button>
          </div>
        ) : null}
      </section>

      {/* 5) My Scripts Panel (NEW) */}
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>5) My Saved Scripts</h2>

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button onClick={() => loadSavedScripts()} disabled={!token}>
            Refresh my scripts
          </button>
          <button onClick={handleAttachSelectedSavedScript} disabled={!token || !selectedSavedScriptId || !selectedEventId}>
            Attach selected saved script to selected event
          </button>
        </div>

        {savedScriptsError ? <p style={{ color: "crimson" }}>{savedScriptsError}</p> : null}

        <div style={{ marginBottom: 8 }}>
          <label>
            Select saved script:
            <select
              value={selectedSavedScriptId}
              onChange={(e) => setSelectedSavedScriptId(e.target.value)}
              style={{ marginLeft: 8, minWidth: 380 }}
            >
              <option value="">-- choose saved script --</option>
              {savedScripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.tone} · {s.durationMinutes}m · {new Date(s.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        </div>

        {savedScripts.length === 0 ? (
          <p>No saved scripts yet.</p>
        ) : (
          <ul>
            {savedScripts.map((s) => (
              <li key={s.id} style={{ marginBottom: 8 }}>
                <strong>{s.title}</strong> — {s.tone} · {s.durationMinutes}m
                <div><small>{s.intention}</small></div>
                <div><small>{new Date(s.createdAt).toLocaleString()}</small></div>
                <div><small>ID: {s.id}</small></div>
                
              </li>
            ))}
          </ul>
        )}

        {selectedEvent ? (
          <p style={{ marginTop: 8 }}>
            Current selected event: <strong>{selectedEvent.title}</strong>
          </p>
        ) : null}

        {attachStatus ? <p style={{ marginTop: 8 }}>{attachStatus}</p> : null}
      </section>
    </main>
  );
}
