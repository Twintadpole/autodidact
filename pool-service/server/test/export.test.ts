import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const at = new Date().toISOString();
const post = (payload: object) => ctx.app.inject({ method: 'POST', url: '/api/sync/package', headers: { cookie }, payload: { packageId: newId(), createdAt: at, ...payload } });
async function read(body: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as unknown as ArrayBuffer);
  return wb;
}
/** Rows of a sheet as objects keyed by header. */
function rows(wb: ExcelJS.Workbook, name: string) {
  const ws = wb.getWorksheet(name)!;
  const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  const out: Record<string, unknown>[] = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const vals = (r.values as unknown[]).slice(1);
    out.push(Object.fromEntries(headers.map((h, j) => [h, vals[j] ?? null])));
  });
  return out;
}

describe('7E: export everything', () => {
  it('makes one workbook with every kind of record, chemical costs included, deleted ones left out', async () => {
    const c = { _id: newId(), name: 'Export Ella', monthlyRate: 150, phones: [{ label: 'mobile', number: '+12145550100' }], createdAt: at, updatedAt: at };
    const gone = { _id: newId(), name: 'Export Gone', createdAt: at, updatedAt: at, deletedAt: at };
    const p = { _id: newId(), customerId: c._id, name: 'Back', serviceDay: 'tue', equipment: [{ _id: newId(), kind: 'pump', model: 'IntelliFlo', installedOn: '2019-04-01' }], createdAt: at, updatedAt: at };
    const chem = { _id: newId(), name: 'Export acid', defaultUnit: 'gal', price: 9, priceUnit: 'gal', active: true, createdAt: at, updatedAt: at };
    expect((await post({ customers: [c, gone], pools: [p], chemicals: [chem] })).statusCode).toBe(200);
    // 15:30 UTC = 09:30 in Dallas (UTC−6 in November).
    const visit = { _id: newId(), poolId: p._id, visitedAt: '2026-11-10T15:30:00.000Z', readings: { fc: 3, ph: 7.4 }, doses: [{ chemicalId: chem._id, amount: 1, unit: 'gal', cost: 9 }], tasks: { brushed: true }, timeLog: { segments: [{ start: '2026-11-10T15:30:00.000Z', end: '2026-11-10T16:15:00.000Z' }], finished: true }, createdAt: at, updatedAt: at };
    expect((await post({ poolId: p._id, visit })).statusCode).toBe(200);
    const inv = { _id: newId(), customerId: c._id, number: 7001, period: '2026-11', issueDate: '2026-11-01', dueDate: '2026-11-01', lines: [{ _id: newId(), description: 'Monthly', amount: 150 }], status: 'sent', payments: [{ _id: newId(), date: '2026-11-05', amount: 100, method: 'check', reference: '881' }], createdAt: at, updatedAt: at };
    const ledger = [
      { _id: newId(), kind: 'expense', date: '2026-11-03', amount: 42.5, category: 'fuel', vendor: 'QT', createdAt: at, updatedAt: at },
      { _id: newId(), kind: 'mileage', date: '2026-11-03', miles: 63, createdAt: at, updatedAt: at },
    ];
    expect((await post({ invoices: [inv], ledger })).statusCode).toBe(200);

    const res = await ctx.app.inject({ method: 'GET', url: '/api/export/everything.xlsx?tzOffsetMin=360', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="pool-service-everything-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const wb = await read(res.rawPayload);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Customers', 'Pools', 'Equipment', 'Visits', 'Chemicals added', 'Invoices', 'Invoice lines', 'Payments', 'Expenses & income', 'Mileage', 'Chemicals', 'Issues', 'Notes']);

    const customers = rows(wb, 'Customers');
    expect(customers.find((r) => r.Name === 'Export Ella')).toMatchObject({ Class: 'Current', 'Monthly rate': 150, Phones: 'mobile: +12145550100' });
    expect(customers.some((r) => r.Name === 'Export Gone')).toBe(false);
    expect(rows(wb, 'Equipment').find((r) => r.Model === 'IntelliFlo')).toMatchObject({ Customer: 'Export Ella', Equipment: 'Pump' });

    const v = rows(wb, 'Visits').find((r) => r.Customer === 'Export Ella')!;
    expect(v).toMatchObject({ 'Minutes on site': 45, 'FC (ppm)': 3, pH: 7.4, Tasks: 'Brushed', 'Chemicals added': 'Export acid 1 gal', 'Chemical cost': 9 });
    expect((v.Date as Date).toISOString()).toBe('2026-11-10T09:30:00.000Z'); // shown as 09:30, the owner's time
    expect(rows(wb, 'Chemicals added').find((r) => r.Chemical === 'Export acid')).toMatchObject({ Amount: 1, Cost: 9 });

    expect(rows(wb, 'Invoices').find((r) => r.Number === 7001)).toMatchObject({ Customer: 'Export Ella', Total: 150, Paid: 100, Balance: 50 });
    const pay = rows(wb, 'Payments').find((r) => r.Invoice === 7001)!;
    expect(pay).toMatchObject({ Amount: 100, Method: 'check', Reference: '881' });
    expect((pay.Date as Date).toISOString().slice(0, 10)).toBe('2026-11-05');
    expect(rows(wb, 'Expenses & income').find((r) => r.Vendor === 'QT')).toMatchObject({ Type: 'Expense', Category: 'Fuel', Amount: 42.5 });
    expect(rows(wb, 'Mileage').find((r) => r.Miles === 63)).toBeTruthy();
    expect(rows(wb, 'Chemicals').find((r) => r.Name === 'Export acid')).toMatchObject({ 'Your cost': 9, Per: 'gal' });
  });

  it('needs a login', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/export/everything.xlsx' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/export/table.xlsx', payload: { name: 'x', columns: [{ header: 'A' }], rows: [] } })).statusCode).toBe(401);
  });
});

describe('7E: export one table', () => {
  it('turns the rows the app sends into a sheet with real numbers and dates', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/export/table.xlsx',
      headers: { cookie },
      payload: {
        name: 'Payments',
        columns: [{ header: 'Date', type: 'date' }, { header: 'When', type: 'datetime' }, { header: 'Customer' }, { header: 'Amount', type: 'money' }, { header: 'Active', type: 'yesno' }],
        rows: [['2026-11-05', '2026-11-05 14:20', 'Ella', 100.5, true]],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Payments.xlsx"');
    const [r] = rows(await read(res.rawPayload), 'Payments');
    expect(r).toMatchObject({ Customer: 'Ella', Amount: 100.5, Active: 'Yes' });
    expect((r!.Date as Date).toISOString()).toBe('2026-11-05T00:00:00.000Z');
    expect((r!.When as Date).toISOString()).toBe('2026-11-05T14:20:00.000Z');
  });

  it('refuses a bad column type', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/export/table.xlsx', headers: { cookie }, payload: { name: 'x', columns: [{ header: 'A', type: 'pie' }], rows: [] } });
    expect(res.statusCode).toBe(400);
  });
});
