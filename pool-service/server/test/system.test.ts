import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
let backupDir: string;

beforeAll(async () => {
  backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pool-backups-'));
  ctx = await setupTestApp({ backupDir });
});

afterAll(async () => {
  await ctx.close();
  await fs.rm(backupDir, { recursive: true, force: true });
});

describe('GET /api/system/status', () => {
  it('requires login', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/system/status' })).statusCode).toBe(401);
  });

  it('reports no backup, then the time in LAST_BACKUP', async () => {
    const cookie = await login(ctx.app);
    const before = await ctx.app.inject({ method: 'GET', url: '/api/system/status', headers: { cookie } });
    expect(before.json().lastBackupAt).toBeNull();

    await fs.writeFile(path.join(backupDir, 'LAST_BACKUP'), '2026-11-05T03:17:02Z\n');
    const after = await ctx.app.inject({ method: 'GET', url: '/api/system/status', headers: { cookie } });
    expect(after.json().lastBackupAt).toBe('2026-11-05T03:17:02.000Z');
  });
});
