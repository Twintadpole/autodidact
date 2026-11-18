import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Customer, Photo, Pool } from '../src/models/index.js';
import { newId } from '../src/util.js';
import { login, setupTestApp, type TestContext } from './helpers.js';

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
const later = (() => {
  let t = Date.now();
  return () => iso(new Date((t += 1000)));
})();
const pkg = (extra: Record<string, unknown>) => ({ packageId: newId(), createdAt: iso(new Date()), ...extra });

describe('7A: only the name is required', () => {
  it('saves a prospect with just a name (no address, phones or anything else)', async () => {
    const at = later();
    const c = { _id: newId(), name: 'Prospect Pat', status: 'prospect', createdAt: at, updatedAt: at };
    const res = await post(pkg({ customers: [c] }));
    expect(res.statusCode).toBe(200);
    const saved = await Customer.findById(c._id).lean<Record<string, unknown>>();
    expect(saved).toMatchObject({ name: 'Prospect Pat', status: 'prospect' });
    expect(saved?.address).toBeUndefined();
  });

  it('still refuses a customer without a name', async () => {
    const at = later();
    const res = await post(pkg({ customers: [{ _id: newId(), name: '', createdAt: at, updatedAt: at }] }));
    expect(res.statusCode).toBe(400);
  });

  it('saves a pool without type, gallons or service day, and a partial address', async () => {
    const at = later();
    const c = { _id: newId(), name: 'Partial Address', address: { city: 'Dallas' }, createdAt: at, updatedAt: at };
    const p = { _id: newId(), customerId: c._id, name: 'Pool', createdAt: at, updatedAt: at };
    const res = await post(pkg({ customers: [c], pools: [p] }));
    expect(res.statusCode).toBe(200);
    const saved = await Pool.findById(p._id).lean<Record<string, unknown>>();
    expect(saved?.serviceDay).toBeUndefined();
    expect(saved?.type).toBeUndefined();
    expect((await Customer.findById(c._id).lean<Record<string, any>>())?.address).toEqual({ city: 'Dallas' });
  });

  it('accepts the REST API too (name only)', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/customers', headers: { cookie }, payload: { name: 'Rest Only' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Rest Only' });
  });
});

describe('7A: new fields survive an older app, and clear when the app says so', () => {
  it('customer class and billing fields', async () => {
    let at = later();
    const base = { _id: newId(), name: 'Billing Bea', phones: [], createdAt: at };
    const full = { ...base, updatedAt: at, status: 'current', monthlyRate: 150, billingEmail: 'bea@example.com', paymentMethod: 'check', startDate: '2026-11-01T00:00:00.000Z', distanceMiles: 7.5 };
    expect((await post(pkg({ customers: [full] }))).statusCode).toBe(200);

    // An older app edits the name and doesn't know the new fields: they are kept.
    at = later();
    expect((await post(pkg({ customers: [{ ...base, name: 'Billing Bea R.', updatedAt: at }] }))).statusCode).toBe(200);
    let saved = await Customer.findById(base._id).lean<Record<string, any>>();
    expect(saved).toMatchObject({ name: 'Billing Bea R.', status: 'current', monthlyRate: 150, billingEmail: 'bea@example.com', paymentMethod: 'check', distanceMiles: 7.5 });

    // The new app clears two of them (null) and makes the customer past.
    at = later();
    const cleared = { ...base, name: 'Billing Bea R.', updatedAt: at, status: 'past', monthlyRate: null, billingEmail: null, paymentMethod: 'check', startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z', distanceMiles: 7.5 };
    expect((await post(pkg({ customers: [cleared] }))).statusCode).toBe(200);
    saved = await Customer.findById(base._id).lean<Record<string, any>>();
    expect(saved).toMatchObject({ status: 'past', monthlyRate: null, billingEmail: null });
    expect(saved?.endDate).toEqual(new Date('2026-12-31T00:00:00.000Z'));
  });

  it('refuses an unknown class or payment method', async () => {
    const at = later();
    const res = await post(pkg({ customers: [{ _id: newId(), name: 'Odd', status: 'vip', createdAt: at, updatedAt: at }] }));
    expect(res.statusCode).toBe(400);
  });

  it('pool equipment, and equipment photos', async () => {
    let at = later();
    const c = { _id: newId(), name: 'Equip Eve', createdAt: at, updatedAt: at };
    const pumpId = newId();
    const p = {
      _id: newId(),
      customerId: c._id,
      name: 'Pool',
      createdAt: at,
      updatedAt: at,
      equipment: [
        { _id: pumpId, kind: 'pump', model: 'Pentair SuperFlo VS', serial: 'SF123', installedOn: '2024-05-01T00:00:00.000Z', notes: 'Loud bearing' },
        { _id: newId(), kind: 'other', name: 'Booster pump' },
      ],
    };
    expect((await post(pkg({ customers: [c], pools: [p] }))).statusCode).toBe(200);

    // An older app edits the pool without the equipment list: it is kept.
    at = later();
    const { equipment: _unused, ...withoutEquipment } = p;
    expect((await post(pkg({ pools: [{ ...withoutEquipment, name: 'Backyard', updatedAt: at }] }))).statusCode).toBe(200);
    let saved = await Pool.findById(p._id).lean<Record<string, any>>();
    expect(saved?.name).toBe('Backyard');
    expect(saved?.equipment).toHaveLength(2);
    expect(saved?.equipment[0]).toMatchObject({ kind: 'pump', model: 'Pentair SuperFlo VS', serial: 'SF123', notes: 'Loud bearing' });

    // Removing everything sends an empty list.
    at = later();
    expect((await post(pkg({ pools: [{ ...withoutEquipment, name: 'Backyard', updatedAt: at, equipment: [] }] }))).statusCode).toBe(200);
    saved = await Pool.findById(p._id).lean<Record<string, any>>();
    expect(saved?.equipment).toEqual([]);

    // A photo of the pump keeps its equipmentId.
    at = later();
    const photoId = newId();
    const form = new FormData();
    form.append('package', JSON.stringify(pkg({ poolId: p._id, photos: [{ _id: photoId, poolId: p._id, equipmentId: pumpId, width: 1, height: 1, bytes: 3, takenAt: at, createdAt: at, updatedAt: at }] })));
    form.append(photoId, new Blob([Buffer.from('/9j/', 'base64')], { type: 'image/jpeg' }), `${photoId}.jpg`);
    const req = new Request('http://x/api/sync/package', { method: 'POST', body: form });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/sync/package',
      headers: { cookie, 'content-type': req.headers.get('content-type')! },
      payload: Buffer.from(await req.arrayBuffer()),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await Photo.findById(photoId).lean<Record<string, any>>())?.equipmentId).toBe(pumpId);
  });
});

describe('7B: one-time service date', () => {
  it('is saved, kept when an older app leaves it out, and cleared with null', async () => {
    let at = later();
    const c = { _id: newId(), name: 'Once Only', createdAt: at, updatedAt: at };
    const base = { _id: newId(), customerId: c._id, name: 'Pool', createdAt: at };
    expect((await post(pkg({ customers: [c], pools: [{ ...base, updatedAt: at, oneTimeDate: '2026-11-20' }] }))).statusCode).toBe(200);
    expect((await Pool.findById(base._id).lean<Record<string, any>>())?.oneTimeDate).toEqual(new Date('2026-11-20T00:00:00.000Z'));

    at = later();
    expect((await post(pkg({ pools: [{ ...base, name: 'Spa', updatedAt: at }] }))).statusCode).toBe(200);
    expect((await Pool.findById(base._id).lean<Record<string, any>>())?.oneTimeDate).toEqual(new Date('2026-11-20T00:00:00.000Z'));

    at = later();
    expect((await post(pkg({ pools: [{ ...base, name: 'Spa', updatedAt: at, oneTimeDate: null, serviceDay: 'wed' }] }))).statusCode).toBe(200);
    expect(await Pool.findById(base._id).lean<Record<string, any>>()).toMatchObject({ oneTimeDate: null, serviceDay: 'wed' });
  });
});

describe('7B: settings, invoices, prices', () => {
  it('business settings and an invoice with a payment sync up and come back down', async () => {
    const at = later();
    const s = { _id: '00000000-0000-4000-8000-000000000001', businessName: 'Evolution Home Solutions', terms: 'net15', firstInvoiceNumber: 1001, createdAt: at, updatedAt: at };
    const c = { _id: newId(), name: 'Invoice Ivy', createdAt: at, updatedAt: at };
    const inv = {
      _id: newId(),
      customerId: c._id,
      number: 1001,
      period: '2026-11',
      issueDate: '2026-11-01',
      dueDate: '2026-11-16',
      lines: [{ _id: newId(), description: 'Monthly pool service · November 2026', amount: 150 }],
      status: 'sent',
      sentAt: at,
      payments: [{ _id: newId(), date: '2026-11-05', amount: 100, method: 'check', reference: '#2231' }],
      createdAt: at,
      updatedAt: at,
    };
    const res = await post(pkg({ customers: [c], settings: [s], invoices: [inv] }));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().applied).toMatchObject({ settings: 1, invoices: 1 });
    const pull = (await ctx.app.inject({ method: 'GET', url: '/api/sync/pull', headers: { cookie } })).json();
    expect(pull.settings.find((x: any) => x._id === s._id)).toMatchObject({ businessName: 'Evolution Home Solutions', terms: 'net15' });
    expect(pull.invoices.find((x: any) => x._id === inv._id)).toMatchObject({ number: 1001, payments: [{ amount: 100, method: 'check', reference: '#2231' }] });
  });

  it('a chemical price and visit recap fields survive an older app', async () => {
    let at = later();
    const chem = { _id: newId(), name: 'Liquid chlorine 7B', defaultUnit: 'gal', active: true, price: 4.5, priceUnit: 'gal', createdAt: at, updatedAt: at };
    expect((await post(pkg({ chemicals: [chem] }))).statusCode).toBe(200);
    at = later();
    const { price: _p, priceUnit: _u, ...oldChem } = chem;
    expect((await post(pkg({ chemicals: [{ ...oldChem, name: 'Liquid chlorine 12.5%', updatedAt: at }] }))).statusCode).toBe(200);
    const pull = (await ctx.app.inject({ method: 'GET', url: '/api/sync/pull', headers: { cookie } })).json();
    expect(pull.chemicals.find((x: any) => x._id === chem._id)).toMatchObject({ name: 'Liquid chlorine 12.5%', price: 4.5, priceUnit: 'gal' });
  });
});
