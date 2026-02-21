"use client";

import { FormEvent, useMemo, useState } from "react";
import { trackEvent } from "../analytics";

type ContactFormProps = {
  topics: string[];
};

type FormStatus = "idle" | "sending" | "success" | "error";

const INITIAL_STATUS_MESSAGE = {
  status: "idle" as FormStatus,
  message: ""
};

export default function ContactForm({ topics }: ContactFormProps) {
  const [status, setStatus] = useState(INITIAL_STATUS_MESSAGE);
  const [selectedTopic, setSelectedTopic] = useState(topics[0] ?? "Other");

  const buttonLabel = useMemo(() => {
    if (status.status === "sending") {
      return "Sending...";
    }
    if (status.status === "success") {
      return "Sent";
    }
    return "Send Message";
  }, [status.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ status: "sending", message: "" });

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      topic: String(formData.get("topic") ?? "").trim(),
      message: String(formData.get("message") ?? "").trim(),
      website: String(formData.get("website") ?? "").trim()
    };

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as {
        error?: string;
        success?: boolean;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to send message right now. Please email support directly."
        );
      }

      trackEvent("support_contact_submitted", {
        topic: payload.topic || "unknown"
      });
      form.reset();
      setSelectedTopic(topics[0] ?? "Other");
      setStatus({
        status: "success",
        message: "Message sent. Our team will respond shortly."
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to send message right now.";

      setStatus({ status: "error", message });
    }
  }

  return (
    <form onSubmit={onSubmit} className="contact-form" noValidate>
      <div className="form-grid">
        <label className="form-field">
          <span>Name</span>
          <input
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
            placeholder="Your name"
          />
        </label>

        <label className="form-field">
          <span>Email</span>
          <input
            name="email"
            type="email"
            required
            maxLength={120}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>
      </div>

      <label className="form-field">
        <span>Topic</span>
        <select
          name="topic"
          value={selectedTopic}
          onChange={(event) => setSelectedTopic(event.target.value)}
        >
          {topics.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </select>
      </label>

      <label className="form-field">
        <span>Message</span>
        <textarea
          name="message"
          required
          minLength={10}
          maxLength={2000}
          rows={6}
          placeholder="Tell us how we can help."
        />
      </label>

      <div className="honeypot-wrapper" aria-hidden>
        <label className="form-field">
          <span>Website</span>
          <input
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>

      <div className="form-actions">
        <button
          type="submit"
          className="btn-primary"
          disabled={status.status === "sending"}
        >
          {buttonLabel}
        </button>
        {status.message ? (
          <p
            className={`form-status ${status.status === "error" ? "error" : "success"}`}
          >
            {status.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
