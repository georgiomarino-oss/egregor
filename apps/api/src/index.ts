import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { env } from "./env.js";

const prisma = new PrismaClient();

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL
  }
});

await app.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true
});

await app.register(jwt, {
  secret: env.JWT_SECRET
});

app.decorate(
  "authenticate",
  async function (request: any, reply: any) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  }
);

app.get("/api/health", async () => ({ ok: true, service: "egregor-api" }));

app.post("/api/auth/signup", async (req, reply) => {
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

app.post("/api/events", { preHandler: (app as any).authenticate }, async (req: any, reply) => {
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

app.get("/", async () => ({ service: "egregor-api", status: "ok" }));

app.listen({ port: env.PORT, host: "0.0.0.0" })
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
