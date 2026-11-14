import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Issue, Note, Photo, Pool, SyncLog, Visit } from '../src/models/index.js';
import { newId } from '../src/util.js';
import { anyChemicalId, createPool, login, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
let cookie: string;
let poolId: string;
let chemicalId: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  cookie = await login(ctx.app);
  poolId = await createPool(ctx.app, cookie);
  chemicalId = await anyChemicalId();
});

afterAll(async () => {
  await ctx.close();
});

function makePackage(overrides: Record<string, unknown> = {}) {
  const at = new Date().toISOString();
  return {
    packageId: newId(),
    poolId,
    createdAt: at,
    visit: {
      _id: newId(),
      poolId,
      visitedAt: at,
      createdAt: at,
      updatedAt: at,
      readings: { fc: 3, ph: 7.6, ta: 90, salt: 3200 } as Record<string, number>,
      doses: [{ chemicalId, amount: 1.5, unit: 'gal' }],
      tasks: { brushed: true, skimmed: true },
      notes: 'Filter pressure a bit high',
    },
    issues: [
      { _id: newId(), poolId, title: 'Cracked skimmer lid', urgent: false, important: true, createdAt: at, updatedAt: at },
    ],
    notes: [{ _id: newId(), parentType: 'pool', parentId: poolId, body: 'Dog is friendly', pinned: true, createdAt: at, updatedAt: at }],
    weekToggle: { done: true, at },
    ...overrides,
  };
}

function postJson(payload: unknown) {
  return ctx.app.inject({ method: 'POST', url: '/api/sync/package', headers: { cookie }, payload: payload as object });
}

function multipartBody(pkg: unknown, files: Record<string, Buffer>) {
  const boundary = '----pooltest' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="package"\r\n\r\n${JSON.stringify(pkg)}\r\n`));
  for (const [name, data] of Object.entries(files)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      data,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('POST /api/sync/package', () => {
  it('applies a whole package', async () => {
    const pkg = makePackage();
    const res = await postJson(pkg);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      packageId: pkg.packageId,
      duplicate: false,
      applied: { visit: 1, issues: 1, notes: 1, photos: 0, weekToggle: true },
    });

    const visit = await Visit.findById(pkg.visit._id).lean<any>();
    expect(visit.readings.fc).toBe(3);
    expect(visit.doses).toHaveLength(1);
    expect(visit.tasks.brushed).toBe(true);
    expect(visit.tasks.vacuumed).toBe(false);
    expect(await Issue.countDocuments({ _id: pkg.issues[0]!._id })).toBe(1);
    expect(await Note.countDocuments({ _id: pkg.notes[0]!._id })).toBe(1);
    const pool = await Pool.findById(poolId).lean<any>();
    expect(pool.week.done).toBe(true);
    expect(await SyncLog.countDocuments({ _id: pkg.packageId })).toBe(1);
  });

  it('saves filter PSI and the separate basket tasks; old visits keep "baskets emptied"', async () => {
    const pkg = makePackage();
    pkg.visit.readings = { fc: 3, filterPsi: 18 };
    (pkg.visit as any).tasks = { skimmerBaskets: true, pumpBasket: false };
    expect((await postJson(pkg)).statusCode).toBe(200);
    const visit = await Visit.findById(pkg.visit._id).lean<any>();
    expect(visit.readings.filterPsi).toBe(18);
    expect(visit.tasks).toMatchObject({ skimmerBaskets: true, pumpBasket: false, basketsEmptied: false });

    const old = makePackage();
    (old.visit as any).tasks = { basketsEmptied: true };
    expect((await postJson(old)).statusCode).toBe(200);
    expect((await Visit.findById(old.visit._id).lean<any>()).tasks.basketsEmptied).toBe(true);
  });

  it('is idempotent: retrying the same packageId applies it once and returns 200', async () => {
    const pkg = makePackage();
    const first = await postJson(pkg);
    const second = await postJson(pkg);
    const third = await postJson(pkg);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(200);
    expect(first.json().duplicate).toBe(false);
    expect(second.json().duplicate).toBe(true);
    expect(third.json().duplicate).toBe(true);
    expect(await Visit.countDocuments({ _id: pkg.visit._id })).toBe(1);
    expect(await SyncLog.countDocuments({ _id: pkg.packageId })).toBe(1);
  });

  it('handles concurrent duplicate retries without double-applying', async () => {
    const pkg = makePackage();
    const results = await Promise.all([postJson(pkg), postJson(pkg), postJson(pkg), postJson(pkg)]);
    for (const r of results) expect(r.statusCode).toBe(200);
    expect(results.filter((r) => r.json().duplicate === false)).toHaveLength(1);
    expect(await SyncLog.countDocuments({ _id: pkg.packageId })).toBe(1);
    expect(await Visit.countDocuments({ _id: pkg.visit._id })).toBe(1);
  });

  it('rolls back the whole package when any part is invalid', async () => {
    const pkg = makePackage();
    pkg.visit.doses = [{ chemicalId: newId(), amount: 1, unit: 'lb' }]; // unknown chemical
    const res = await postJson(pkg);
    expect(res.statusCode).toBe(422);
    expect(await Visit.countDocuments({ _id: pkg.visit._id })).toBe(0);
    expect(await Issue.countDocuments({ _id: pkg.issues[0]!._id })).toBe(0);
    expect(await Note.countDocuments({ _id: pkg.notes[0]!._id })).toBe(0);
    expect(await SyncLog.countDocuments({ _id: pkg.packageId })).toBe(0);
  });

  it('returns 422 for an unknown pool and 400 for a malformed package', async () => {
    const otherPool = newId();
    const unknown = await postJson({ packageId: newId(), poolId: otherPool, createdAt: new Date().toISOString() });
    expect(unknown.statusCode).toBe(422);
    const bad = await postJson({ packageId: 'not-a-uuid', poolId });
    expect(bad.statusCode).toBe(400);
  });

  it('uses last-write-wins on updatedAt', async () => {
    const first = makePackage({ issues: [], notes: [], weekToggle: undefined });
    await postJson(first);

    const newer = new Date(Date.now() + 60_000).toISOString();
    const older = new Date(Date.now() - 60_000).toISOString();

    const update = makePackage({ issues: [], notes: [], weekToggle: undefined });
    update.visit = { ...first.visit, updatedAt: newer, readings: { fc: 5 } };
    expect((await postJson(update)).json().applied.visit).toBe(1);

    const stale = makePackage({ issues: [], notes: [], weekToggle: undefined });
    stale.visit = { ...first.visit, updatedAt: older, readings: { fc: 1 } };
    const res = await postJson(stale);
    expect(res.statusCode).toBe(200);
    expect(res.json().applied.visit).toBe(0);

    const visit = await Visit.findById(first.visit._id).lean<any>();
    expect(visit.readings.fc).toBe(5);
  });

  it('stamps issue status timestamps (completed / postponed)', async () => {
    const at = new Date().toISOString();
    const issueId = newId();
    const base = { _id: issueId, poolId, title: 'Pump noise', createdAt: at };
    await postJson(makePackage({ visit: undefined, notes: [], issues: [{ ...base, status: 'postponed', updatedAt: at }] }));
    let issue = await Issue.findById(issueId).lean<any>();
    expect(issue.status).toBe('postponed');
    expect(issue.postponedAt).toBeInstanceOf(Date);

    const later = new Date(Date.now() + 1000).toISOString();
    await postJson(makePackage({ visit: undefined, notes: [], issues: [{ ...base, status: 'resolved', updatedAt: later }] }));
    issue = await Issue.findById(issueId).lean<any>();
    expect(issue.status).toBe('resolved');
    expect(issue.resolvedAt).toBeInstanceOf(Date);
    expect(issue.postponedAt).toBeNull();
  });

  it('stores uploaded photos and rejects photo metadata without a file', async () => {
    const photoId = newId();
    const at = new Date('2026-10-31T12:00:00Z').toISOString();
    const meta = { _id: photoId, poolId, savedToPool: true, width: 1600, height: 1200, bytes: 4, takenAt: at, createdAt: at, updatedAt: at };
    const pkg = makePackage({ visit: undefined, issues: [], notes: [], weekToggle: undefined, photos: [meta] });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const { body, contentType } = multipartBody(pkg, { [photoId]: jpeg });
    const res = await ctx.app.inject({ method: 'POST', url: '/api/sync/package', headers: { cookie, 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied.photos).toBe(1);

    const photo = await Photo.findById(photoId).lean<any>();
    expect(photo.file).toBe(`2026/10/${photoId}.jpg`);
    expect(await fs.readFile(path.join(ctx.photoDir, photo.file))).toEqual(jpeg);

    const served = await ctx.app.inject({ method: 'GET', url: `/api/photos/${photoId}`, headers: { cookie } });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.rawPayload).toEqual(jpeg);
    const thumb = await ctx.app.inject({ method: 'GET', url: `/api/photos/${photoId}/thumb`, headers: { cookie } });
    expect(thumb.statusCode).toBe(200);

    const missing = makePackage({ visit: undefined, issues: [], notes: [], weekToggle: undefined, photos: [{ ...meta, _id: newId() }] });
    expect((await postJson(missing)).statusCode).toBe(400);
  });
});

describe('weekly checkmark', () => {
  it('reset-week clears every pool and beats an older offline toggle', async () => {
    const before = new Date(Date.now() - 10_000).toISOString();
    await postJson(makePackage({ visit: undefined, issues: [], notes: [], weekToggle: { done: true, at: new Date().toISOString() } }));

    const reset = await ctx.app.inject({ method: 'POST', url: '/api/route/reset-week', headers: { cookie } });
    expect(reset.statusCode).toBe(200);
    expect((await Pool.findById(poolId).lean<any>()).week.done).toBe(false);

    // A toggle made offline before the reset arrives late: the reset wins.
    const late = await postJson(makePackage({ visit: undefined, issues: [], notes: [], weekToggle: { done: true, at: before } }));
    expect(late.json().applied.weekToggle).toBe(false);
    expect((await Pool.findById(poolId).lean<any>()).week.done).toBe(false);

    // A toggle made after the reset applies.
    const fresh = await postJson(
      makePackage({ visit: undefined, issues: [], notes: [], weekToggle: { done: true, at: new Date(Date.now() + 1000).toISOString() } }),
    );
    expect(fresh.json().applied.weekToggle).toBe(true);
    expect((await Pool.findById(poolId).lean<any>()).week.done).toBe(true);
  });
});

describe('GET /api/sync/pull', () => {
  it('returns everything on first pull and only changes (incl. soft deletes) after', async () => {
    const full = await ctx.app.inject({ method: 'GET', url: '/api/sync/pull', headers: { cookie } });
    expect(full.statusCode).toBe(200);
    const body = full.json();
    expect(body.chemicals.length).toBe(11);
    expect(body.pools.map((p: any) => p._id)).toContain(poolId);
    // First pull keeps at most 2 visits per pool.
    expect(body.visits.filter((v: any) => v.poolId === poolId).length).toBeLessThanOrEqual(2);
    expect(body.pools[0].syncedAt).toBeUndefined();

    const since = body.serverTime;
    await new Promise((r) => setTimeout(r, 20));
    const noteRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { cookie },
      payload: { parentType: 'pool', parentId: poolId, body: 'New note' },
    });
    const noteId = noteRes.json()._id;
    await ctx.app.inject({ method: 'DELETE', url: `/api/notes/${noteId}`, headers: { cookie } });

    const delta = await ctx.app.inject({ method: 'GET', url: `/api/sync/pull?since=${encodeURIComponent(since)}`, headers: { cookie } });
    const deleted = delta.json().notes.find((n: any) => n._id === noteId);
    expect(deleted).toBeDefined();
    expect(deleted.deletedAt).not.toBeNull();
  });
});
