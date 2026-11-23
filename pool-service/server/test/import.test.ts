import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guessMapping, type ImportFieldKey } from '@pool/shared';
import { AuditLog, Customer, Pool, Visit } from '../src/models/index.js';
import { cleanAddress, cleanDate, cleanDay, cleanNumber, cleanPayment, cleanPhones, cleanStatus } from '../src/services/importClean.js';
import { parseCsv } from '../src/services/importRead.js';
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

/** multipart/form-data body with the file and (optionally) the options JSON. */
function form(fileName: string, data: Buffer | string, options?: object) {
  const boundary = `----import${newId()}`;
  const parts: Buffer[] = [];
  if (options) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify(options)}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const call = (url: string, fileName: string, data: Buffer | string, options?: object) => ctx.app.inject({ method: 'POST', url, ...form(fileName, data, options) });
const read = (f: string, d: Buffer | string) => call('/api/import/read', f, d);
const preview = (f: string, d: Buffer | string, o: object) => call('/api/import/preview', f, d, o);
const apply = (f: string, d: Buffer | string, o: object) => call('/api/import/apply', f, d, o);

describe('import: cleaning values', () => {
  it('reads phones, days, numbers, dates, classes, payment and addresses', () => {
    expect(cleanPhones('(214) 555-0101', 'mobile')).toEqual({ ok: [{ label: 'mobile', number: '+12145550101' }], bad: [] });
    expect(cleanPhones('home: 214.555.0102; work: 1-972-555-0103 x12', 'mobile')!.ok.map((p) => `${p.label} ${p.number}`)).toEqual(['home +12145550102', 'work +19725550103']);
    expect(cleanPhones('555-0101', 'mobile')).toEqual({ ok: [], bad: ['555-0101'] });
    expect(cleanPhones(2145550104, 'cell')!.ok[0]!.number).toBe('+12145550104');
    expect(['Monday', 'mon', 'M', 'every Tuesday', 'Th', 'R', 'sat'].map((d) => (cleanDay(d) as { ok: string }).ok)).toEqual(['mon', 'mon', 'mon', 'tue', 'thu', 'thu', 'sat']);
    expect(cleanDay('Mon/Thu')).toEqual({ ok: 'mon', extra: true });
    expect(cleanDay('whenever')).toEqual({ bad: 'whenever' });
    expect(cleanNumber('$1,200.50')).toEqual({ ok: 1200.5 });
    expect(cleanNumber('15,000 gal')).toEqual({ ok: 15000 });
    expect(cleanNumber('15k')).toEqual({ ok: 15000 });
    expect(cleanNumber('about 15', { positive: true })).toEqual({ bad: 'about 15' });
    expect(cleanNumber('', {})).toBeUndefined();
    expect((cleanDate('3/4/2025') as { ok: Date }).ok.toISOString()).toBe('2025-03-04T00:00:00.000Z');
    expect((cleanDate('2025-03-04') as { ok: Date }).ok.toISOString()).toBe('2025-03-04T00:00:00.000Z');
    expect((cleanDate('Mar 4, 2025') as { ok: Date }).ok.toISOString()).toBe('2025-03-04T00:00:00.000Z');
    expect(cleanDate('2/30/2025')).toEqual({ bad: '2/30/2025' });
    expect(cleanStatus('Active')).toEqual({ ok: 'current' });
    expect(cleanStatus('Lead')).toEqual({ ok: 'prospect' });
    expect(cleanStatus('Cancelled')).toEqual({ ok: 'past' });
    expect(cleanPayment('Zelle')).toEqual({ ok: 'electronic' });
    expect(cleanPayment('Barter')).toEqual({ ok: 'other', note: 'Barter' });
    expect(cleanAddress('12 Oak St, Apt 2, Dallas, TX 75201')).toEqual({ ok: { line1: '12 Oak St', line2: 'Apt 2', city: 'Dallas', state: 'TX', zip: '75201' } });
    expect(cleanAddress('12 Oak St, Dallas TX 75201')).toEqual({ ok: { line1: '12 Oak St', city: 'Dallas', state: 'TX', zip: '75201' } });
    expect(cleanAddress('12 Oak St')).toEqual({ ok: { line1: '12 Oak St' } });
  });

  it('parses CSV with quotes, a BOM and semicolons', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('guesses columns, and sends unknown ones to notes', () => {
    expect(guessMapping(['Customer Name', 'Cell Phone', 'Home Phone', 'Street', 'Zip Code', 'Gallons', 'Route Day', 'Gate Code', 'Favorite color', ''])).toEqual([
      'customer.name', 'customer.phone', 'customer.phone', 'customer.line1', 'customer.zip', 'pool.volumeGal', 'pool.serviceDay', 'pool.accessNotes', 'customer.notes', null,
    ]);
  });
});

const CSV = [
  'Customer Name,Cell Phone,Email,Street,City,State,Zip,Pool,Gallons,Route Day,Gate Code,Rate,Pump,Favorite color',
  'Ann Able,214-555-0201,ann@example.com,1 Elm St,Dallas,TX,75201,Front,"12,000",Monday,1234,$150,Pentair SuperFlo,blue',
  'Ann Able,214-555-0201,,1 Elm St,Dallas,TX,75201,Spa,500,Monday,,,,',
  ',214-555-0202,,,,,,,,Tue,,,,',
  ',,,9 Pine Rd,Plano,TX,75024,,lots,Wed,,,,',
  ',,,,,,,,,,,,,',
  ',,,,,,,,,,,,,green',
].join('\n');

describe('import: a spreadsheet of new customers', () => {
  let mapping: (ImportFieldKey | null)[];
  it('reads the file and guesses the columns', async () => {
    const res = await read('route.csv', CSV);
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.kind).toBe('table');
    expect(r.sheets[0].rowCount).toBe(5); // the fully empty row is dropped
    mapping = r.mapping;
    expect(mapping.slice(0, 13)).toEqual(['customer.name', 'customer.phone', 'customer.email', 'customer.line1', 'customer.city', 'customer.state', 'customer.zip', 'pool.name', 'pool.volumeGal', 'pool.serviceDay', 'pool.accessNotes', 'customer.monthlyRate', 'equipment.pump']);
  });

  it('previews: rows of one customer become one customer with two pools; nameless rows use the phone, then the address', async () => {
    const res = await preview('route.csv', CSV, { mapping });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.summary).toMatchObject({ rows: 5, skippedRows: 1, customersNew: 3, customersMerged: 0, poolsNew: 4 });
    expect(p.customers.map((c: { name: string }) => c.name)).toEqual(['Ann Able', '(214) 555-0202', '9 Pine Rd, Plano, TX 75024']);
    expect(p.warnings.map((w: { message: string }) => w.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('Couldn’t read Gallons “lots”'), 'No name, phone or address: row skipped']),
    );
    expect(await Customer.countDocuments()).toBe(0); // preview writes nothing
  });

  let importId: string;
  it('imports everything in one go', async () => {
    const res = await apply('route.csv', CSV, { mapping });
    expect(res.statusCode).toBe(200);
    importId = res.json().importId;
    const ann = await Customer.findOne({ name: 'Ann Able' }).lean<any>();
    expect(ann).toMatchObject({ email: 'ann@example.com', monthlyRate: 150, address: { line1: '1 Elm St', city: 'Dallas', state: 'TX', zip: '75201' } });
    expect(ann.phones).toEqual([{ label: 'mobile', number: '+12145550201' }]);
    expect(ann.notes).toBe('Favorite color: blue');
    const pools = await Pool.find({ customerId: ann._id }).sort({ routeOrder: 1 }).lean<any[]>();
    expect(pools.map((p) => [p.name, p.volumeGal, p.serviceDay, p.routeOrder])).toEqual([['Front', 12000, 'mon', 1], ['Spa', 500, 'mon', 2]]);
    expect(pools[0].accessNotes).toBe('Gate Code: 1234');
    expect(pools[0].equipment).toMatchObject([{ kind: 'pump', model: 'Pentair SuperFlo' }]);
    const pine = await Customer.findOne({ name: '9 Pine Rd, Plano, TX 75024' }).lean<any>();
    expect(pine.notes).toBe('Gallons: lots');
    expect(await AuditLog.countDocuments({ note: { $regex: `^import ${importId}` } })).toBe(7); // 3 customers + 4 pools
    // Phones pick it up on their next pull: syncedAt is now.
    expect(ann.syncedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('the same file again: nothing to import, no doubles', async () => {
    const res = await apply('route.csv', CSV, { mapping });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Nothing to import/);
    expect(await Customer.countDocuments({ deletedAt: null })).toBe(3);
  });

  it('undo hides what it added, but keeps a pool that has a visit since', async () => {
    const pine = await Customer.findOne({ name: '9 Pine Rd, Plano, TX 75024' }).lean<any>();
    const pinePool = await Pool.findOne({ customerId: pine._id }).lean<any>();
    const now = new Date();
    await Visit.create({ _id: newId(), poolId: pinePool._id, visitedAt: now, createdAt: now, updatedAt: now, syncedAt: now });
    const res = await ctx.app.inject({ method: 'POST', url: `/api/imports/${importId}/undo`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hidden: 5, restored: 0, kept: 2 }); // Pine's pool and Pine itself are kept
    expect((await Customer.find({ deletedAt: null }).lean<any[]>()).map((c) => c.name)).toEqual(['9 Pine Rd, Plano, TX 75024']);
    const again = await ctx.app.inject({ method: 'POST', url: `/api/imports/${importId}/undo`, headers: { cookie } });
    expect(again.statusCode).toBe(409);
    const list = (await ctx.app.inject({ method: 'GET', url: '/api/imports', headers: { cookie } })).json();
    expect(list[0]).toMatchObject({ _id: importId, fileName: 'route.csv', undo: { hidden: 5, kept: 2 } });
    expect(list[0].created).toBeUndefined();
  });
});

describe('import: merging into customers already in the app', () => {
  let customerId: string;
  let poolId: string;
  const mapping: ImportFieldKey[] = ['customer.name', 'customer.phone', 'customer.email', 'customer.line1', 'customer.monthlyRate', 'pool.name', 'pool.surface', 'pool.serviceDay', 'customer.notes'];
  const csv = ['Name,Phone,Email,Street,Rate,Pool,Surface,Day,Notes', 'Bea Baker,972-555-0301,bea@example.com,5 Oak Ln,200,Backyard,Pebble,Fri,Dog in yard', 'Bea Baker,,,5 Oak Ln,,Spa,,Fri,'].join('\n');

  beforeAll(async () => {
    const c = await ctx.app.inject({ method: 'POST', url: '/api/customers', headers: { cookie }, payload: { name: 'bea baker', phones: [{ label: 'home', number: '+19725550399' }], address: { line1: '5 Oak Ln' }, monthlyRate: 180, notes: 'Pays early' } });
    customerId = c.json()._id;
    const p = await ctx.app.inject({ method: 'POST', url: '/api/pools', headers: { cookie }, payload: { customerId, name: 'Backyard', serviceDay: 'mon' } });
    poolId = p.json()._id;
  });

  it('preview: blanks filled, new phone and notes added, new pool added, differences listed as conflicts', async () => {
    const p = (await preview('bea.csv', csv, { mapping })).json();
    expect(p.summary).toMatchObject({ customersNew: 0, customersMerged: 1, poolsNew: 1, poolsMerged: 1, conflicts: 2 });
    const bea = p.customers[0];
    expect(bea).toMatchObject({ action: 'merge', matchedBy: 'name and street', name: 'bea baker' });
    expect(bea.changes.map((c: { path: string }) => c.path).sort()).toEqual(['email', 'notes', 'phones']);
    expect(bea.conflicts).toEqual([{ id: `c:${customerId}:monthlyRate`, path: 'monthlyRate', label: 'Monthly rate', from: 180, to: 200 }]);
    expect(bea.pools[0]).toMatchObject({ action: 'merge', name: 'Backyard', changes: [{ path: 'surface', to: 'Pebble' }], conflicts: [{ id: `p:${poolId}:serviceDay`, from: 'mon', to: 'fri' }] });
    expect(bea.pools[1]).toMatchObject({ action: 'new', name: 'Spa' });
  });

  let importId: string;
  it('apply keeps the stored value where they differ, unless that one is taken', async () => {
    const res = await apply('bea.csv', csv, { mapping, take: [`p:${poolId}:serviceDay`] });
    expect(res.statusCode).toBe(200);
    importId = res.json().importId;
    const c = await Customer.findById(customerId).lean<any>();
    expect(c).toMatchObject({ name: 'bea baker', email: 'bea@example.com', monthlyRate: 180, notes: 'Pays early\nDog in yard' });
    expect(c.phones.map((p: { number: string }) => p.number)).toEqual(['+19725550399', '+19725550301']);
    const pool = await Pool.findById(poolId).lean<any>();
    expect(pool).toMatchObject({ surface: 'Pebble', serviceDay: 'fri' });
    expect(await Pool.countDocuments({ customerId, deletedAt: null })).toBe(2);
    const audit = await AuditLog.findOne({ docId: customerId, note: { $regex: '^import' } }).lean<any>();
    expect(audit.changes.map((ch: { path: string }) => ch.path).sort()).toEqual(['email', 'notes', 'phones']);
  });

  it('undo puts the old values back, except a field edited since', async () => {
    await ctx.app.inject({ method: 'PATCH', url: `/api/customers/${customerId}`, headers: { cookie }, payload: { email: 'bea@new.example.com' } });
    const res = await ctx.app.inject({ method: 'POST', url: `/api/imports/${importId}/undo`, headers: { cookie } });
    expect(res.json()).toEqual({ hidden: 1, restored: 4, kept: 1 });
    const c = await Customer.findById(customerId).lean<any>();
    expect(c).toMatchObject({ email: 'bea@new.example.com', notes: 'Pays early' });
    expect(c.phones).toHaveLength(1);
    const pool = await Pool.findById(poolId).lean<any>();
    expect(pool.serviceDay).toBe('mon');
    expect(pool.surface).toBeUndefined();
  });
});

describe('import: the app’s own Export everything, into an empty app', () => {
  it('brings back customers, pools and equipment as they were', async () => {
    const now = new Date();
    const cid = newId();
    await Customer.create({ _id: cid, name: 'Cal Carter', phones: [{ label: 'mobile', number: '+14695550401' }, { label: 'work', number: '+14695550402' }], email: 'cal@example.com', address: { line1: '7 Bay Ct', line2: 'Unit 3', city: 'Frisco', state: 'TX', zip: '75034' }, status: 'prospect', monthlyRate: 175.5, paymentMethod: 'check', startDate: new Date('2025-02-01T00:00:00Z'), distanceMiles: 12.5, notes: 'Line one\nLine two', createdAt: now, updatedAt: now, syncedAt: now });
    await Pool.create({ _id: newId(), customerId: cid, name: 'Main', type: 'salt', surface: 'Plaster', volumeGal: 18000, serviceDay: 'thu', routeOrder: 4, active: false, accessNotes: 'Code 9', equipment: [{ _id: newId(), kind: 'heater', model: 'MasterTemp', serial: 'H1', installedOn: new Date('2020-05-01T00:00:00Z'), notes: 'gas' }, { _id: newId(), kind: 'other', name: 'Booster', model: 'B2' }], createdAt: now, updatedAt: now, syncedAt: now });
    const exported = await ctx.app.inject({ method: 'GET', url: '/api/export/everything.xlsx', headers: { cookie } });
    expect(exported.statusCode).toBe(200);
    // Empty the app: hide every customer and pool.
    await Customer.updateMany({}, { $set: { deletedAt: now } });
    await Pool.updateMany({}, { $set: { deletedAt: now } });

    const r = (await read('everything.xlsx', exported.rawPayload)).json();
    expect(r.kind).toBe('app');
    const res = await apply('everything.xlsx', exported.rawPayload, { mapping: [] });
    expect(res.statusCode).toBe(200);
    const c = await Customer.findOne({ name: 'Cal Carter', deletedAt: null }).lean<any>();
    expect(c).toMatchObject({ email: 'cal@example.com', address: { line1: '7 Bay Ct', line2: 'Unit 3', city: 'Frisco', state: 'TX', zip: '75034' }, status: 'prospect', monthlyRate: 175.5, paymentMethod: 'check', distanceMiles: 12.5, notes: 'Line one\nLine two' });
    expect(c.startDate.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(c.phones).toEqual([{ label: 'mobile', number: '+14695550401' }, { label: 'work', number: '+14695550402' }]);
    const p = await Pool.findOne({ customerId: c._id }).lean<any>();
    expect(p).toMatchObject({ name: 'Main', type: 'salt', surface: 'Plaster', volumeGal: 18000, serviceDay: 'thu', routeOrder: 4, active: false, accessNotes: 'Code 9' });
    // The same file again: nothing to do (stop #0 and every other field compare equal).
    await Pool.updateOne({ _id: p._id }, { $set: { routeOrder: 0 } });
    const again = await apply('everything.xlsx', (await ctx.app.inject({ method: 'GET', url: '/api/export/everything.xlsx', headers: { cookie } })).rawPayload, { mapping: [] });
    expect(again.json().message).toMatch(/Nothing to import/);
    expect(p.equipment.map((e: any) => [e.kind, e.name, e.model, e.serial, e.installedOn?.toISOString(), e.notes])).toEqual([
      ['heater', undefined, 'MasterTemp', 'H1', '2020-05-01T00:00:00.000Z', 'gas'],
      ['other', 'Booster', 'B2', undefined, undefined, undefined],
    ]);
  });
});

describe('import: Excel files and refusals', () => {
  it('reads an Excel sheet with real dates and numbers', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Clients');
    ws.addRow(['Client', 'Since', 'Volume', 'Salt or chlorine']);
    ws.addRow(['Dee Diaz', new Date(Date.UTC(2024, 5, 15)), 22000, 'Salt']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = (await read('clients.xlsx', buf)).json();
    expect(r.sheets[0]).toMatchObject({ name: 'Clients', headers: ['Client', 'Since', 'Volume', 'Salt or chlorine'], sample: [['Dee Diaz', '2024-06-15', '22000', 'Salt']] });
    expect(r.mapping).toEqual(['customer.name', 'customer.startDate', 'pool.volumeGal', 'pool.type']);
    expect((await apply('clients.xlsx', buf, { mapping: r.mapping })).statusCode).toBe(200);
    const d = await Customer.findOne({ name: 'Dee Diaz' }).lean<any>();
    expect(d.startDate.toISOString()).toBe('2024-06-15T00:00:00.000Z');
    expect(await Pool.findOne({ customerId: d._id }).lean()).toMatchObject({ name: 'Pool', volumeGal: 22000, type: 'salt' });
  });

  it('refuses old .xls, files over 5 MB, and no file', async () => {
    expect((await read('old.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).json().message).toMatch(/\.xls/);
    const big = await read('big.csv', 'a\n' + 'x'.repeat(5 * 1024 * 1024 + 10));
    expect(big.statusCode).toBe(413);
    const none = await ctx.app.inject({ method: 'POST', url: '/api/import/read', headers: { cookie }, payload: {} });
    expect(none.statusCode).toBe(400);
  });

  it('needs a login', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/import/read', ...form('a.csv', 'a\n1'), headers: { 'content-type': form('a.csv', 'a').headers['content-type'] } });
    expect(res.statusCode).toBe(401);
  });
});
