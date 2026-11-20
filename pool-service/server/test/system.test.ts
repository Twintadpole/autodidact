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

  it('reports the offsite copy, the restore check, open alerts and disk space (dashboard System card)', async () => {
    const cookie = await login(ctx.app);
    await fs.writeFile(path.join(backupDir, 'LAST_OFFSITE'), '2026-11-05T03:20:00Z\n');
    await fs.writeFile(path.join(backupDir, 'LAST_RESTORE_CHECK'), '2026-11-02T04:50:00Z\n');
    await fs.writeFile(path.join(backupDir, 'MONITOR_STATUS'), 'checked 2026-11-05T10:05:00Z\ndown disk 2026-11-05T09:07:00Z\n');
    const body = (await ctx.app.inject({ method: 'GET', url: '/api/system/status', headers: { cookie } })).json();
    expect(body).toMatchObject({
      lastOffsiteAt: '2026-11-05T03:20:00.000Z',
      lastRestoreCheckAt: '2026-11-02T04:50:00.000Z',
      monitorCheckedAt: '2026-11-05T10:05:00.000Z',
      openAlerts: [{ name: 'disk', since: '2026-11-05T09:07:00.000Z' }],
    });
    expect(body.disk.usedPct).toBeGreaterThanOrEqual(0);
    expect(body.disk.usedPct).toBeLessThanOrEqual(100);
  });
});

describe('GET /api/access-login', () => {
  it('sends the browser back to the app, without needing the app login', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/access-login' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});
