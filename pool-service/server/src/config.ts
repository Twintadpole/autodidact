import path from 'node:path';
import { z } from 'zod';

const boolFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGO_URL: z.string().default('mongodb://localhost:27017/pool?replicaSet=rs0'),
  /** Signs the session cookie. Generate with `openssl rand -hex 32`. */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  /** argon2 hash of the single user's password (`npm run hash-password`). */
  ADMIN_PASSWORD_HASH: z.string().startsWith('$argon2', 'ADMIN_PASSWORD_HASH must be an argon2 hash'),
  PHOTO_DIR: z.string().default('./data/photos'),
  /** Built Quasar PWA to serve from `/` (optional in development). */
  CLIENT_DIST: z.string().optional(),
  COOKIE_SECURE: boolFromEnv.optional(),
  /** Behind Cloudflare Tunnel / a reverse proxy: trust X-Forwarded-* headers. */
  TRUST_PROXY: boolFromEnv.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  mongoUrl: string;
  sessionSecret: string;
  adminPasswordHash: string;
  photoDir: string;
  clientDist?: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  logLevel: string;
  /** Login attempts allowed per window per IP. */
  loginRateLimit: { max: number; timeWindow: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    mongoUrl: e.MONGO_URL,
    sessionSecret: e.SESSION_SECRET,
    adminPasswordHash: e.ADMIN_PASSWORD_HASH,
    photoDir: path.resolve(e.PHOTO_DIR),
    clientDist: e.CLIENT_DIST ? path.resolve(e.CLIENT_DIST) : undefined,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    trustProxy: e.TRUST_PROXY,
    logLevel: e.LOG_LEVEL,
    loginRateLimit: { max: 5, timeWindow: '15 minutes' },
  };
}
