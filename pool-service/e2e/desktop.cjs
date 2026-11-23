// Phase 7D segment 1: desktop view (Nov 2026), computer size. Works next to real data: totals are
// checked on rows found by this run's tag, business settings are never touched, and everything
// made here is removed at the end.
//  1. More → Desktop view opens the desktop view; this device remembers it (/ opens it).
//  2. Customers: quick-entry row adds one; search finds it; the side panel edits it; totals row.
//  3. Chemicals: quick-entry row adds one with a price.
//  4. Expenses & income: quick-entry expense and income; totals; the panel edits the expense.
//  5. Mileage: quick-entry miles; total.
//  6. Invoices: a draft from the quick row opens in the panel with the monthly rate.
//  7. Payments: the quick row records a payment for that invoice (balance filled in) → Paid.
//  8. Route: the pool is listed under today; ticking Done saves it.
//  9. Visits: a visit from today shows with its reading and chemical cost.
// 10. Phone view goes back to the phone screens, and the device remembers that too.
//
//   node desktop.cjs <baseUrl> <password> <outDir>
const { chromium } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
  const num = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
  const go = async (menu) => {
    await page.locator(`[data-test=desk-nav-${menu}]`).click();
    await page.locator('[data-test=table-search]').waitFor();
  };
  const search = async (text) => {
    await page.locator('[data-test=table-search]').fill(text);
    await page.waitForTimeout(400);
  };
  const dataRows = (table) => page.locator(`[data-test=${table}] tbody tr:not(.desk-total)`);
  /** Cell text of the totals row by column header. */
  const totalOf = async (table, header) => {
    const headers = await page.locator(`[data-test=${table}] thead th`).allInnerTexts();
    const i = headers.findIndex((h) => h.trim().replace(/\s*(arrow_upward|arrow_downward)\s*/g, '') === header);
    if (i < 0) throw new Error(`no column "${header}" in ${headers.join('|')}`);
    return page.locator(`[data-test=${table}] .desk-total td`).nth(i).innerText();
  };
  const field = (name) => page.locator('.q-field', { has: page.locator(`[data-test=${name}]`) });
  const pick = async (name, option, typed) => {
    await field(name).click();
    if (typed) await page.locator(`[data-test=${name}]`).fill(typed);
    await page.getByRole('option', { name: option }).first().click();
  };

  try {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    if (await page.getByLabel('Password').isVisible().catch(() => false)) {
      await page.getByLabel('Email').fill(process.env.E2E_EMAIL || 'owner');
      await page.getByLabel('Password').fill(password);
      await page.locator('[data-test=login]').click();
    }
    await page.locator('[data-test=done-count]').waitFor();

    // ---- 1. Desktop view, remembered
    await page.locator('[data-test=tab-more]').click();
    await page.locator('[data-test=more-desktop]').click();
    await page.waitForURL(/\/desk$/);
    await page.locator('[data-test=card-owed]').waitFor();
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.waitForURL(/\/desk$/);
    await page.locator('[data-test=desk-menu]').waitFor();
    await page.screenshot({ path: `${out}/desk-home.png` });
    ok('More → Desktop view opens the dashboard; opening / again goes straight there');

    // ---- 2. Customers
    await go('customers');
    const name = `E2E desk ${tag}`;
    await page.locator('[data-test=quick-name]').fill(name);
    await page.locator('[data-test=quick-phone]').fill('214 555 0142');
    await page.locator('[data-test=quick-rate]').fill('120');
    await page.locator('[data-test=quick-add]').click();
    const c = await waitFor(async () => (await getJson('/customers')).find((x) => x.name === name));
    if (!c || c.monthlyRate !== 120 || c.phones?.[0]?.number !== '+12145550142') throw new Error(`quick customer on the server: ${JSON.stringify(c)}`);
    customers.push(c._id);
    await search(tag);
    if ((await dataRows('desk-customers').count()) !== 1) throw new Error('search should find exactly the test customer');
    if (num(await totalOf('desk-customers', 'Monthly rate')) !== 120) throw new Error(`rate total: ${await totalOf('desk-customers', 'Monthly rate')}`);
    await dataRows('desk-customers').first().click();
    await page.locator('[data-test=side-panel]').waitFor();
    await page.locator('[data-test=customer-rate]').fill('130');
    await page.locator('[data-test=customer-distance]').fill('4');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/desk-customer-panel.png` });
    await page.locator('[data-test=panel-save]').click();
    await page.locator('[data-test=side-panel]').waitFor({ state: 'hidden' });
    const c2 = await waitFor(async () => {
      const x = (await getJson('/customers')).find((y) => y._id === c._id);
      return x?.monthlyRate === 130 ? x : null;
    });
    if (!c2 || c2.distanceMiles !== 4 || c2.phones?.[0]?.number !== '+12145550142') throw new Error(`panel edit on the server: ${JSON.stringify(c2)}`);
    if (num(await totalOf('desk-customers', 'Monthly rate')) !== 130) throw new Error('rate total after edit');
    ok('customer added from the quick row ($120, phone), found by search, edited in the side panel ($130, 4 mi), totals row follows');

    // ---- 3. Chemicals
    await go('chemicals');
    const chemName = `E2E desk chlorine ${tag}`;
    await page.locator('[data-test=quick-name]').fill(chemName);
    await page.locator('[data-test=quick-price]').fill('4.25');
    await page.locator('[data-test=quick-add]').click();
    const chem = await waitFor(async () => (await getJson('/chemicals')).find((x) => x.name === chemName));
    if (!chem || chem.price !== 4.25) throw new Error(`chemical on the server: ${JSON.stringify(chem)}`);
    chemicals.push(chem._id);
    await search(tag);
    if ((await dataRows('desk-chemicals').count()) !== 1) throw new Error('chemical row');
    ok('chemical added from the quick row with its cost ($4.25 per lb)');

    // ---- 4. Expenses & income
    await go('money');
    await page.locator('[data-test=quick-amount]').fill('12.34');
    await page.locator('[data-test=quick-category]').click();
    await page.getByRole('option', { name: 'Fuel' }).click();
    await page.locator('[data-test=quick-vendor]').fill('QT');
    await page.locator('[data-test=quick-note]').fill(`e2e ${tag} fuel`);
    await page.locator('[data-test=quick-add]').click();
    await waitFor(async () => (await getJson('/ledger')).find((e) => e.note === `e2e ${tag} fuel`));
    await page.locator('[data-test=quick-kind]').getByRole('button', { name: 'Income' }).click();
    await page.locator('[data-test=quick-amount]').fill('50');
    await page.locator('[data-test=quick-note]').fill(`e2e ${tag} cash job`);
    await page.locator('[data-test=quick-add]').click();
    const income = await waitFor(async () => (await getJson('/ledger')).find((e) => e.note === `e2e ${tag} cash job`));
    if (!income || income.kind !== 'income' || income.amount !== 50) throw new Error(`income on the server: ${JSON.stringify(income)}`);
    await search(tag);
    if ((await dataRows('desk-ledger').count()) !== 2) throw new Error(`ledger rows: ${await dataRows('desk-ledger').count()}`);
    if (num(await totalOf('desk-ledger', 'Expense')) !== 12.34 || num(await totalOf('desk-ledger', 'Income')) !== 50) throw new Error('ledger totals');
    await dataRows('desk-ledger').filter({ hasText: 'QT' }).click();
    await page.locator('[data-test=entry-amount]').fill('15');
    await page.locator('[data-test=panel-save]').click();
    await page.locator('[data-test=side-panel]').waitFor({ state: 'hidden' });
    const fuel = await waitFor(async () => (await getJson('/ledger')).find((e) => e.note === `e2e ${tag} fuel` && e.amount === 15));
    if (!fuel || fuel.category !== 'fuel' || fuel.vendor !== 'QT') throw new Error(`fuel after edit: ${JSON.stringify(fuel)}`);
    if (num(await totalOf('desk-ledger', 'Expense')) !== 15) throw new Error('expense total after edit');
    await page.screenshot({ path: `${out}/desk-ledger.png` });
    ok('expense ($12.34 Fuel, QT) and income ($50) from the quick row; totals; expense edited to $15 in the panel');

    // ---- 5. Mileage
    await go('mileage');
    await page.locator('[data-test=quick-miles]').fill('22.5');
    await page.locator('[data-test=quick-note]').fill(`e2e ${tag} miles`);
    await page.locator('[data-test=quick-add]').click();
    const miles = await waitFor(async () => (await getJson('/ledger')).find((e) => e.note === `e2e ${tag} miles`));
    if (!miles || miles.kind !== 'mileage' || miles.miles !== 22.5) throw new Error(`miles on the server: ${JSON.stringify(miles)}`);
    await search(tag);
    if (num(await totalOf('desk-mileage', 'Miles')) !== 22.5) throw new Error('miles total');
    ok('22.5 miles from the quick row; miles total');

    // ---- 6. Invoices: a draft from the quick row
    await go('invoices');
    await pick('quick-customer', name, tag);
    await page.locator('[data-test=quick-add]').click();
    await page.locator('[data-test=side-panel] [data-test=invoice-total]').waitFor();
    const total = num(await page.locator('[data-test=side-panel] [data-test=invoice-total]').innerText());
    if (total !== 130) throw new Error(`draft total ${total}`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/desk-invoice-panel.png` });
    await page.locator('[data-test=side-panel] [data-test=invoice-mark-sent]').click();
    const inv = await waitFor(async () => (await getJson(`/invoices?customerId=${c._id}`)).find((i) => i.status === 'sent'));
    if (!inv) throw new Error('invoice not marked sent on the server');
    await page.keyboard.press('Escape');
    await search(tag);
    if (num(await totalOf('desk-invoices', 'Balance')) !== 130) throw new Error('invoice balance total');
    ok(`draft invoice #${inv.number} from the quick row opens in the panel ($130 monthly rate); marked sent; balance total $130`);

    // ---- 7. Payments
    await go('payments');
    await pick('quick-invoice', new RegExp(`#${inv.number} `), String(inv.number));
    if (num(await page.locator('[data-test=quick-amount]').inputValue()) !== 130) throw new Error('payment amount should start at the balance');
    await page.locator('[data-test=quick-method]').click();
    await page.getByRole('option', { name: 'Check' }).click();
    await page.locator('[data-test=quick-reference]').fill('4417');
    await page.locator('[data-test=quick-add]').click();
    const paid = await waitFor(async () => {
      const i = (await getJson(`/invoices?customerId=${c._id}`)).find((x) => x._id === inv._id);
      return i?.payments?.length ? i : null;
    });
    if (!paid || paid.payments[0].amount !== 130 || paid.payments[0].method !== 'check' || paid.payments[0].reference !== '4417') throw new Error(`payment on the server: ${JSON.stringify(paid?.payments)}`);
    await search(tag);
    if ((await dataRows('desk-payments').count()) !== 1 || num(await totalOf('desk-payments', 'Amount')) !== 130) throw new Error('payments table');
    await page.screenshot({ path: `${out}/desk-payments.png` });
    ok('payment from the quick row: balance filled in ($130), check #4417; on the server; in the Payments table');

    // ---- 8. Route
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    const pool = await (await api.post(url('/api/pools'), { data: { customerId: c._id, name: 'Pool', serviceDay: day } })).json();
    await page.reload({ waitUntil: 'networkidle' });
    await go('route');
    await search(tag);
    const routeRow = dataRows('desk-route').first();
    await waitFor(async () => (await routeRow.innerText()).includes(name), 20000);
    if (!(await routeRow.innerText()).includes('Today') && !(await routeRow.locator('.text-primary').count())) throw new Error('route row should be under today');
    await page.locator(`[data-test=desk-done-${pool._id}]`).click();
    const done = await waitFor(async () => ((await getJson(`/pools/${pool._id}`)).week?.done ? true : null));
    if (!done) throw new Error('Done not saved on the server');
    ok("pool listed under today's day on the Route table; ticking Done saved it");

    // ---- 9. Visits
    const t = (h) => new Date(Date.now() - h * 3600_000).toISOString();
    await api.post(url('/api/sync/package'), {
      data: {
        packageId: crypto.randomUUID(),
        poolId: pool._id,
        createdAt: t(0),
        visit: { _id: crypto.randomUUID(), poolId: pool._id, visitedAt: t(1), createdAt: t(1), updatedAt: t(1), readings: { fc: 0.4, ph: 7.5 }, doses: [{ chemicalId: chem._id, amount: 2, unit: 'lb', cost: 8.5 }], timeLog: { segments: [{ start: t(1), end: t(0.5) }], finished: true } },
      },
    });
    await go('visits');
    await page.locator('[data-test=desk-visits] tbody tr').first().waitFor();
    await search(tag);
    const vrow = dataRows('desk-visits').first();
    await vrow.waitFor();
    const vtext = (await vrow.innerText()).replace(/\s+/g, ' ');
    for (const want of [name, '0.4', '7.5', '$8.50', '30', chemName]) if (!vtext.includes(want)) throw new Error(`visit row missing "${want}": ${vtext}`);
    if (!(await vrow.locator('.text-negative').count())) throw new Error('low chlorine (0.4) should be marked red');
    await page.screenshot({ path: `${out}/desk-visits.png` });
    ok('visit from the server: 30 min, FC 0.4 (marked red), pH 7.5, chemical and its cost $8.50');

    // ---- 10. Phone view
    await page.locator('[data-test=phone-view]').click();
    await page.locator('[data-test=done-count]').waitFor();
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=done-count]').waitFor();
    if (/\/desk/.test(page.url())) throw new Error('should stay on the phone view');
    ok('Phone view goes back to the Route; / stays on the phone view after that');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    for (const e of await getJson('/ledger').catch(() => [])) if (String(e.note ?? '').includes(`e2e ${tag}`)) await api.delete(url(`/api/ledger/${e._id}`)).catch(() => undefined);
    for (const id of customers) {
      for (const i of await getJson(`/invoices?customerId=${id}`).catch(() => [])) await api.delete(url(`/api/invoices/${i._id}`)).catch(() => undefined);
      await api.delete(url(`/api/customers/${id}`)).catch(() => undefined);
    }
    for (const id of chemicals) await api.delete(url(`/api/chemicals/${id}`)).catch(() => undefined);
    console.log('  (test customer, pool, chemical, entries and invoice hidden)');
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
