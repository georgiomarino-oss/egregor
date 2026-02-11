"use client";

import { useEffect, useState } from "react";

type EventItem = {
  id: string;
  title: string;
  intentionStatement: string;
  startTimeUtc: string;
  endTimeUtc: string;
  timezone: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export default function HomePage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState("");

  async function loadEvents() {
    try {
      setError("");
      const res = await fetch(`${API_BASE}/api/events`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load events");
      setEvents(data.events || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load events");
    }
  }

  useEffect(() => {
    loadEvents();
  }, []);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: 24,
        fontFamily: "Arial, sans-serif"
      }}
    >
      <h1>Egregor</h1>
      <p>Collective intention for positive change.</p>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Events</h2>
        <button onClick={loadEvents}>Refresh</button>
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
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
      </div>
    </main>
  );
}
