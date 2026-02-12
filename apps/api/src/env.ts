import "dotenv/config";
import { z } from "zod";

export const env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  CORS_ORIGIN: z.string().min(1),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),

  REDIS_URL: z.string().optional(),
  REDIS_PUBSUB_CHANNEL: z.string().default("eg:realtime:broadcast"),

  PRESENCE_STALE_SECONDS: z.coerce.number().default(30),
  BROADCAST_INTERVAL_MS: z.coerce.number().default(3000),

  RATE_LIMIT_JOIN_CAPACITY: z.coerce.number().default(20),
  RATE_LIMIT_JOIN_REFILL_PER_SEC: z.coerce.number().default(0.2),
  RATE_LIMIT_HEARTBEAT_CAPACITY: z.coerce.number().default(120),
  RATE_LIMIT_HEARTBEAT_REFILL_PER_SEC: z.coerce.number().default(2),
  RATE_LIMIT_SCRIPTS_CAPACITY: z.coerce.number().default(10),
  RATE_LIMIT_SCRIPTS_REFILL_PER_SEC: z.coerce.number().default(0.05)
}).parse(process.env);
