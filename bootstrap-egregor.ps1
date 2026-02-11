$ErrorActionPreference = "Stop"

function Write-FileUtf8($path, $content) {
  $dir = Split-Path $path -Parent
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

# Root files
Write-FileUtf8 "package.json" @'
{
  "name": "egregor",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "db:migrate": "pnpm --filter @egregor/api exec prisma migrate dev --name init --schema prisma/schema.prisma",
    "db:generate": "pnpm --filter @egregor/api exec prisma generate --schema prisma/schema.prisma"
  }
}
'@

Write-FileUtf8 "pnpm-workspace.yaml" @'
packages:
  - "apps/*"
  - "packages/*"
'@

Write-FileUtf8 "tsconfig.base.json" @'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true
  }
}
'@

Write-FileUtf8 ".gitignore" @'
node_modules
dist
.next
.env
.env.*
!.env.example
pnpm-lock.yaml
'@

Write-FileUtf8 ".env.example" @'
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/egregor?schema=public"
PORT=4000
CORS_ORIGIN="http://localhost:3000"
LOG_LEVEL=info

JWT_SECRET="replace-with-long-random-secret"

OPENAI_API_KEY="your_openai_api_key"
OPENAI_MODEL="gpt-5-mini"

REDIS_URL="redis://localhost:6379"
REDIS_PUBSUB_CHANNEL="eg:realtime:broadcast"
PRESENCE_STALE_SECONDS=30
BROADCAST_INTERVAL_MS=3000

RATE_LIMIT_JOIN_CAPACITY=20
RATE_LIMIT_JOIN_REFILL_PER_SEC=0.2
RATE_LIMIT_HEARTBEAT_CAPACITY=120
RATE_LIMIT_HEARTBEAT_REFILL_PER_SEC=2
RATE_LIMIT_SCRIPTS_CAPACITY=10
RATE_LIMIT_SCRIPTS_REFILL_PER_SEC=0.05

SENTRY_DSN=""
SENTRY_ENVIRONMENT=development
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.0
RELEASE=""

NEXT_PUBLIC_API_BASE_URL="http://localhost:4000"
NEXT_PUBLIC_WS_URL="ws://localhost:4000/ws"
NEXT_PUBLIC_SENTRY_DSN=""
NEXT_PUBLIC_SENTRY_ENVIRONMENT="development"
'@

Write-FileUtf8 "docker-compose.yml" @'
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    container_name: egregor-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: egregor
    ports:
      - "5432:5432"
    volumes:
      - egregor_pg_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: egregor-redis
    ports:
      - "6379:6379"
    volumes:
      - egregor_redis_data:/data

volumes:
  egregor_pg_data:
  egregor_redis_data:
'@

# Shared package
Write-FileUtf8 "packages/shared/package.json" @'
{
  "name": "@egregor/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
'@

Write-FileUtf8 "packages/shared/src/index.ts" @'
export type Theme = {
  id: string;
  name: string;
  description?: string;
};
'@

# API
Write-FileUtf8 "apps/api/package.json" @'
{
  "name": "@egregor/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "echo \"lint placeholder\""
  },
  "dependencies": {
    "@egregor/shared": "workspace:*",
    "@fastify/cors": "^10.0.1",
    "@fastify/jwt": "^9.0.0",
    "@fastify/websocket": "^11.0.1",
    "@prisma/client": "^6.1.0",
    "@sentry/node": "^8.33.0",
    "@sentry/profiling-node": "^8.33.0",
    "dotenv": "^16.4.5",
    "fastify": "^5.0.0",
    "fastify-plugin": "^5.0.1",
    "ioredis": "^5.4.1",
    "ngeohash": "^0.6.3",
    "openai": "^4.70.0",
    "prom-client": "^15.1.3",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "prisma": "^6.1.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
'@

Write-FileUtf8 "apps/api/tsconfig.json" @'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
'@

Write-FileUtf8 "apps/api/prisma/schema.prisma" @'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id          String   @id @default(cuid())
  email       String   @unique
  displayName String
  createdAt   DateTime @default(now())
}

model Theme {
  id          String   @id @default(cuid())
  name        String
  description String?
}

model Event {
  id                  String   @id @default(cuid())
  hostUserId          String
  themeId             String?
  title               String
  description         String?
  intentionStatement  String
  visibility          String
  guidanceMode        String
  scriptId            String?
  startTimeUtc        DateTime
  endTimeUtc          DateTime
  timezone            String
  status              String   @default("SCHEDULED")
  activeCountSnapshot Int      @default(0)
  totalJoinCount      Int      @default(0)
  theme               Theme?   @relation(fields: [themeId], references: [id])
}
'@

Write-FileUtf8 "apps/api/src/env.ts" @'
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
'@

Write-FileUtf8 "apps/api/src/index.ts" @'
import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL
  }
});

await app.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true
});

app.get("/api/health", async () => ({ ok: true, service: "egregor-api" }));
app.get("/", async () => ({ service: "egregor-api", status: "ok" }));

app.listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`API running on :${env.PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
'@

# Web
Write-FileUtf8 "apps/web/package.json" @'
{
  "name": "@egregor/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "typecheck": "tsc --noEmit",
    "lint": "next lint"
  },
  "dependencies": {
    "@egregor/shared": "workspace:*",
    "@sentry/nextjs": "^8.33.0",
    "next": "15.0.3",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.8.6",
    "@types/react": "^18.3.12",
    "typescript": "^5.6.3"
  }
}
'@

Write-FileUtf8 "apps/web/tsconfig.json" @'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "incremental": true,
    "noEmit": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
'@

Write-FileUtf8 "apps/web/next.config.ts" @'
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: { typedRoutes: true }
};

export default withSentryConfig(nextConfig, { silent: true });
'@

Write-FileUtf8 "apps/web/next-env.d.ts" @'
/// <reference types="next" />
/// <reference types="next/image-types/global" />
'@

Write-FileUtf8 "apps/web/app/page.tsx" @'
export default function HomePage() {
  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>Egregor</h1>
      <p>Collective intention for positive change.</p>
      <p>Your app base is running.</p>
      <ul>
        <li>Web: http://localhost:3000</li>
        <li>API health: http://localhost:4000/api/health</li>
      </ul>
    </main>
  );
}
'@

Write-Host "Bootstrap complete."

