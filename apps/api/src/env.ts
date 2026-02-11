import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.string().default("info"),

  JWT_SECRET: z.string().min(16),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),

  REDIS_URL: z.string().url(),
  REDIS_PUBSUB_CHANNEL: z.string().default("eg:realtime:broadcast"),

  PRESENCE_STALE_SECONDS: z.coerce.number().default(30),
  BROADCAST_INTERVAL_MS: z.coerce.number().default(3000),

  RATE_LIMIT_JOIN_CAPACITY: z.coerce.number().default(20),
  RATE_LIMIT_JOIN_REFILL_PER_SEC: z.coerce.number().default(0.2),
  RATE_LIMIT_HEARTBEAT_CAPACITY: z.coerce.number().default(120),
  RATE_LIMIT_HEARTBEAT_REFILL_PER_SEC: z.coerce.number().default(2),
  RATE_LIMIT_SCRIPTS_CAPACITY: z.coerce.number().default(10),
  RATE_LIMIT_SCRIPTS_REFILL_PER_SEC: z.coerce.number().default(0.05),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default("development"),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.1),
  SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().default(0.0),
  RELEASE: z.string().optional()
});

export const env = EnvSchema.parse(process.env);