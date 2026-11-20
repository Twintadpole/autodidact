// Phase 7E-1: exports (Nov 2026). Downloads the files and opens them. Works next to real data:
// everything made here is removed at the end. Needs exceljs next to playwright (NODE_PATH).
//  1. A desktop table (Customers, searched): Excel with real numbers; CSV made offline-capable on the device.
//  2. Expenses: dates come out as real Excel dates, money as numbers.
//  3. Export everything (desktop menu): one workbook, a sheet per kind; the test customer, its visit with
//     the chemical cost, its invoice and payment are in it.
//  4. A full-screen dashboard card exports its table to Excel.
//  5. On a phone: More → Export everything downloads the workbook.
//
//   node export.cjs <baseUrl> <password> <outDir>
const fs = require('fs');
const { chromium, devices } = require('playwright');
const ExcelJS = require('exceljs');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const api = ctx.request;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const tag = Date.now().toString(36);
  const customers = [];
  const chemicals = [];
  const getJson = async (p) => (await api.get(url(`/api${p}`))).json();
  const login = async (p) => {
    await p.goto(url('/login'), { waitUntil: 'networkidle' });
    if (await p.getByLabel('Password').isVisible().catch(() => false)) {
      await p.getByLabel('Email').fill(process.env.E2E_EMAIL || 'owner');
      await p.getByLabel('Password').fill(password);
      await p.locator('[data-test=login]').click();
    }
    await p.locator('[data-test=done-count]').waitFor();
  };
  /** Clicks, waits for the download, saves a copy in out/ and returns its path and name. */
  const download = async (p, click) => {
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), click()]);
    const name = d.suggestedFilename();
    const path = `${out}/${name}`;
    await d.saveAs(path);
    return { path, name };
  };
  const workbook = async (path) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    return wb;
  };
  const sheetRows = (wb, name) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(`no sheet "${name}" (have ${wb.worksheets.map((w) => w.name)})`);
    const headers = ws.getRow(1).values.slice(1).map(String);
    const rows = [];
    ws.eachRow((r, i) => i > 1 && rows.push(Object.fromEntries(headers.map((h, j) => [h, r.values[j + 1] ?? null]))));
    return rows;
  };
  const exportFrom = async (which) => {
    await page.locator('[data-test=table-export]').click();
    return download(page, () => page.locator(`[data-test=table-export-${which}]`).click());
  };

  try {
    await login(page);
    // Test data: a customer with a pool, a visit with a priced dose, an invoice with a payment, an expense.
    const name = `E2E export ${tag}`;
    const c = await (await api.post(url('/api/customers'), { data: { name, monthlyRate: 135, status: 'current' } })).json();
    customers.push(c._id);
    const pool = await (await api.post(url('/api/pools'), { data: { customerId: c._id, name: 'Pool' } })).json();
    const chem = await (await api.post(url('/api/chemicals'), { data: { name: `E2E export acid ${tag}`, defaultUnit: 'gal', price: 7, priceUnit: 'gal' } })).json();
    chemicals.push(chem._id);
    const now = new Date();
    const t = (h) => new Date(Date.now() - h * 3600_000).toISOString();
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const pkg = (extra) => ({ data: { packageId: crypto.randomUUID(), createdAt: t(0), ...extra } });
    await api.post(url('/api/sync/package'), pkg({ poolId: pool._id, visit: { _id: crypto.randomUUID(), poolId: pool._id, visitedAt: t(1), createdAt: t(1), updatedAt: t(1), readings: { fc: 3 }, doses: [{ chemicalId: chem._id, amount: 2, unit: 'gal', cost: 14 }] } }));
    const invNumber = 98000 + Math.floor(Math.random() * 999);
    await api.post(url('/api/sync/package'), pkg({ invoices: [{ _id: crypto.randomUUID(), customerId: c._id, number: invNumber, issueDate: ymd(now), lines: [{ _id: crypto.randomUUID(), description: 'Monthly', amount: 135 }], status: 'sent', payments: [{ _id: crypto.randomUUID(), date: ymd(now), amount: 35, method: 'cash' }], createdAt: t(0), updatedAt: t(0) }] }));
    await api.post(url('/api/sync/package'), pkg({ ledger: [{ _id: crypto.randomUUID(), kind: 'expense', date: '2026-02-14', amount: 19.99, category: 'supplies', vendor: `E2E vendor ${tag}`, note: `e2e ${tag} net`, createdAt: t(0), updatedAt: t(0) }] }));

    // ---- 1. A desktop table
    await page.goto(url('/desk/customers'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=table-search]').fill(tag);
    await page.locator('[data-test=desk-customers] tbody tr', { hasText: name }).waitFor({ timeout: 30000 });
    const x1 = await exportFrom('xlsx');
    if (!/^customers-\d{4}-\d{2}-\d{2}\.xlsx$/.test(x1.name)) throw new Error(`file name ${x1.name}`);
    const cust = sheetRows(await workbook(x1.path), 'customers');
    if (cust.length !== 1 || cust[0].Name !== name || cust[0]['Monthly rate'] !== 135 || cust[0].Class !== 'Current') throw new Error(`customers sheet: ${JSON.stringify(cust)}`);
    const c1 = await exportFrom('csv');
    const csv = fs.readFileSync(c1.path, 'utf8');
    if (!/^customers-\d{4}-\d{2}-\d{2}\.csv$/.test(c1.name) || !csv.includes(`${name},Current`) || !csv.includes(',135,')) throw new Error(`csv ${c1.name}: ${csv}`);
    ok(`Customers table (searched) → Excel (1 row, rate 135 as a number) and CSV`);

    // ---- 2. Expenses: real dates
    await page.goto(url('/desk/money'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=desk-period]').click();
    await page.getByRole('option', { name: 'All dates' }).click();
    await page.locator('[data-test=table-search]').fill(tag);
    await page.locator('[data-test=desk-ledger] tbody tr', { hasText: 'Supplies' }).waitFor({ timeout: 30000 });
    const x2 = await exportFrom('xlsx');
    const [e] = sheetRows(await workbook(x2.path), 'expenses-income');
    if (!(e.Date instanceof Date) || e.Date.toISOString().slice(0, 10) !== '2026-02-14' || e.Expense !== 19.99) throw new Error(`expense row: ${JSON.stringify(e)}`);
    ok('Expenses table → Excel: the date is a real date (2026-02-14), $19.99 a number');

    // ---- 3. Export everything
    const all = await download(page, () => page.locator('[data-test=desk-export-all]').click());
    if (!/^pool-service-everything-\d{4}-\d{2}-\d{2}\.xlsx$/.test(all.name)) throw new Error(`file name ${all.name}`);
    const wb = await workbook(all.path);
    const sheets = wb.worksheets.map((w) => w.name);
    for (const s of ['Customers', 'Pools', 'Equipment', 'Visits', 'Chemicals added', 'Invoices', 'Invoice lines', 'Payments', 'Expenses & income', 'Mileage', 'Chemicals', 'Issues', 'Notes']) if (!sheets.includes(s)) throw new Error(`missing sheet ${s}: ${sheets}`);
    const visit = sheetRows(wb, 'Visits').find((r) => r.Customer === name);
    if (!visit || visit['Chemical cost'] !== 14 || !(visit.Date instanceof Date)) throw new Error(`visit row: ${JSON.stringify(visit)}`);
    const inv = sheetRows(wb, 'Invoices').find((r) => r.Number === invNumber);
    if (!inv || inv.Total !== 135 || inv.Paid !== 35 || inv.Balance !== 100) throw new Error(`invoice row: ${JSON.stringify(inv)}`);
    if (!sheetRows(wb, 'Payments').some((r) => r.Invoice === invNumber && r.Amount === 35 && r.Method === 'cash')) throw new Error('payment row missing');
    if (!sheetRows(wb, 'Chemicals').some((r) => r.Name === `E2E export acid ${tag}` && r['Your cost'] === 7)) throw new Error('chemical price missing');
    ok(`Export everything → ${all.name}: ${sheets.length} sheets; the visit (chemical cost $14), invoice #${invNumber} ($135, paid $35, owes $100) and payment are in it`);

    // ---- 4. A dashboard card
    await page.goto(url('/desk'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=card-full-chemicals]').click();
    await page.locator('[data-test=dash-tools]').waitFor();
    await page.locator('[data-test=dash-fullscreen] [data-test=chem-table]').getByText(`E2E export acid ${tag}`).waitFor({ timeout: 30000 });
    await page.locator('[data-test=tool-export]').click();
    const x4 = await download(page, () => page.locator('[data-test=tool-export-xlsx]').click());
    const chemRow = sheetRows(await workbook(x4.path), 'chemical-costs').find((r) => r.Chemical === `E2E export acid ${tag}`);
    if (!chemRow || chemRow['This month'] !== 14) throw new Error(`card export: ${JSON.stringify(chemRow)}`);
    await page.locator('[data-test=dash-fullscreen-close]').click();
    ok('full-screen Chemical costs card → Excel: the test chemical, $14 this month');

    // ---- 5. Phone
    const phoneCtx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
    const phone = await phoneCtx.newPage();
    phone.on('pageerror', (er) => errors.push(`phone: ${er.message}`));
    await login(phone);
    await phone.locator('[data-test=tab-more]').click();
    const p5 = await download(phone, () => phone.locator('[data-test=more-export-all]').click());
    if ((await workbook(p5.path)).worksheets.length < 13) throw new Error('phone workbook incomplete');
    await phoneCtx.close();
    ok('phone: More → Export everything downloads the workbook');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    for (const e of await getJson('/ledger').catch(() => [])) if (String(e.note ?? '').includes(`e2e ${tag}`)) await api.delete(url(`/api/ledger/${e._id}`)).catch(() => undefined);
    for (const id of customers) {
      for (const i of await getJson(`/invoices?customerId=${id}`).catch(() => [])) await api.delete(url(`/api/invoices/${i._id}`)).catch(() => undefined);
      await api.delete(url(`/api/customers/${id}`)).catch(() => undefined);
    }
    for (const id of chemicals) await api.delete(url(`/api/chemicals/${id}`)).catch(() => undefined);
    for (const f of fs.readdirSync(out)) if (/\.(xlsx|csv)$/.test(f)) fs.rmSync(`${out}/${f}`);
    console.log('  (test customer, pool, chemical, invoice and expense hidden; downloaded files removed)');
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
