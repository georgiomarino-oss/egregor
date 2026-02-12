import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { env } from "./env.js";
import OpenAI from "openai";

const prisma = new PrismaClient();

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY
});

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL
  }
});

type PresenceEntry = {
  userId: string;
  eventId: string;
  expiresAt: number;
};

const PRESENCE_TTL_MS = (env.PRESENCE_STALE_SECONDS || 30) * 1000;
// key: `${eventId}:${userId}`
const presence = new Map<string, PresenceEntry>();

function presenceKey(eventId: string, userId: string) {
  return `${eventId}:${userId}`;
}

function nowMs() {
  return Date.now();
}

function sweepPresence() {
  const now = nowMs();
  for (const [k, v] of presence.entries()) {
    if (v.expiresAt <= now) presence.delete(k);
  }
}

function upsertPresence(eventId: string, userId: string) {
  const key = presenceKey(eventId, userId);
  presence.set(key, {
    eventId,
    userId,
    expiresAt: nowMs() + PRESENCE_TTL_MS
  });
}

function removePresence(eventId: string, userId: string) {
  presence.delete(presenceKey(eventId, userId));
}

function countActiveForEvent(eventId: string) {
  sweepPresence();
  let count = 0;
  for (const v of presence.values()) {
    if (v.eventId === eventId) count++;
  }
  return count;
}

await app.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true
});

await app.register(jwt, {
  secret: env.JWT_SECRET
});

app.decorate("authenticate", async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
});

// Clean error responses for validation/runtime
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: "Validation failed",
      details: error.issues
    });
  }

  app.log.error(error);
  return reply.code(500).send({
    error: "Internal server error"
  });
});

app.get("/api/health", async () => ({ ok: true, service: "egregor-api" }));

app.post("/api/auth/signup", async (req) => {
  const body = z
    .object({
      email: z.string().email(),
      displayName: z.string().min(2)
    })
    .parse(req.body);

  const user = await prisma.user.upsert({
    where: { email: body.email },
    update: { displayName: body.displayName },
    create: { email: body.email, displayName: body.displayName }
  });

  const token = app.jwt.sign({ sub: user.id, email: user.email });
  return { token, user };
});

app.post(
  "/api/events",
  { preHandler: (app as any).authenticate },
  async (req: any, reply) => {
    const body = z
      .object({
        title: z.string().min(3),
        intentionStatement: z.string().min(3),
        startTimeUtc: z.string(),
        endTimeUtc: z.string(),
        timezone: z.string().default("Europe/London"),
        visibility: z.string().default("PUBLIC"),
        guidanceMode: z.string().default("AI"),
        description: z.string().optional()
      })
      .parse(req.body);

    const hostUserId = String(req.user?.sub || "");
    if (!hostUserId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const start = new Date(body.startTimeUtc);
    const end = new Date(body.endTimeUtc);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return reply.code(400).send({ error: "Invalid start/end datetime." });
    }

    if (end <= start) {
      return reply.code(400).send({ error: "endTimeUtc must be after startTimeUtc." });
    }

    const event = await prisma.event.create({
      data: {
        hostUserId,
        title: body.title,
        description: body.description,
        intentionStatement: body.intentionStatement,
        startTimeUtc: start,
        endTimeUtc: end,
        timezone: body.timezone,
        visibility: body.visibility,
        guidanceMode: body.guidanceMode,
        status: "SCHEDULED"
      }
    });

    return { event };
  }
);

app.get("/api/events", async () => {
  const now = new Date();

  const events = await prisma.event.findMany({
    orderBy: { startTimeUtc: "asc" },
    take: 50
  });

  const enriched = events.map((ev) => {
    const isActive = ev.startTimeUtc <= now && ev.endTimeUtc >= now;
    return {
      ...ev,
      activeNow: isActive ? ev.activeCountSnapshot : 0
    };
  });

  return { events: enriched };
});

app.post(
  "/api/events/:id/join",
  { preHandler: (app as any).authenticate },
  async (req: any, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const userId = String(req.user?.sub || "");
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const event = await prisma.event.findUnique({ where: { id: params.id } });
    if (!event) return reply.code(404).send({ error: "Event not found." });

    upsertPresence(params.id, userId);

    return {
      ok: true,
      eventId: params.id,
      activeNow: countActiveForEvent(params.id),
      ttlSeconds: Math.floor(PRESENCE_TTL_MS / 1000)
    };
  }
);

app.post(
  "/api/events/:id/heartbeat",
  { preHandler: (app as any).authenticate },
  async (req: any, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const userId = String(req.user?.sub || "");
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    const event = await prisma.event.findUnique({ where: { id: params.id } });
    if (!event) return reply.code(404).send({ error: "Event not found." });

    upsertPresence(params.id, userId);

    return {
      ok: true,
      eventId: params.id,
      activeNow: countActiveForEvent(params.id)
    };
  }
);

app.post(
  "/api/events/:id/leave",
  { preHandler: (app as any).authenticate },
  async (req: any, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const userId = String(req.user?.sub || "");
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });

    removePresence(params.id, userId);

    return {
      ok: true,
      eventId: params.id,
      activeNow: countActiveForEvent(params.id)
    };
  }
);

app.post(
  "/api/scripts/generate",
  { preHandler: (app as any).authenticate },
  async (req: any, reply) => {
    const body = z
      .object({
        intention: z.string().min(3),
        durationMinutes: z.number().int().min(3).max(60).default(10),
        tone: z.enum(["calm", "uplifting", "focused"]).default("calm")
      })
      .parse(req.body);

    const authorUserId = String(req.user?.sub || "");
    if (!authorUserId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    if (!env.OPENAI_API_KEY) {
      return reply.code(400).send({
        error: "OPENAI_API_KEY is not configured on the server."
      });
    }

    const prompt = `
You are writing a guided collective intention script for a spiritual wellness app called Egregor.
Create a ${body.durationMinutes}-minute script in a ${body.tone} tone.
Intention: "${body.intention}"

Return strict JSON with this shape:
{
  "title": "string",
  "durationMinutes": number,
  "tone": "calm|uplifting|focused",
  "sections": [
    { "name": "Arrival", "minutes": number, "text": "string" },
    { "name": "Breath Alignment", "minutes": number, "text": "string" },
    { "name": "Unified Intention", "minutes": number, "text": "string" },
    { "name": "Closing Gratitude", "minutes": number, "text": "string" }
  ],
  "speakerNotes": "string"
}
Only return valid JSON. No markdown.
    `.trim();

    let text = "";

    try {
      const completion = await openai.responses.create({
        model: env.OPENAI_MODEL || "gpt-5-mini",
        input: prompt,
        text: {
          format: {
            type: "json_object"
          }
        }
      } as any);

      text = completion.output_text?.trim() || "";
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode ?? err?.code;
      if (status === 429) {
        return reply.code(429).send({
          error: "AI provider is rate-limited right now. Please retry in ~20 seconds."
        });
      }

      app.log.error(err);
      return reply.code(502).send({
        error: "AI provider request failed."
      });
    }

    if (!text) {
      return reply.code(502).send({ error: "No script returned from AI." });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return reply.code(502).send({
        error: "AI returned non-JSON output.",
        raw: text
      });
    }

    const script = await prisma.script.create({
      data: {
        authorUserId,
        title: parsed?.title || "Guided Intention Script",
        intention: body.intention,
        durationMinutes: Number(parsed?.durationMinutes || body.durationMinutes),
        tone: parsed?.tone || body.tone,
        contentJson: JSON.stringify(parsed)
      }
    });

    return { scriptId: script.id, script: parsed };
  }
);

app.get(
  "/api/scripts",
  { preHandler: (app as any).authenticate },
  async (req: any) => {
    const userId = String(req.user?.sub || "");
    const scripts = await prisma.script.findMany({
      where: { authorUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return {
      scripts: scripts.map((s) => ({
        id: s.id,
        title: s.title,
        intention: s.intention,
        durationMinutes: s.durationMinutes,
        tone: s.tone,
        createdAt: s.createdAt
      }))
    };
  }
);

app.post(
  "/api/events/:id/attach-script",
  { preHandler: (app as any).authenticate },
  async (req: any, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ scriptId: z.string().min(1) }).parse(req.body);

    const userId = String(req.user?.sub || "");
    if (!userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const event = await prisma.event.findUnique({ where: { id: params.id } });
    if (!event) return reply.code(404).send({ error: "Event not found." });

    if (event.hostUserId !== userId) {
      return reply.code(403).send({ error: "Forbidden: not your event." });
    }

    const script = await prisma.script.findUnique({ where: { id: body.scriptId } });
    if (!script) return reply.code(404).send({ error: "Script not found." });

    if (script.authorUserId !== userId) {
      return reply.code(403).send({ error: "Forbidden: not your script." });
    }

    const updated = await prisma.event.update({
      where: { id: params.id },
      data: { scriptId: body.scriptId }
    });

    return { event: updated };
  }
);

app.get("/", async () => ({ service: "egregor-api", status: "ok" }));

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`API running on :${env.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

declare module "fastify" {
  interface FastifyInstance {
    authenticate: any;
  }
}
