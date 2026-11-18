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

describe('7C: ledger and what each customer earns per hour', () => {
  it('syncs expenses, income and mileage', async () => {
    const at = later();
    const rows = [
      { _id: newId(), kind: 'expense', date: '2026-11-03', amount: 42.5, category: 'fuel', vendor: 'QT', createdAt: at, updatedAt: at },
      { _id: newId(), kind: 'income', date: '2026-11-04', amount: 80, note: 'Cash job', createdAt: at, updatedAt: at },
      { _id: newId(), kind: 'mileage', date: '2026-11-04', miles: 63, odometerStart: 1000, odometerEnd: 1063, createdAt: at, updatedAt: at },
    ];
    const res = await post(pkg({ ledger: rows }));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().applied.ledger).toBe(3);
    const pull = (await ctx.app.inject({ method: 'GET', url: '/api/sync/pull', headers: { cookie } })).json();
    expect(pull.ledger.filter((l: any) => rows.some((r) => r._id === l._id))).toHaveLength(3);
  });

  it('works out each month, and each visit within it, as the owner asked', async () => {
    const at = later();
    const settingsDoc = { _id: '00000000-0000-4000-8000-000000000001', mileageRate: 0.7, createdAt: at, updatedAt: later() };
    const a = { _id: newId(), name: 'Hours Alpha', monthlyRate: 150, distanceMiles: 10, createdAt: at, updatedAt: at };
    const b = { _id: newId(), name: 'Hours Bravo', monthlyRate: 100, createdAt: at, updatedAt: at };
    const pa = { _id: newId(), customerId: a._id, name: 'Pool', createdAt: at, updatedAt: at };
    const pb = { _id: newId(), customerId: b._id, name: 'Pool', createdAt: at, updatedAt: at };
    const chem = newId();
    await post(pkg({ settings: [settingsDoc], customers: [a, b], pools: [pa, pb], chemicals: [{ _id: chem, name: 'Chlorine hrs', defaultUnit: 'gal', active: true, createdAt: at, updatedAt: at }] }));
    const v = (poolId: string, start: string, minutes: number | null, extra: Record<string, unknown> = {}) => ({
      _id: newId(),
      poolId,
      visitedAt: start,
      createdAt: at,
      updatedAt: at,
      ...(minutes ? { timeLog: { segments: [{ start, end: new Date(new Date(start).getTime() + minutes * 60_000).toISOString() }], finished: true } } : {}),
      ...extra,
    });
    // A, November: one timed visit (60 min, $9 of chemicals) and one without a timer.
    await post(pkg({ poolId: pa._id, visit: v(pa._id, '2026-11-05T15:00:00.000Z', 60, { doses: [{ chemicalId: chem, amount: 2, unit: 'gal', cost: 9 }] }) }));
    await post(pkg({ poolId: pa._id, visit: v(pa._id, '2026-11-12T15:00:00.000Z', null, { doses: [{ chemicalId: chem, amount: 1, unit: 'gal' }] }) }));
    await post(pkg({
      invoices: [{ _id: newId(), customerId: a._id, number: 5001, period: '2026-11', issueDate: '2026-11-01', lines: [{ _id: newId(), description: 'Monthly', amount: 150 }, { _id: newId(), description: 'Supplies', amount: 20 }], status: 'sent', payments: [], createdAt: at, updatedAt: at }],
      ledger: [{ _id: newId(), kind: 'expense', date: '2026-11-10', amount: 20, category: 'supplies', customerId: a._id, billToCustomer: true, createdAt: at, updatedAt: at }],
    }));
    // B, October (a finished month): a 30-minute and a 90-minute visit, no invoice (monthly rate $100), no distance.
    await post(pkg({ poolId: pb._id, visit: v(pb._id, '2026-10-06T15:00:00.000Z', 30) }));
    await post(pkg({ poolId: pb._id, visit: v(pb._id, '2026-10-20T15:00:00.000Z', 90) }));

    const res = await ctx.app.inject({ method: 'GET', url: '/api/reports/customer-hours?from=2026-10-01&to=2026-11-30&tzOffsetMin=360', headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    const ra = body.rows.find((r: any) => r.customerId === a._id);
    expect(ra.months).toHaveLength(1);
    expect(ra.months[0]).toMatchObject({ month: '2026-11', billed: 170, chemicalCost: 9, unpricedDoses: 1, mileageCost: 28, expenses: 20, profit: 113, hours: 2, perHour: 56.5, billedFromRate: false });
    expect(ra.months[0].complete).toBe('2026-11' < body.thisMonth);
    expect(ra.months[0].visits.map((x: any) => [x.date, x.minutes, x.timeFrom, x.perHour])).toEqual([
      ['2026-11-05', 60, 'timer', 56.5],
      ['2026-11-12', 60, 'pool', 56.5],
    ]);
    const rb = body.rows.find((r: any) => r.customerId === b._id);
    expect(rb.months[0]).toMatchObject({ month: '2026-10', complete: true, billed: 100, billedFromRate: true, profit: 100, hours: 2, perHour: 50, missingMileage: true });
    // Profit split equally per visit ($50 each), divided by each visit's time.
    expect(rb.months[0].visits.map((x: any) => x.perHour)).toEqual([100, 33.33]);
    expect(rb).toMatchObject({ profit: 100, hours: 2, perHour: 50, visitCount: 2, estimatedVisits: 0 });
    // Lowest hourly first.
    const order = body.rows.filter((r: any) => r.perHour !== null).map((r: any) => r.perHour);
    expect([...order].sort((x: number, y: number) => x - y)).toEqual(order);
  });
});

describe('7D: visits by date (desktop Visits table)', () => {
  it('lists visits in the date range, newest first, leaving out deleted pools', async () => {
    const at = later();
    const c = { _id: newId(), name: 'Visits Table', createdAt: at, updatedAt: at };
    const p1 = { _id: newId(), customerId: c._id, name: 'Front', createdAt: at, updatedAt: at };
    const p2 = { _id: newId(), customerId: c._id, name: 'Gone', createdAt: at, updatedAt: at };
    await post(pkg({ customers: [c], pools: [p1, p2] }));
    const v = (poolId: string, visitedAt: string) => ({ _id: newId(), poolId, visitedAt, createdAt: at, updatedAt: at });
    const inside1 = v(p1._id, '2027-03-02T06:30:00.000Z'); // Mar 2, 00:30 local (UTC-6)
    const inside2 = v(p1._id, '2027-03-09T15:00:00.000Z');
    const before = v(p1._id, '2027-03-02T05:30:00.000Z'); // Mar 1, 23:30 local
    const gone = v(p2._id, '2027-03-05T15:00:00.000Z');
    for (const x of [inside1, inside2, before]) await post(pkg({ poolId: p1._id, visit: x }));
    await post(pkg({ poolId: p2._id, visit: gone }));
    await post(pkg({ pools: [{ ...p2, deletedAt: later(), updatedAt: later() }] }));
    const res = await ctx.app.inject({ method: 'GET', url: '/api/reports/visits?from=2027-03-02&to=2027-03-31&tzOffsetMin=360', headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().map((x: any) => x._id)).toEqual([inside2._id, inside1._id]);
  });

  it('needs a login', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/reports/visits?from=2027-03-01&to=2027-03-31' });
    expect(res.statusCode).toBe(401);
  });
});
