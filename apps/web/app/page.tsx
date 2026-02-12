"use client";

import { FormEvent, useEffect, useState } from "react";

type EventItem = {
  id: string;
  title: string;
  description?: string | null;
  intentionStatement: string;
  startTimeUtc: string;
  endTimeUtc: string;
  timezone: string;
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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export default function HomePage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventsError, setEventsError] = useState("");

  const [email, setEmail] = useState("georg@example.com");
  const [displayName, setDisplayName] = useState("Georg");
  const [token, setToken] = useState("");

  const [scriptIntention, setScriptIntention] = useState(
    "May communities experience peace, healing, and unity."
  );
  const [scriptDuration, setScriptDuration] = useState(10);
  const [scriptTone, setScriptTone] = useState<"calm" | "uplifting" | "focused">("calm");
  const [generatedScript, setGeneratedScript] = useState<GeneratedScript | null>(null);
  const [scriptError, setScriptError] = useState("");
  const [scriptLoading, setScriptLoading] = useState(false);

  async function loadEvents() {
    try {
      setEventsError("");
      const res = await fetch(`${API_BASE}/api/events`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load events");
      setEvents(data.events || []);
    } catch (e: any) {
      setEventsError(e?.message || "Failed to load events");
    }
  }

  useEffect(() => {
    loadEvents();
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
    } catch (err: any) {
      setScriptError(err?.message || "Signup failed");
    }
  }

  async function handleGenerateScript(e: FormEvent) {
  e.preventDefault();
  setScriptError("");
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

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("Rate limit reached. Please wait 30–60 seconds and try again.");
      }
      throw new Error(data?.error || "Failed to generate script.");
    }

    setGeneratedScript(data.script);
  } catch (err: any) {
    setScriptError(err?.message || "Failed to generate script.");
  } finally {
    setScriptLoading(false);
  }
}


  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>Egregor</h1>
      <p>Collective intention for positive change.</p>

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>1) Sign up / Get token</h2>
        <form onSubmit={handleSignup} style={{ display: "grid", gap: 8 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" />
          <button type="submit" style={{ width: 180 }}>
            Sign up
          </button>
        </form>
        <p style={{ wordBreak: "break-all" }}>
          <strong>Token:</strong> {token || "(none yet)"}
        </p>
      </section>

<section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
  <h2 style={{ marginTop: 0 }}>2) Events</h2>
  <button onClick={loadEvents}>Refresh events</button>
  {eventsError ? <p style={{ color: "crimson" }}>{eventsError}</p> : null}
  <ul>
    {events.map((ev) => (
      <li key={ev.id} style={{ marginBottom: 10 }}>
        <strong>{ev.title}</strong>
        <div>{ev.intentionStatement}</div>
        <small>
          {new Date(ev.startTimeUtc).toLocaleString()} → {new Date(ev.endTimeUtc).toLocaleString()} ({ev.timezone})
        </small>
      </li>
    ))}
  </ul>
</section>

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>3) AI Guided Script Generator</h2>

        <form onSubmit={handleGenerateScript} style={{ display: "grid", gap: 8 }}>
          <textarea
            rows={3}
            value={scriptIntention}
            onChange={(e) => setScriptIntention(e.target.value)}
            placeholder="Enter collective intention"
          />
          <input
            type="number"
            min={3}
            max={60}
            value={scriptDuration}
            onChange={(e) => setScriptDuration(Number(e.target.value))}
            placeholder="Duration in minutes"
          />
          <select
            value={scriptTone}
            onChange={(e) => setScriptTone(e.target.value as "calm" | "uplifting" | "focused")}
          >
            <option value="calm">calm</option>
            <option value="uplifting">uplifting</option>
            <option value="focused">focused</option>
          </select>
          <button type="submit" style={{ width: 200 }} disabled={scriptLoading}>
            {scriptLoading ? "Generating..." : "Generate AI Script"}
          </button>
        </form>

        {scriptError ? <p style={{ color: "crimson" }}>{scriptError}</p> : null}

        {generatedScript ? (
          <div style={{ marginTop: 12, background: "#fafafa", padding: 10, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>{generatedScript.title}</h3>
            <p>
              <strong>Duration:</strong> {generatedScript.durationMinutes} min |{" "}
              <strong>Tone:</strong> {generatedScript.tone}
            </p>

            {Array.isArray(generatedScript.sections) &&
              generatedScript.sections.map((s, idx) => (
                <div key={idx} style={{ marginBottom: 10 }}>
                  <strong>{s.name}</strong> ({s.minutes} min)
                  <div>{s.text}</div>
                </div>
              ))}

            {generatedScript.speakerNotes ? (
              <p>
                <strong>Speaker notes:</strong> {generatedScript.speakerNotes}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

    </main>
  );
}
