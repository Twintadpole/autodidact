// Phase 7C: money tools (Nov 2026), phone size. Works next to real data: totals are checked as
// changes, business settings are never touched, and everything made here is removed at the end.
//  1. Expense with a receipt photo (Fuel): expenses and profit move by its amount.
//  2. Supplies for a customer, "Add to their invoice": a line on their draft invoice at the billed
//     amount; editing the billed amount updates the line.
//  3. Other income moves income and profit; Tools (capital) shows separately, not in expenses.
//  4. Miles from odometer readings (63 mi).
//  5. What the customer earns per hour: billed − chemicals − mileage − their expenses, over hours
//     where the untimed visit uses the pool's average; the breakdown explains it.
//  6. Deleting the Supplies expense removes its invoice line.
//
//   node money.cjs <baseUrl> <password> <outDir>
const { chromium, devices } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
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
  const waitFor = async (fn, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn().catch(() => null);
      if (v) return v;
      if (Date.now() > end) return null;
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
  const dollars = async (sel) => Number((await page.locator(sel).innerText()).replace(/[^0-9.-]/g, ''));
  const near = (a, b) => Math.abs(a - b) < 0.005;
  const moneyTotals = async () => {
    await page.goto(url('/more/money'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=money-income]').waitFor();
    return {
      income: await dollars('[data-test=money-income]'),
      expenses: await dollars('[data-test=money-expenses]'),
      profit: await dollars('[data-test=money-profit]'),
      miles: Number((await page.locator('[data-test=money-miles]').innerText()).match(/([\d,.]+)\s*mi/)[1].replace(/,/g, '')),
    };
  };
  // Category and customer accept typing, so their test tag sits on the inner text box; tap the whole field.
  const field = (name) => page.locator('.q-field', { has: page.locator(`[data-test=${name}]`) });
  const saveEntry = async () => {
    await page.locator('[data-test=entry-save]').click();
    await page.waitForURL(/\/more\/money$/);
  };

  try {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();

    // A customer with a rate and a distance, two visits today (one timed 60 min, one not), $9 of chemicals.
    const c = await (await api.post(url('/api/customers'), { data: { name: `E2E test ${tag}`, monthlyRate: 150, distanceMiles: 10 } })).json();
    customers.push(c._id);
    const pool = await (await api.post(url('/api/pools'), { data: { customerId: c._id, name: 'Pool' } })).json();
    const chem = await (await api.post(url('/api/chemicals'), { data: { name: `E2E test acid ${tag}`, defaultUnit: 'gal', price: 9, priceUnit: 'gal' } })).json();
    chemicals.push(chem._id);
    const t = (h) => new Date(Date.now() - h * 3600_000).toISOString();
    for (const visit of [
      { _id: crypto.randomUUID(), poolId: pool._id, visitedAt: t(3), createdAt: t(3), updatedAt: t(3), timeLog: { segments: [{ start: t(3), end: t(2) }], finished: true }, doses: [{ chemicalId: chem._id, amount: 1, unit: 'gal', cost: 9 }] },
      { _id: crypto.randomUUID(), poolId: pool._id, visitedAt: t(1), createdAt: t(1), updatedAt: t(1) },
    ])
      await api.post(url('/api/sync/package'), { data: { packageId: crypto.randomUUID(), poolId: pool._id, createdAt: t(0), visit } });

    // ---- 1. Expense with a receipt
    const before = await moneyTotals();
    await page.locator('[data-test=add-expense]').click();
    await page.locator('[data-test=entry-amount]').fill('42.50');
    await field('entry-category').click();
    await page.getByRole('option', { name: 'Fuel' }).click();
    await page.locator('[data-test=entry-vendor]').fill('QT');
    await page.locator('[data-test=entry-note]').fill(`e2e ${tag} fuel`);
    const jpeg = await page.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 1200;
      cv.height = 1800;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 1200, 1800);
      g.fillStyle = '#000';
      g.font = '80px sans-serif';
      g.fillText('RECEIPT $42.50', 100, 300);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of buf) s += String.fromCharCode(b);
      return btoa(s);
    });
    await page.locator('[data-test=entry-receipt-input]').setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
    await page.locator('[data-test=entry-receipt] img').waitFor();
    await saveEntry();
    const afterFuel = await moneyTotals();
    if (!near(afterFuel.expenses - before.expenses, 42.5) || !near(before.profit - afterFuel.profit, 42.5)) throw new Error(`fuel: ${JSON.stringify({ before, afterFuel })}`);
    const fuel = await waitFor(async () => (await getJson('/ledger')).find((e) => e.note === `e2e ${tag} fuel`));
    if (!fuel || fuel.category !== 'fuel' || fuel.vendor !== 'QT' || !String(fuel.receiptDataUrl).startsWith('data:image/jpeg')) throw new Error(`fuel on the server: ${JSON.stringify({ ...fuel, receiptDataUrl: fuel?.receiptDataUrl?.slice(0, 30) })}`);
    ok(`expense $42.50 (Fuel, QT, receipt ${Math.round(fuel.receiptDataUrl.length / 1024)} KB): expenses +$42.50, profit −$42.50`);

    // ---- 2. Supplies billed to the customer
    await page.locator('[data-test=add-expense]').click();
    await page.locator('[data-test=entry-amount]').fill('20');
    await field('entry-category').click();
    await page.getByRole('option', { name: /^Supplies/ }).click();
    await field('entry-customer').click();
    await page.locator('[data-test=entry-customer]').fill(tag);
    await page.getByRole('option', { name: `E2E test ${tag}` }).click();
    await page.locator('[data-test=entry-note]').fill(`e2e ${tag} skimmer net`);
    await page.locator('[data-test=entry-bill]').waitFor();
    await page.locator('[data-test=entry-billed]').fill('25');
    await saveEntry();
    const supplyLine = async (amount) =>
      waitFor(async () => {
        const inv = (await getJson(`/invoices?customerId=${c._id}`)).find((i) => i.status === 'draft' && !i.deletedAt);
        const line = inv?.lines.find((l) => l.description === `Supplies · e2e ${tag} skimmer net`);
        return line && line.amount === amount ? inv : null;
      });
    const inv1 = await supplyLine(25);
    if (!inv1) throw new Error('supplies line ($25) not on a draft invoice');
    const supplies = (await getJson('/ledger')).find((e) => e.note === `e2e ${tag} skimmer net`);
    await page.goto(url(`/more/money/${supplies._id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=entry-billed]').fill('30');
    await saveEntry();
    if (!(await supplyLine(30))) throw new Error('supplies line not updated to $30');
    ok(`supplies $20 for the customer, billed $25 → line on draft invoice #${inv1.number} (with the monthly $150); changed to $30 → line updated`);

    // ---- 3. Other income and a capital purchase
    const beforeIncome = await moneyTotals();
    await page.locator('[data-test=add-income]').click();
    await page.locator('[data-test=entry-amount]').fill('80');
    await page.locator('[data-test=entry-note]').fill(`e2e ${tag} cash job`);
    await saveEntry();
    await page.locator('[data-test=add-expense]').click();
    await page.locator('[data-test=entry-amount]').fill('200');
    await field('entry-category').click();
    await page.getByRole('option', { name: 'Tools (capital)' }).click();
    await page.locator('[data-test=entry-note]').fill(`e2e ${tag} pole`);
    await saveEntry();
    const afterIncome = await moneyTotals();
    if (!near(afterIncome.income - beforeIncome.income, 80) || !near(afterIncome.expenses, beforeIncome.expenses) || !near(afterIncome.profit - beforeIncome.profit, 80)) throw new Error(`income/tools: ${JSON.stringify({ beforeIncome, afterIncome })}`);
    if (!/Capital purchases/.test(await page.locator('[data-test=money-capital]').innerText())) throw new Error('capital purchases line missing');
    ok('other income $80: income and profit +$80; Tools $200 shown as a capital purchase, not in expenses');

    // ---- 4. Miles from the odometer
    await page.locator('[data-test=add-miles]').click();
    await page.locator('[data-test=entry-odo-start]').fill('1000');
    await page.locator('[data-test=entry-odo-end]').fill('1063');
    if ((await page.locator('[data-test=entry-miles]').inputValue()) !== '63') throw new Error('odometer did not fill in 63 miles');
    await page.locator('[data-test=entry-note]').fill(`e2e ${tag} route`);
    await saveEntry();
    const afterMiles = await moneyTotals();
    if (!near(afterMiles.miles - afterIncome.miles, 63)) throw new Error(`miles: ${afterIncome.miles} → ${afterMiles.miles}`);
    ok('miles: odometer 1,000 → 1,063 fills in 63 mi; miles driven +63');

    // ---- 5. Per hour for the customer
    const row = page.locator(`[data-test=hours-${c._id}]`);
    await row.waitFor({ timeout: 20000 });
    const report = await getJson(`/reports/customer-hours?from=${new Date().toISOString().slice(0, 8)}01&to=${new Date().toISOString().slice(0, 10)}&tzOffsetMin=0`);
    const r = report.rows.find((x) => x.customerId === c._id);
    const rate = report.mileageRate ?? 0;
    const want = { billed: 180, chemicalCost: 9, expenses: 20, hours: 2, mileageCost: Math.round(2 * 2 * 10 * rate * 100) / 100 };
    if (!r || Object.entries(want).some(([k, v]) => !near(r[k], v)) || r.timedVisits !== 1 || r.estimatedVisits !== 1) throw new Error(`report row: ${JSON.stringify(r)} want ${JSON.stringify(want)}`);
    const profit = 180 - 9 - want.mileageCost - 20;
    if (!near(r.profit, profit) || !near(r.perHour, Math.round((profit / 2) * 100) / 100)) throw new Error(`profit/perHour: ${JSON.stringify(r)}`);
    await row.click();
    const detail = (await page.locator('[data-test=hours-detail]').innerText()).replace(/\s+/g, ' ');
    if (!detail.includes("1 at the pool's average time") || !detail.includes('$180.00')) throw new Error(`breakdown: ${detail}`);
    await page.screenshot({ path: `${out}/money-detail.png` });
    await page.keyboard.press('Escape');
    ok(`per hour: billed $180 − chemicals $9 − mileage $${want.mileageCost.toFixed(2)} − expenses $20 = $${profit.toFixed(2)} over 2 h (1 timed, 1 at the pool's average) → $${r.perHour.toFixed(2)}/h`);

    // ---- 6. Deleting the supplies removes the line
    await page.goto(url(`/more/money/${supplies._id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=entry-delete]').click();
    await page.locator('.q-dialog').getByRole('button', { name: 'Delete' }).click();
    await page.waitForURL(/\/more\/money$/, { timeout: 15000 }).catch(async (e) => {
      throw new Error(`after delete at ${page.url()}: ${(await page.locator('.q-page, .q-dialog').first().innerText()).replace(/\s+/g, ' ').slice(0, 200)} | errors: ${errors.join(' | ')} (${e.message.split('\n')[0]})`);
    });
    const gone = await waitFor(async () => {
      const inv = (await getJson(`/invoices?customerId=${c._id}`)).find((i) => i._id === inv1._id);
      return inv && !inv.lines.some((l) => l.description.includes('skimmer net')) ? inv : null;
    });
    if (!gone) throw new Error('supplies line still on the draft after deleting the expense');
    await page.screenshot({ path: `${out}/money.png`, fullPage: true });
    ok('deleting the supplies expense removed its line from the draft invoice');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    for (const e of await getJson('/ledger').catch(() => [])) if (String(e.note ?? '').includes(`e2e ${tag}`)) await api.delete(url(`/api/ledger/${e._id}`)).catch(() => undefined);
    for (const id of customers) {
      for (const i of await getJson(`/invoices?customerId=${id}`).catch(() => [])) await api.delete(url(`/api/invoices/${i._id}`)).catch(() => undefined);
      await api.delete(url(`/api/customers/${id}`)).catch(() => undefined);
    }
    for (const id of chemicals) await api.delete(url(`/api/chemicals/${id}`)).catch(() => undefined);
    console.log('  (test customer, chemical, entries and invoices hidden)');
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
