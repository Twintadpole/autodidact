import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import argon2 from 'argon2';
import mongoose from 'mongoose';
import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { Chemical, ensureCollections } from '../src/models/index.js';
import { seedChemicals } from '../src/seed/chemicals.js';
import { newId } from '../src/util.js';

export const TEST_PASSWORD = 'correct horse battery staple';

export interface TestContext {
  app: FastifyInstance;
  config: AppConfig;
  photoDir: string;
  close: () => Promise<void>;
}

let cachedHash: string | undefined;

/** Fresh database + app per test file. */
export async function setupTestApp(overrides: Partial<AppConfig> = {}): Promise<TestContext> {
  cachedHash ??= await argon2.hash(TEST_PASSWORD);
  const dbName = `pool_test_${newId().replace(/-/g, '').slice(-12)}`;
  await mongoose.connect(inject('mongoUrl'), { dbName });
  await ensureCollections();
  await seedChemicals();

  const photoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pool-photos-'));
  const config: AppConfig = {
    env: 'test',
    host: '127.0.0.1',
    port: 0,
    mongoUrl: inject('mongoUrl'),
    sessionSecret: 'test-secret-test-secret-test-secret-1234',
    adminPasswordHash: cachedHash,
    photoDir,
    cookieSecure: false,
    trustProxy: false,
    logLevel: 'silent',
    loginRateLimit: { max: 5, timeWindow: '15 minutes' },
    ...overrides,
  };
  const app = await buildApp(config);
  await app.ready();

  return {
    app,
    config,
    photoDir,
    close: async () => {
      await app.close();
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      await fs.rm(photoDir, { recursive: true, force: true });
    },
  };
}

/** Logs in and returns the Cookie header value. */
export async function login(app: FastifyInstance, remember = false): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: TEST_PASSWORD, remember } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'pool.sid');
  if (!cookie) throw new Error('no session cookie');
  return `pool.sid=${cookie.value}`;
}

export async function anyChemicalId(): Promise<string> {
  const c = await Chemical.findOne().lean<{ _id: string }>();
  return c!._id;
}

/** Creates a customer + pool through the API and returns the pool ID. */
export async function createPool(app: FastifyInstance, cookie: string, extra: Record<string, unknown> = {}): Promise<string> {
  const customer = await app.inject({
    method: 'POST',
    url: '/api/customers',
    headers: { cookie },
    payload: {
      name: 'Jane Smith',
      phones: [{ label: 'cell', number: '+15125550123' }],
      address: { line1: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' },
    },
  });
  if (customer.statusCode !== 201) throw new Error(customer.body);
  const pool = await app.inject({
    method: 'POST',
    url: '/api/pools',
    headers: { cookie },
    payload: { customerId: customer.json()._id, name: 'Backyard', type: 'salt', volumeGal: 15000, serviceDay: 'mon', ...extra },
  });
  if (pool.statusCode !== 201) throw new Error(pool.body);
  return pool.json()._id;
}

export function ts(iso: string): string {
  return new Date(iso).toISOString();
}
