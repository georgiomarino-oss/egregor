import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import OpenAI from "openai";
import { env } from "./env.js";

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const app = Fastify({
  logger: { level: env.LOG_LEVEL }
});

async function buildServer() {
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

  app.get("/api/health", async () => ({ ok: true, service: "egregor-api" }));

  app.post("/api/auth/signup", async (req) => {
    const body = z.object({
      email: z.string().email(),
      displayName: z.string().min(2)
    }).parse(req.body);

    const user = await prisma.user.upsert({
      where: { email: body.email },
      update: { displayName: body.displayName },
      create: { email: body.email, displayName: body.displayName }
    });

    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return { token, user };
  });

  app.post("/api/events", { preHandler: (app as any).authenticate }, async (req: any) => {
    const body = z.object({
      title: z.string().min(3),
      intentionStatement: z.string().min(3),
      startTimeUtc: z.string(),
      endTimeUtc: z.string(),
      timezone: z.string().default("Europe/London"),
      visibility: z.string().default("PUBLIC"),
      guidanceMode: z.string().default("AI"),
      description: z.string().optional()
    }).parse(req.body);

    const event = await prisma.event.create({
      data: {
        hostUserId: req.user.sub,
        title: body.title,
        description: body.description,
        intentionStatement: body.intentionStatement,
        startTimeUtc: new Date(body.startTimeUtc),
        endTimeUtc: new Date(body.endTimeUtc),
        timezone: body.timezone,
        visibility: body.visibility,
        guidanceMode: body.guidanceMode,
        status: "SCHEDULED"
      }
    });

    return { event };
  });

  app.get("/api/events", async () => {
    const events = await prisma.event.findMany({
      orderBy: { startTimeUtc: "asc" },
      take: 50
    });
    return { events };
  });

  app.post("/api/scripts/generate", { preHandler: (app as any).authenticate }, async (req: any, reply) => {
    const body = z.object({
      intention: z.string().min(3),
      durationMinutes: z.number().int().min(3).max(60).default(10),
      tone: z.enum(["calm", "uplifting", "focused"]).default("calm")
    }).parse(req.body);

    if (!env.OPENAI_API_KEY) {
      return reply.code(400).send({ error: "OPENAI_API_KEY is not configured on the server." });
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

    let completion: any;
    try {
      completion = await openai.responses.create({
        model: env.OPENAI_MODEL || "gpt-5-mini",
        input: prompt
      });
    } catch (err: any) {
      const status = Number(err?.status || err?.code || 0);
      if (status === 429) {
        return reply.code(429).send({ error: "AI rate limit reached. Please wait 30–60 seconds and try again." });
      }
      return reply.code(502).send({ error: err?.message || "AI provider request failed." });
    }

    const text = completion?.output_text?.trim();
    if (!text) return reply.code(502).send({ error: "No script returned from AI." });

    try {
      const parsed = JSON.parse(text);
      return { script: parsed };
    } catch {
      return reply.code(502).send({ error: "AI returned non-JSON output.", raw: text });
    }
  });

  app.get("/", async () => ({ service: "egregor-api", status: "ok" }));
}

async function start() {
  try {
    console.log("[startup] process.env.PORT =", process.env.PORT);
    console.log("[startup] env.PORT =", env.PORT);
    await buildServer();
    await app.listen({ host: "0.0.0.0", port: env.PORT });
    app.log.info(`API running on :${env.PORT}`);
  } catch (err) {
    console.error("[startup fatal]", err);
    process.exit(1);
  }
}

start();

declare module "fastify" {
  interface FastifyInstance {
    authenticate: any;
  }
}
