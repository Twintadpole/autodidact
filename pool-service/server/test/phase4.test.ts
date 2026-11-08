import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Customer, Pool, Visit } from '../src/models/index.js';
import { newId } from '../src/util.js';
import { anyChemicalId, login, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
let cookie: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  cookie = await login(ctx.app);
});

afterAll(async () => {
  await ctx.close();
});

const post = (payload: unknown) => ctx.app.inject({ method: 'POST', url: '/api/sync/package', headers: { cookie }, payload: payload as object });
const iso = (d: Date) => d.toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60_000);

function customerDoc(name: string, at = new Date()) {
  return { _id: newId(), name, phones: [], address: { line1: '1 Offline St', city: 'Dallas', state: 'TX', zip: '75201' }, createdAt: iso(at), updatedAt: iso(at) };
}
function poolDoc(customerId: string, at = new Date(), extra: Record<string, unknown> = {}) {
  return { _id: newId(), customerId, name: 'Backyard', type: 'chlorine', volumeGal: 15000, serviceDay: 'mon', createdAt: iso(at), updatedAt: iso(at), ...extra };
}

describe('offline packages', () => {
  it('creates a customer and pool, then logs a visit to that pool in the same package', async () => {
    const c = customerDoc('Offline Olivia');
    const p = poolDoc(c._id);
    const now = iso(new Date());
    const res = await post({
      packageId: newId(),
      poolId: p._id,
      createdAt: now,
      customers: [c],
      pools: [p],
      visit: { _id: newId(), poolId: p._id, visitedAt: now, createdAt: now, updatedAt: now, readings: { fc: 3 }, doses: [{ chemicalId: await anyChemicalId(), amount: 1, unit: 'gal' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toMatchObject({ customers: 1, pools: 1, visit: 1 });
    expect(await Customer.countDocuments({ _id: c._id })).toBe(1);
    expect(await Visit.countDocuments({ poolId: p._id })).toBe(1);
  });

  it('accepts packages with no pool (customer edits, chemicals) but requires poolId for pool-scoped content', async () => {
    const c = customerDoc('Notes Only');
    const ok = await post({ packageId: newId(), createdAt: iso(new Date()), customers: [c], notes: [{ _id: newId(), parentType: 'customer', parentId: c._id, body: 'call before coming', createdAt: iso(new Date()), updatedAt: iso(new Date()) }] });
    expect(ok.statusCode).toBe(200);
    const now = iso(new Date());
    const bad = await post({ packageId: newId(), createdAt: now, visit: { _id: newId(), poolId: newId(), visitedAt: now, createdAt: now, updatedAt: now } });
    expect(bad.statusCode).toBe(400);
  });

  it('caps a phone clock that runs ahead so it cannot win every later edit', async () => {
    const future = new Date(Date.now() + 3 * 24 * 3600_000);
    const c = customerDoc('Fast Clock', future);
    await post({ packageId: newId(), createdAt: iso(new Date()), customers: [c] });
    const stored = await Customer.findById(c._id).lean<any>();
    expect(stored.updatedAt.getTime()).toBeLessThan(Date.now() + 60_000);
    // A normal edit a minute later still wins
    const edit = { ...c, name: 'Fast Clock (fixed)', updatedAt: iso(new Date(Date.now() + 60_000)) };
    await post({ packageId: newId(), createdAt: iso(new Date()), customers: [edit] });
    expect((await Customer.findById(c._id).lean<any>()).name).toBe('Fast Clock (fixed)');
  });

  it('offline Reset week clears only checkmarks made before it', async () => {
    const c = customerDoc('Reset Rita');
    const before = poolDoc(c._id);
    const after = poolDoc(c._id);
    await post({ packageId: newId(), createdAt: iso(new Date()), customers: [c], pools: [before, after] });
    await post({ packageId: newId(), poolId: before._id, createdAt: iso(ago(30)), weekToggle: { done: true, at: iso(ago(30)) } });
    await post({ packageId: newId(), poolId: after._id, createdAt: iso(ago(5)), weekToggle: { done: true, at: iso(ago(5)) } });
    // Reset pressed offline 10 minutes ago, synced now
    const res = await post({ packageId: newId(), createdAt: iso(ago(10)), resetWeek: { at: iso(ago(10)) } });
    expect(res.json().applied.resetWeek).toBeGreaterThanOrEqual(1);
    expect((await Pool.findById(before._id).lean<any>()).week.done).toBe(false);
    expect((await Pool.findById(after._id).lean<any>()).week.done).toBe(true);
  });

  it('editing a pool on a phone that missed a Reset week does not undo the reset', async () => {
    const c = customerDoc('Stale Sam');
    const p = poolDoc(c._id, ago(60), { week: { done: true, doneAt: iso(ago(60)), changedAt: iso(ago(60)) } });
    await post({ packageId: newId(), createdAt: iso(ago(60)), customers: [c], pools: [p] });
    await ctx.app.inject({ method: 'POST', url: '/api/route/reset-week', headers: { cookie } });
    // Phone still thinks done=true, renames the pool
    await post({ packageId: newId(), createdAt: iso(new Date()), pools: [{ ...p, name: 'Front pool', updatedAt: iso(new Date()) }] });
    const stored = await Pool.findById(p._id).lean<any>();
    expect(stored.name).toBe('Front pool');
    expect(stored.week.done).toBe(false);
  });

  it('a pool deleted on the phone hides its visits too', async () => {
    const c = customerDoc('Deleted Dan');
    const p = poolDoc(c._id);
    const now = iso(new Date());
    const vid = newId();
    await post({ packageId: newId(), poolId: p._id, createdAt: now, customers: [c], pools: [p], visit: { _id: vid, poolId: p._id, visitedAt: now, createdAt: now, updatedAt: now } });
    const later = iso(new Date(Date.now() + 1000));
    await post({ packageId: newId(), createdAt: later, pools: [{ ...p, deletedAt: later, updatedAt: later }] });
    expect((await Visit.findById(vid).lean<any>()).deletedAt).toBeInstanceOf(Date);
  });
});
