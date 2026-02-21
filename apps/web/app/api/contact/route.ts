import { NextResponse } from "next/server";
import { siteConfig } from "../../site-config";

type ContactPayload = {
  name: string;
  email: string;
  topic: string;
  message: string;
  website?: string;
};

type RateState = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 6;
const RATE_LIMIT_BUCKETS = new Map<string, RateState>();
const VALID_TOPIC_REGEX = /^[\w .,&-]{2,80}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const candidate = forwardedFor.split(",")[0]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return "unknown";
}

function pruneRateLimitBuckets(now: number): void {
  for (const [key, value] of RATE_LIMIT_BUCKETS) {
    if (value.resetAt <= now) {
      RATE_LIMIT_BUCKETS.delete(key);
    }
  }
}

function enforceRateLimit(ip: string): boolean {
  const now = Date.now();
  pruneRateLimitBuckets(now);

  const existing = RATE_LIMIT_BUCKETS.get(ip);

  if (!existing || existing.resetAt <= now) {
    RATE_LIMIT_BUCKETS.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS
    });
    return true;
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  existing.count += 1;
  return true;
}

function validate(payload: ContactPayload): string | null {
  if (payload.website) {
    return "spam";
  }

  if (payload.name.length < 2 || payload.name.length > 80) {
    return "Please provide your name.";
  }

  if (!EMAIL_REGEX.test(payload.email) || payload.email.length > 120) {
    return "Please provide a valid email address.";
  }

  if (!VALID_TOPIC_REGEX.test(payload.topic)) {
    return "Please choose a support topic.";
  }

  if (payload.message.length < 10 || payload.message.length > 2000) {
    return "Please include a message between 10 and 2000 characters.";
  }

  return null;
}

async function sendWithResend(payload: ContactPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.CONTACT_TO_EMAIL ?? siteConfig.supportEmail;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? "Egregor Support <onboarding@resend.dev>";

  if (!apiKey) {
    throw new Error(
      "Support form is not configured yet. Please contact support by email."
    );
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      reply_to: payload.email,
      subject: `[Egregor Support] ${payload.topic} | ${payload.name}`,
      text: `New website contact request

Name: ${payload.name}
Email: ${payload.email}
Topic: ${payload.topic}

Message:
${payload.message}
`
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Email delivery failed (${response.status}): ${details}`);
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);

  if (!enforceRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  let body: ContactPayload;

  try {
    body = (await request.json()) as ContactPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload: ContactPayload = {
    name: (body.name ?? "").trim(),
    email: (body.email ?? "").trim().toLowerCase(),
    topic: (body.topic ?? "").trim(),
    message: (body.message ?? "").trim(),
    website: (body.website ?? "").trim()
  };

  const validationError = validate(payload);

  if (validationError === "spam") {
    return NextResponse.json({ success: true });
  }

  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    await sendWithResend(payload);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Contact form delivery failed", error);
    return NextResponse.json(
      {
        error: `Unable to send message right now. Please email ${siteConfig.supportEmail}.`
      },
      { status: 503 }
    );
  }
}
