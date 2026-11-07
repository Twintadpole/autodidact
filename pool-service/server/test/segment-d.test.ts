import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog, Visit } from '../src/models/index.js';
import { newId } from '../src/util.js';
import { createPool, login, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
let cookie: string;
let poolId: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  cookie = await login(ctx.app);
  poolId = await createPool(ctx.app, cookie);
});

afterAll(async () => {
  await ctx.close();
});

const at = (min: number) => new Date(Date.UTC(2026, 10, 7, 14, min)).toISOString();

function visitPackage(visit: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { packageId: newId(), poolId, createdAt: new Date().toISOString(), visit: { poolId, ...visit }, ...overrides };
}

const post = (payload: unknown) =>
  ctx.app.inject({ method: 'POST', url: '/api/sync/package', headers: { cookie }, payload: payload as object });

describe('visit timer', () => {
  const visitId = newId();
  const base = { _id: visitId, visitedAt: at(0), createdAt: at(0) };

  it('stores time segments and lists running timers', async () => {
    const res = await post(visitPackage({ ...base, updatedAt: at(0), timeLog: { segments: [{ start: at(0), end: null }] } }));
    expect(res.statusCode).toBe(200);
    const active = await ctx.app.inject({ method: 'GET', url: '/api/visits/active', headers: { cookie } });
    expect(active.json().map((v: { _id: string }) => v._id)).toContain(visitId);
  });

  it('pause and stop close segments; stopped visits are not active', async () => {
    await post(
      visitPackage({
        ...base,
        updatedAt: at(30),
        timeLog: { segments: [{ start: at(0), end: at(10) }, { start: at(15), end: at(30) }], finished: true },
      }),
    );
    const v = await Visit.findById(visitId).lean<any>();
    expect(v.timeLog.segments).toHaveLength(2);
    expect(v.timeLog.finished).toBe(true);
    const active = await ctx.app.inject({ method: 'GET', url: '/api/visits/active', headers: { cookie } });
    expect(active.json().map((x: { _id: string }) => x._id)).not.toContain(visitId);
  });

  it('ignores running timers of deleted pools', async () => {
    const otherPool = await createPool(ctx.app, cookie);
    const vid = newId();
    await post({ ...visitPackage({ _id: vid, poolId: otherPool, visitedAt: at(0), createdAt: at(0), updatedAt: at(0), timeLog: { segments: [{ start: at(0), end: null }] } }), poolId: otherPool });
    let active = await ctx.app.inject({ method: 'GET', url: '/api/visits/active', headers: { cookie } });
    expect(active.json().map((v: { _id: string }) => v._id)).toContain(vid);
    await ctx.app.inject({ method: 'DELETE', url: `/api/pools/${otherPool}`, headers: { cookie } });
    active = await ctx.app.inject({ method: 'GET', url: '/api/visits/active', headers: { cookie } });
    expect(active.json().map((v: { _id: string }) => v._id)).not.toContain(vid);
  });

  it('rejects impossible times (end before start)', async () => {
    const res = await post(visitPackage({ ...base, updatedAt: at(40), timeLog: { segments: [{ start: at(20), end: at(5) }] } }));
    expect(res.statusCode).toBe(400);
  });

  it('logs edited timestamps in the audit log', async () => {
    await post(
      visitPackage({
        ...base,
        updatedAt: at(45),
        timeLog: { segments: [{ start: at(2), end: at(10) }, { start: at(15), end: at(30) }], finished: true },
      }),
    );
    const res = await ctx.app.inject({ method: 'GET', url: `/api/audit?collection=visits&docId=${visitId}`, headers: { cookie } });
    const entries = res.json();
    expect(entries[0].action).toBe('update');
    expect(entries[0].source).toBe('sync');
    const change = entries[0].changes.find((c: { path: string }) => c.path === 'timeLog.segments');
    expect(change.from[0].start).toBe(new Date(at(0)).toISOString());
    expect(change.to[0].start).toBe(new Date(at(2)).toISOString());
    // Only the times changed: no noise from empty readings/doses
    expect(entries[0].changes.map((c: { path: string }) => c.path)).toEqual(['timeLog.segments']);
    // create + 2 updates + this update
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(entries.at(-1).action).toBe('create');
  });
});

describe('audit log for online edits', () => {
  it('records field-level changes from PATCH, and deletes', async () => {
    const res = await ctx.app.inject({ method: 'PATCH', url: `/api/pools/${poolId}`, headers: { cookie }, payload: { accessNotes: 'Gate 9999', volumeGal: 18000 } });
    expect(res.statusCode).toBe(200);
    const log = await AuditLog.find({ collectionName: 'pools', docId: poolId, action: 'update' }).sort({ at: -1 }).lean<any[]>();
    const paths = log[0].changes.map((c: { path: string }) => c.path).sort();
    expect(paths).toEqual(['accessNotes', 'volumeGal']);
    expect(log[0].changes.find((c: any) => c.path === 'volumeGal')).toMatchObject({ from: 15000, to: 18000 });

    const noteRes = await ctx.app.inject({ method: 'POST', url: '/api/notes', headers: { cookie }, payload: { parentType: 'pool', parentId: poolId, body: 'x' } });
    await ctx.app.inject({ method: 'DELETE', url: `/api/notes/${noteRes.json()._id}`, headers: { cookie } });
    const actions = (await AuditLog.find({ docId: noteRes.json()._id }).lean<any[]>()).map((e) => e.action).sort();
    expect(actions).toEqual(['create', 'delete']);
  });

  it('does not log no-op PATCHes', async () => {
    const before = await AuditLog.countDocuments({ docId: poolId });
    await ctx.app.inject({ method: 'PATCH', url: `/api/pools/${poolId}`, headers: { cookie }, payload: { accessNotes: 'Gate 9999' } });
    expect(await AuditLog.countDocuments({ docId: poolId })).toBe(before);
  });

  it('logs Reset week as one bulk entry', async () => {
    await ctx.app.inject({ method: 'POST', url: '/api/route/reset-week', headers: { cookie } });
    expect(await AuditLog.countDocuments({ collectionName: 'pools', action: 'bulk' })).toBe(1);
  });
});

describe('issue photos', () => {
  it('uploads a photo with an issue, makes a thumbnail, lists it and saves it to the pool', async () => {
    const issueId = newId();
    const photoId = newId();
    const now = new Date().toISOString();
    const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#2a7ab0' } }).jpeg().toBuffer();
    const pkg = {
      packageId: newId(),
      poolId,
      createdAt: now,
      issues: [{ _id: issueId, poolId, title: 'Cracked tile', photoIds: [photoId], createdAt: now, updatedAt: now }],
      photos: [{ _id: photoId, poolId, issueId, savedToPool: false, width: 1200, height: 800, bytes: jpeg.length, takenAt: now, createdAt: now, updatedAt: now }],
    };
    const boundary = '----t' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="package"\r\n\r\n${JSON.stringify(pkg)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${photoId}"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      jpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/sync/package',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(200);

    // Thumbnail written next to the image, ≤ 400 px
    const thumb = await ctx.app.inject({ method: 'GET', url: `/api/photos/${photoId}/thumb`, headers: { cookie } });
    expect(thumb.statusCode).toBe(200);
    const meta = await sharp(thumb.rawPayload).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(400);
    const files = await fs.readdir(path.join(ctx.photoDir, new Date().getUTCFullYear().toString(), String(new Date().getUTCMonth() + 1).padStart(2, '0')));
    expect(files.some((f) => f.endsWith('.thumb.jpg'))).toBe(true);

    // Listed for the issue, not yet in the pool gallery
    const forIssue = await ctx.app.inject({ method: 'GET', url: `/api/photos?issueId=${issueId}`, headers: { cookie } });
    expect(forIssue.json()).toHaveLength(1);
    expect(forIssue.json()[0].file).toBeUndefined();
    let gallery = await ctx.app.inject({ method: 'GET', url: `/api/photos?poolId=${poolId}&savedToPool=true`, headers: { cookie } });
    expect(gallery.json()).toHaveLength(0);

    // Save to pool → appears in the gallery; the change is logged
    const patched = await ctx.app.inject({ method: 'PATCH', url: `/api/photos/${photoId}`, headers: { cookie }, payload: { savedToPool: true } });
    expect(patched.json().savedToPool).toBe(true);
    gallery = await ctx.app.inject({ method: 'GET', url: `/api/photos?poolId=${poolId}&savedToPool=true`, headers: { cookie } });
    expect(gallery.json().map((p: { _id: string }) => p._id)).toEqual([photoId]);
    expect(await AuditLog.countDocuments({ collectionName: 'photos', docId: photoId, action: 'update' })).toBe(1);

    // Delete hides it
    await ctx.app.inject({ method: 'DELETE', url: `/api/photos/${photoId}`, headers: { cookie } });
    gallery = await ctx.app.inject({ method: 'GET', url: `/api/photos?poolId=${poolId}&savedToPool=true`, headers: { cookie } });
    expect(gallery.json()).toHaveLength(0);
  });
});
