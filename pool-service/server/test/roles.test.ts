import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUSINESS_SETTINGS_ID } from '@pool/shared';
import { AuditLog, Chemical, Customer, Invoice, Ledger, Note, Pool, SessionDoc, Settings, User, Visit } from '../src/models/index.js';
import { verifyLogin } from '../src/services/users.js';
import { newId } from '../src/util.js';
import { login, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers.js';

let ctx: TestContext;
let owner: string;
beforeAll(async () => {
  ctx = await setupTestApp({ loginRateLimit: { max: 1000, timeWindow: '15 minutes' } });
  owner = await login(ctx.app);
});
afterAll(async () => {
  await ctx.close();
});

const req = (cookie: string, method: string, url: string, payload?: object) =>
  ctx.app.inject({ method: method as 'GET', url: `/api${url}`, headers: { cookie }, ...(payload && { payload }) });
const at = (min = 0) => new Date(Date.now() + min * 60_000).toISOString();

describe('accounts', () => {
  it('today’s password became the first owner; a session from before accounts belongs to that owner', async () => {
    const me = (await req(owner, 'GET', '/auth/me')).json();
    expect(me.me).toMatchObject({ email: 'owner', role: 'owner', name: 'Owner' });
    await SessionDoc.updateMany({}, { $unset: { 'session.userId': 1 } });
    const again = await req(owner, 'GET', '/auth/me');
    expect(again.statusCode).toBe(200);
    expect(again.json().me.role).toBe('owner');
  });

  it('wrong email or password: the same answer', async () => {
    for (const payload of [{ email: 'nobody@example.com', password: TEST_PASSWORD }, { email: 'owner', password: 'wrong-password' }]) {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe('Wrong email or password');
    }
  });

  it('locks a login for 15 minutes after 10 wrong passwords', async () => {
    const id = newId();
    const now = new Date();
    await User.create({ _id: id, email: 'lock@example.com', name: 'Lock', role: 'tech', passwordHash: (await User.findOne({ email: 'owner' }).lean<any>()).passwordHash, createdAt: now, updatedAt: now });
    for (let i = 0; i < 10; i++) expect(await verifyLogin('lock@example.com', 'nope')).toEqual({ error: 'wrong' });
    expect(await verifyLogin('lock@example.com', TEST_PASSWORD)).toEqual({ error: 'locked' });
  });
});

describe('team, tech logins, devices', () => {
  let techId: string;
  let tech: string;
  it('the owner adds a tech; the temporary password works once and asks for a new one', async () => {
    const res = await req(owner, 'POST', '/team', { email: 'Tom@Example.com', name: 'Tom Tech' });
    expect(res.statusCode).toBe(201);
    const { member, password } = res.json();
    techId = member._id;
    expect(member).toMatchObject({ email: 'tom@example.com', role: 'tech', active: true, mustChangePassword: true });
    expect(password).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await req(owner, 'POST', '/team', { email: 'tom@example.com', name: 'Again' })).statusCode).toBe(409);
    tech = await login(ctx.app, false, 'tom@example.com', password);
    expect((await req(tech, 'GET', '/auth/me')).json().me).toMatchObject({ role: 'tech', mustChangePassword: true });
    expect((await req(tech, 'POST', '/auth/password', { current: 'wrong', password: 'tom-new-password' })).statusCode).toBe(400);
    expect((await req(tech, 'POST', '/auth/password', { current: password, password: 'tom-new-password' })).statusCode).toBe(200);
    expect((await req(tech, 'GET', '/auth/me')).json().me.mustChangePassword).toBe(false);
  });

  it('devices: list, sign out the others; a password change signs out the others too', async () => {
    const second = await login(ctx.app, true, 'tom@example.com', 'tom-new-password');
    const list = (await req(tech, 'GET', '/auth/devices')).json();
    expect(list).toHaveLength(2);
    expect(list.filter((d: any) => d.current)).toHaveLength(1);
    expect((await req(tech, 'DELETE', '/auth/devices/others')).json().signedOut).toBe(1);
    expect((await req(second, 'GET', '/auth/me')).statusCode).toBe(401);
    const third = await login(ctx.app, false, 'tom@example.com', 'tom-new-password');
    await req(tech, 'POST', '/auth/password', { current: 'tom-new-password', password: 'tom-password-3' });
    expect((await req(third, 'GET', '/auth/me')).statusCode).toBe(401);
    expect((await req(tech, 'GET', '/auth/me')).statusCode).toBe(200);
  });

  it('there is always an active owner', async () => {
    const ownerId = (await User.findOne({ email: 'owner' }).lean<any>())._id;
    expect((await req(owner, 'PATCH', `/team/${ownerId}`, { role: 'tech' })).statusCode).toBe(409);
    expect((await req(owner, 'PATCH', `/team/${ownerId}`, { active: false })).statusCode).toBe(409);
  });

  // ---------------------------------------------------------------- what a tech sees
  const ids = { a: newId(), b: newId(), a1: newId(), b1: newId(), visitA: newId(), visitB: newId(), chem: '' };
  let pulledAt = '';
  it('setup: customer A (pool on Tom’s route) and B (nobody’s), with money everywhere', async () => {
    const chem = await Chemical.findOne().lean<any>();
    ids.chem = chem._id;
    await Chemical.updateOne({ _id: chem._id }, { $set: { price: 4, priceUnit: chem.defaultUnit } });
    for (const [id, name] of [[ids.a, 'Alice A'], [ids.b, 'Bob B']] as const) {
      expect((await req(owner, 'POST', '/customers', { _id: id, name, monthlyRate: 150, billingEmail: 'bill@example.com', paymentMethod: 'check', distanceMiles: 9 })).statusCode).toBe(201);
    }
    expect((await req(owner, 'POST', '/pools', { _id: ids.a1, customerId: ids.a, name: 'A pool', serviceDay: 'mon', techId })).statusCode).toBe(201);
    expect((await req(owner, 'POST', '/pools', { _id: ids.b1, customerId: ids.b, name: 'B pool', serviceDay: 'mon' })).statusCode).toBe(201);
    const now = new Date();
    for (const [vid, pid] of [[ids.visitA, ids.a1], [ids.visitB, ids.b1]]) {
      await Visit.create({ _id: vid, poolId: pid, visitedAt: now, doses: [{ chemicalId: ids.chem, amount: 2, unit: chem.defaultUnit, cost: 8 }], createdAt: now, updatedAt: now, syncedAt: now });
    }
    await Note.create({ _id: newId(), parentType: 'customer', parentId: ids.a, body: 'A note', createdAt: now, updatedAt: now, syncedAt: now });
    await Note.create({ _id: newId(), parentType: 'customer', parentId: ids.b, body: 'B note', createdAt: now, updatedAt: now, syncedAt: now });
    await Note.create({ _id: newId(), parentType: 'visit', parentId: ids.visitA, body: 'A visit note', createdAt: now, updatedAt: now, syncedAt: now });
    await Invoice.create({ _id: newId(), customerId: ids.a, number: 1001, period: '2026-11', issueDate: now, lines: [], payments: [], status: 'draft', createdAt: now, updatedAt: now, syncedAt: now });
    await Ledger.create({ _id: newId(), kind: 'expense', date: '2026-11-20', amount: 20, createdAt: now, updatedAt: now, syncedAt: now });
    await Settings.updateOne({ _id: BUSINESS_SETTINGS_ID }, { $set: { businessName: 'Biz', phone: '555', mileageRate: 0.7, paymentInstructions: 'Zelle me', createdAt: now, updatedAt: now, syncedAt: now } }, { upsert: true });
  });

  it('a tech’s pull: their route only, no money', async () => {
    const res = await req(tech, 'GET', '/sync/pull');
    const p = res.json();
    pulledAt = p.serverTime;
    expect(p.full).toBe(true);
    expect(p.customers.map((c: any) => c.name)).toEqual(['Alice A']);
    for (const k of ['monthlyRate', 'billingEmail', 'paymentMethod', 'distanceMiles']) expect(p.customers[0]).not.toHaveProperty(k);
    expect(p.pools.map((x: any) => x.name)).toEqual(['A pool']);
    expect(p.visits.map((v: any) => v._id)).toEqual([ids.visitA]);
    expect(p.visits[0].doses[0]).not.toHaveProperty('cost');
    expect(p.notes.map((n: any) => n.body).sort()).toEqual(['A note', 'A visit note']);
    expect(p.invoices).toEqual([]);
    expect(p.ledger).toEqual([]);
    expect(p.chemicals.length).toBeGreaterThan(0);
    for (const c of p.chemicals) expect(c).not.toHaveProperty('price');
    expect(p.settings).toHaveLength(1);
    expect(p.settings[0]).toMatchObject({ businessName: 'Biz', phone: '555' });
    expect(p.settings[0]).not.toHaveProperty('mileageRate');
    expect(p.settings[0]).not.toHaveProperty('paymentInstructions');
    expect(p.team.map((m: any) => m.name).sort()).toEqual(['Lock', 'Owner', 'Tom Tech']);
    // The owner still gets everything.
    const o = (await req(owner, 'GET', '/sync/pull')).json();
    expect(o.customers.length).toBe(2);
    expect(o.customers[0].monthlyRate).toBe(150);
    expect(o.invoices.length).toBe(1);
  });

  it('a tech’s API: their records only, owner-only screens refused', async () => {
    expect((await req(tech, 'GET', '/customers')).json().map((c: any) => c.name)).toEqual(['Alice A']);
    expect((await req(tech, 'GET', '/customers')).json()[0]).not.toHaveProperty('monthlyRate');
    expect((await req(tech, 'GET', `/customers/${ids.b}`)).statusCode).toBe(404);
    expect((await req(tech, 'GET', `/pools/${ids.b1}/visits`)).statusCode).toBe(404);
    expect((await req(tech, 'GET', `/visits/${ids.visitB}`)).statusCode).toBe(404);
    expect((await req(tech, 'GET', `/visits/${ids.visitA}`)).json().doses[0]).not.toHaveProperty('cost');
    for (const url of ['/invoices', '/ledger', '/settings', '/reports/visits', '/export/everything.xlsx', '/imports', '/team', '/audit', '/system/status']) {
      expect((await req(tech, 'GET', url)).statusCode, url).toBe(403);
    }
    expect((await req(tech, 'POST', '/chemicals', { name: 'X', defaultUnit: 'lb' })).statusCode).toBe(403);
    expect((await req(tech, 'DELETE', `/customers/${ids.a}`)).statusCode).toBe(403);
    expect((await req(tech, 'DELETE', `/pools/${ids.a1}`)).statusCode).toBe(403);
  });

  it('a tech edits customers without touching money, and adds pools to their own route', async () => {
    const r = await req(tech, 'PATCH', `/customers/${ids.a}`, { name: 'Alice Adams', monthlyRate: 1 });
    expect(r.statusCode).toBe(200);
    expect(await Customer.findById(ids.a).lean()).toMatchObject({ name: 'Alice Adams', monthlyRate: 150 });
    expect((await req(tech, 'PATCH', `/customers/${ids.b}`, { name: 'x' })).statusCode).toBe(404);
    expect((await req(tech, 'PATCH', `/pools/${ids.a1}`, { techId: null, name: 'A main' })).statusCode).toBe(200);
    expect(await Pool.findById(ids.a1).lean()).toMatchObject({ techId, name: 'A main' });
    expect((await req(tech, 'POST', '/pools', { customerId: ids.b, name: 'Sneaky' })).statusCode).toBe(404);
    const np = await req(tech, 'POST', '/pools', { customerId: ids.a, name: 'Spa' });
    expect(np.json().techId).toBe(techId);
    const nc = await req(tech, 'POST', '/customers', { name: 'New by Tom', monthlyRate: 99 });
    expect(nc.statusCode).toBe(201);
    expect(await Customer.findById(nc.json()._id).lean()).toMatchObject({ createdBy: techId });
    expect((await Customer.findById(nc.json()._id).lean<any>()).monthlyRate).toBeUndefined();
    expect((await req(tech, 'GET', '/customers')).json().map((c: any) => c.name).sort()).toEqual(['Alice Adams', 'New by Tom']);
    const audit = await AuditLog.findOne({ docId: ids.a, action: 'update' }).sort({ at: -1 }).lean<any>();
    expect(audit.userId).toBe(techId);
  });

  it('a tech’s package: their pool only, priced on the server, no money records, no deletes', async () => {
    const chem = await Chemical.findById(ids.chem).lean<any>();
    const visit = { _id: newId(), poolId: ids.a1, visitedAt: at(), doses: [{ chemicalId: ids.chem, amount: 3, unit: chem.defaultUnit }], createdAt: at(), updatedAt: at() };
    const ok = await req(tech, 'POST', '/sync/package', { packageId: newId(), poolId: ids.a1, createdAt: at(), visit });
    expect(ok.statusCode).toBe(200);
    expect((await Visit.findById(visit._id).lean<any>()).doses[0].cost).toBe(12);
    const other = await req(tech, 'POST', '/sync/package', { packageId: newId(), poolId: ids.b1, createdAt: at(), visit: { ...visit, _id: newId(), poolId: ids.b1 } });
    expect(other.statusCode).toBe(404);
    const money = await req(tech, 'POST', '/sync/package', { packageId: newId(), createdAt: at(), ledger: [{ _id: newId(), kind: 'expense', date: '2026-11-20', amount: 5, createdAt: at(), updatedAt: at() }] });
    expect(money.statusCode).toBe(403);
    const a = await Customer.findById(ids.a).lean<any>();
    const edit = { _id: ids.a, name: 'Alice Offline', phones: [], createdAt: a.createdAt, updatedAt: at(1) };
    expect((await req(tech, 'POST', '/sync/package', { packageId: newId(), createdAt: at(), customers: [edit] })).statusCode).toBe(200);
    expect(await Customer.findById(ids.a).lean()).toMatchObject({ name: 'Alice Offline', monthlyRate: 150, billingEmail: 'bill@example.com' });
    const pool = await Pool.findById(ids.a1).lean<any>();
    const del = { ...pool, deletedAt: at(), updatedAt: at(2) };
    delete del.syncedAt;
    expect((await req(tech, 'POST', '/sync/package', { packageId: newId(), createdAt: at(), pools: [del] })).statusCode).toBe(403);
  });

  it('moving a pool off a tech’s route: their next pull is a full one without it', async () => {
    expect((await req(owner, 'POST', '/pools/assign', { poolIds: [ids.a1], techId: null })).json().moved).toBe(1);
    const p = (await req(tech, 'GET', `/sync/pull?since=${encodeURIComponent(pulledAt)}`)).json();
    expect(p.full).toBe(true);
    expect(p.pools.map((x: any) => x.name)).toEqual(['Spa']); // the pool Tom added stays his
    expect(p.visits).toEqual([]);
    const later = (await req(tech, 'GET', `/sync/pull?since=${encodeURIComponent(p.serverTime)}`)).json();
    expect(later.full).toBe(false);
    // The owner moves it back by editing the pool: same effect.
    await req(owner, 'PATCH', `/pools/${ids.a1}`, { techId });
    const back = (await req(tech, 'GET', `/sync/pull?since=${encodeURIComponent(later.serverTime)}`)).json();
    expect(back.full).toBe(true);
    expect(back.pools.map((x: any) => x.name).sort()).toEqual(['A main', 'Spa']);
  });

  it('a tech’s Reset week clears only their route', async () => {
    await Pool.updateMany({}, { $set: { 'week.done': true } });
    expect((await req(tech, 'POST', '/route/reset-week')).json().pools).toBe(2);
    expect((await Pool.findById(ids.b1).lean<any>()).week.done).toBe(true);
  });

  it('turning a login off signs it out everywhere; a reset gives a new temporary password', async () => {
    expect((await req(owner, 'PATCH', `/team/${techId}`, { active: false })).statusCode).toBe(200);
    expect((await req(tech, 'GET', '/auth/me')).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'tom@example.com', password: 'tom-password-3' } })).statusCode).toBe(401);
    await req(owner, 'PATCH', `/team/${techId}`, { active: true });
    const { password } = (await req(owner, 'POST', `/team/${techId}/reset-password`)).json();
    const again = await login(ctx.app, false, 'tom@example.com', password);
    expect((await req(again, 'GET', '/auth/me')).json().me.mustChangePassword).toBe(true);
    const team = (await req(owner, 'GET', '/team')).json();
    expect(team.find((m: any) => m._id === techId).activeMonths).toContain(new Date().toISOString().slice(0, 7));
  });
});
