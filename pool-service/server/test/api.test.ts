import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/util.js';
import { createPool, login, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.close();
});

describe('auth', () => {
  it('rejects protected routes without a session but allows /health', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/customers' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/sync/pull' })).statusCode).toBe(401);
    const health = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true, mongo: true });
  });

  it('logs in, sets an HttpOnly SameSite=Lax cookie, and logs out', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: TEST_PASSWORD } });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'pool.sid')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.expires).toBeUndefined(); // browser-session cookie without "remember"

    const header = `pool.sid=${cookie.value}`;
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: header } })).statusCode).toBe(200);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: header } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: header } })).statusCode).toBe(401);
  });

  it('"remember this device" gives a ~90-day cookie', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: TEST_PASSWORD, remember: true } });
    const cookie = res.cookies.find((c) => c.name === 'pool.sid')!;
    const days = (new Date(cookie.expires!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThanOrEqual(90);
  });
});

describe('login rate limit', () => {
  it('allows 5 attempts per window then returns 429', async () => {
    const limited = await setupTestAppIsolated();
    try {
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await limited.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong' } });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(codes[5]).toBe(429);
    } finally {
      await limited.app.close();
    }
  });
});

/** A second app instance on the same DB, so the rate-limit counter starts fresh. */
async function setupTestAppIsolated() {
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp(ctx.config);
  await app.ready();
  return { app };
}

describe('CRUD', () => {
  let cookie: string;
  beforeAll(async () => {
    cookie = await login(ctx.app);
  });

  it('creates, patches and soft-deletes customers', async () => {
    const id = newId();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/customers',
      headers: { cookie },
      payload: { _id: id, name: 'Bob', address: { line1: '2 Oak', city: 'Austin', state: 'TX', zip: '78702' } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()._id).toBe(id);

    const dup = await ctx.app.inject({
      method: 'POST',
      url: '/api/customers',
      headers: { cookie },
      payload: { _id: id, name: 'Bob', address: { line1: '2 Oak', city: 'Austin', state: 'TX', zip: '78702' } },
    });
    expect(dup.statusCode).toBe(409);

    const patched = await ctx.app.inject({ method: 'PATCH', url: `/api/customers/${id}`, headers: { cookie }, payload: { notes: 'VIP' } });
    expect(patched.json()).toMatchObject({ name: 'Bob', notes: 'VIP' });

    const badPhone = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/customers/${id}`,
      headers: { cookie },
      payload: { phones: [{ label: 'cell', number: '555-1234' }] },
    });
    expect(badPhone.statusCode).toBe(400);

    await ctx.app.inject({ method: 'DELETE', url: `/api/customers/${id}`, headers: { cookie } });
    const list = await ctx.app.inject({ method: 'GET', url: '/api/customers', headers: { cookie } });
    expect(list.json().map((c: any) => c._id)).not.toContain(id);
    const withDeleted = await ctx.app.inject({ method: 'GET', url: '/api/customers?includeDeleted=true', headers: { cookie } });
    expect(withDeleted.json().map((c: any) => c._id)).toContain(id);
  });

  it('PATCH only changes the fields sent', async () => {
    const poolId = await createPool(ctx.app, cookie, { routeOrder: 7, accessNotes: 'Gate 1234' });
    const res = await ctx.app.inject({ method: 'PATCH', url: `/api/pools/${poolId}`, headers: { cookie }, payload: { name: 'Spa' } });
    expect(res.json()).toMatchObject({ name: 'Spa', routeOrder: 7, accessNotes: 'Gate 1234' });
  });

  it('lists seeded chemicals', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/chemicals?active=true', headers: { cookie } });
    expect(res.json().map((c: any) => c.name)).toContain('Muriatic acid');
  });

  it('filters issues by status and stamps completed / postponed', async () => {
    const poolId = await createPool(ctx.app, cookie);
    const create = (title: string, status?: string) =>
      ctx.app.inject({ method: 'POST', url: '/api/issues', headers: { cookie }, payload: { poolId, title, urgent: true, ...(status && { status }) } });
    const a = (await create('Leak')).json();
    await create('Light out', 'postponed');
    expect(a.resolvedAt).toBeNull();

    const done = await ctx.app.inject({ method: 'PATCH', url: `/api/issues/${a._id}`, headers: { cookie }, payload: { status: 'resolved' } });
    expect(done.json().resolvedAt).not.toBeNull();

    const open = await ctx.app.inject({ method: 'GET', url: `/api/issues?poolId=${poolId}&status=open,in_progress`, headers: { cookie } });
    expect(open.json()).toHaveLength(0);
    const postponed = await ctx.app.inject({ method: 'GET', url: `/api/issues?poolId=${poolId}&status=postponed`, headers: { cookie } });
    expect(postponed.json()).toHaveLength(1);
    expect(postponed.json()[0].postponedAt).not.toBeNull();

    const reopened = await ctx.app.inject({ method: 'PATCH', url: `/api/issues/${a._id}`, headers: { cookie }, payload: { status: 'open' } });
    expect(reopened.json().resolvedAt).toBeNull();
  });

  it('returns the latest visits for the current + previous visit cards', async () => {
    const poolId = await createPool(ctx.app, cookie);
    for (const day of ['2026-10-10', '2026-10-17', '2026-10-24']) {
      const at = new Date(`${day}T15:00:00Z`).toISOString();
      await ctx.app.inject({
        method: 'POST',
        url: '/api/sync/package',
        headers: { cookie },
        payload: {
          packageId: newId(),
          poolId,
          createdAt: at,
          visit: { _id: newId(), poolId, visitedAt: at, createdAt: at, updatedAt: at, readings: { ph: 7.4 } },
        },
      });
    }
    const res = await ctx.app.inject({ method: 'GET', url: `/api/pools/${poolId}/visits`, headers: { cookie } });
    const visits = res.json();
    expect(visits).toHaveLength(2);
    expect(visits[0].visitedAt).toBe('2026-10-24T15:00:00.000Z');
    expect(visits[1].visitedAt).toBe('2026-10-17T15:00:00.000Z');

    const ten = await ctx.app.inject({ method: 'GET', url: `/api/pools/${poolId}/visits?limit=10`, headers: { cookie } });
    expect(ten.json()).toHaveLength(3);
  });
});
