// Phase 7D segment 2: card dashboard (Nov 2026). Works next to real data: figures are checked as
// changes, the owner's dashboard layout is put back as it was at the end, and everything made here
// is removed.
//  1. The six cards show, in the usual order.
//  2. Figures follow the data: owed (+$125, overdue), profit this month (+$75 payment), chemicals this
//     month (+$8.50), today's stops (+1), "do now" issues (+1), per hour (the test customer listed).
//  3. Size: Small shows figures only; Large adds the chart and the list. Saved on the server.
//  4. Hide a card and show it again from the Cards menu; Move earlier; drag and drop.
//  5. Full screen shows the chart with its table.
//  6. The layout follows the owner: a phone (fresh device) gets the same order and sizes, in one column.
//  7. Segment 3: the new cards (water problems, customers, visit times, mileage, equipment age, system)
//     show; full-screen tools: customer filter, period, number format, hide a column, export CSV.
//
//   node dashboard.cjs <baseUrl> <password> <outDir>
const { chromium, devices } = require('playwright');

const DASH = '00000000-0000-4000-8000-000000000002';

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const api = ctx.request;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const tag = Date.now().toString(36);
  const customers = [];
  const chemicals = [];
  let savedLayout; // the owner's layout before the test (undefined = none)
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
  const num = async (sel, p = page) => Number((await p.locator(sel).first().innerText()).split('/')[0].replace(/[^0-9.-]/g, ''));
  const near = (a, b) => Math.abs(a - b) < 0.005;
  const order = async (p = page) => (await p.locator('[data-test=dash-grid] > .dash-cell').evaluateAll((els) => els.map((e) => e.dataset.test.replace('cell-', ''))));
  const serverLayout = async () => (await api.get(url(`/api/settings/${DASH}`))).json().catch(() => null);
  const login = async (p) => {
    await p.goto(url('/login'), { waitUntil: 'networkidle' });
    if (await p.getByLabel('Password').isVisible().catch(() => false)) {
      await p.getByLabel('Email').fill(process.env.E2E_EMAIL || 'owner');
      await p.getByLabel('Password').fill(password);
      await p.locator('[data-test=login]').click();
    }
    await p.locator('[data-test=done-count]').waitFor();
  };
  const openDash = async (p = page) => {
    await p.goto(url('/desk'), { waitUntil: 'networkidle' });
    await p.locator('[data-test=dash-grid]').waitFor();
    await p.waitForTimeout(800);
  };
  const figures = async () => {
    await openDash();
    await page.locator('[data-test=chem-month]').waitFor();
    return {
      owed: await num('[data-test=owed-total]'),
      profit: await num('[data-test=money-card-profit]'),
      chem: await num('[data-test=chem-month]'),
      today: Number((await page.locator('[data-test=week-today]').innerText()).split('/')[1]),
      doNow: (await page.locator('[data-test=issues-do-now]').count()) ? await num('[data-test=issues-do-now]') : 0,
    };
  };

  try {
    await login(page);
    const before = await serverLayout();
    savedLayout = before && before._id && !before.deletedAt ? before : undefined;
    // Start from the usual layout, so the test knows where things are.
    const t0 = new Date().toISOString();
    await api.post(url('/api/sync/package'), { data: { packageId: crypto.randomUUID(), createdAt: t0, settings: [{ _id: DASH, dashboard: { cards: [] }, createdAt: t0, updatedAt: t0, deletedAt: t0 }] } });

    // ---- 1. Cards
    await openDash();
    const usual = ['week', 'money', 'owed', 'hourly', 'chemicals', 'issues', 'water', 'pipeline', 'visitTimes', 'mileage', 'equipment', 'system'];
    if ((await order()).join() !== usual.join()) throw new Error(`card order: ${await order()}`);
    await page.screenshot({ path: `${out}/dash-usual.png` });
    ok(`${usual.length} cards in the usual order (${usual.join(', ')})`);

    // ---- 2. Figures follow the data
    const f0 = await figures();
    const c = await (await api.post(url('/api/customers'), { data: { name: `E2E dash ${tag}`, monthlyRate: 200 } })).json();
    customers.push(c._id);
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    const tenYearsAgo = `${new Date().getFullYear() - 10}-03-01`;
    const pool = await (
      await api.post(url('/api/pools'), { data: { customerId: c._id, name: 'Pool', serviceDay: day, equipment: [{ _id: crypto.randomUUID(), kind: 'pump', model: `E2E-${tag}`, installedOn: tenYearsAgo }] } })
    ).json();
    const chem = await (await api.post(url('/api/chemicals'), { data: { name: `E2E dash acid ${tag}`, defaultUnit: 'gal', price: 4.25, priceUnit: 'gal' } })).json();
    chemicals.push(chem._id);
    const t = (h) => new Date(Date.now() - h * 3600_000).toISOString();
    const today = new Date();
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const longAgo = ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 45));
    const pkg = (extra) => ({ packageId: crypto.randomUUID(), createdAt: t(0), ...extra });
    await api.post(url('/api/sync/package'), {
      data: pkg({ poolId: pool._id, visit: { _id: crypto.randomUUID(), poolId: pool._id, visitedAt: t(2), createdAt: t(2), updatedAt: t(2), readings: { fc: 0.4, ph: 7.5 }, doses: [{ chemicalId: chem._id, amount: 2, unit: 'gal', cost: 8.5 }], timeLog: { segments: [{ start: t(2), end: t(1) }], finished: true } } }),
    });
    await api.post(url('/api/sync/package'), {
      data: pkg({
        invoices: [{ _id: crypto.randomUUID(), customerId: c._id, number: 99000 + Math.floor(Math.random() * 999), period: longAgo.slice(0, 7), issueDate: longAgo, dueDate: longAgo, lines: [{ _id: crypto.randomUUID(), description: 'Monthly', amount: 200 }], status: 'sent', sentAt: longAgo, payments: [{ _id: crypto.randomUUID(), date: ymd(today), amount: 75, method: 'check' }], createdAt: t(0), updatedAt: t(0) }],
      }),
    });
    await api.post(url('/api/issues'), { data: { poolId: pool._id, title: `E2E dash leak ${tag}`, urgent: true, important: true } });
    // Let the dashboard sync it all down.
    await openDash();
    const f1 = await waitFor(async () => {
      await page.locator('[data-test=card-chemicals] [aria-label=Refresh]').click();
      await page.waitForTimeout(1500);
      const f = await figures();
      return near(f.owed - f0.owed, 125) && near(f.chem - f0.chem, 8.5) ? f : null;
    }, 45000);
    if (!f1) throw new Error(`figures did not follow: before ${JSON.stringify(f0)}, now ${JSON.stringify(await figures())}`);
    if (!near(f1.profit - f0.profit, 75) || f1.today - f0.today !== 1 || f1.doNow - f0.doNow !== 1) throw new Error(`figures: before ${JSON.stringify(f0)}, after ${JSON.stringify(f1)}`);
    const overdue = (await page.locator('[data-test=owed-overdue]').innerText()).replace(/\s+/g, ' ');
    if (!/overdue/.test(overdue) || /Nothing/.test(overdue)) throw new Error(`overdue line: ${overdue}`);
    ok(`figures follow the data: owed +$125 (overdue), profit +$75, chemicals +$8.50, today's stops +1, do now +1`);

    // ---- 3. Size
    const cardBody = (id) => page.locator(`[data-test=card-${id}]`);
    const setSize = async (id, s) => {
      await page.locator(`[data-test=card-size-${id}]`).click();
      await page.locator(`[data-test=size-${id}-${s}]`).click();
      await page.waitForTimeout(700);
    };
    await setSize('owed', 's');
    if (await cardBody('owed').locator('svg').count()) throw new Error('a small owed card should show figures only');
    await setSize('owed', 'l');
    await cardBody('owed').locator('svg').first().waitFor();
    await cardBody('owed').locator('[data-test=owed-list]').getByText(`E2E dash ${tag}`).waitFor();
    const owedRow = (await cardBody('owed').locator('[data-test=owed-list] tr', { hasText: `E2E dash ${tag}` }).innerText()).replace(/\s+/g, ' ');
    if (!/\b45\b/.test(owedRow)) throw new Error(`owed list should say 45 days late: ${owedRow}`);
    await setSize('hourly', 'xl');
    await cardBody('hourly').locator('[data-test=hourly-table]').getByText(`E2E dash ${tag}`).waitFor({ timeout: 20000 });
    const savedSize = await waitFor(async () => {
      const l = await serverLayout();
      const owed = l?.dashboard?.cards?.find((x) => x.id === 'owed');
      const hourly = l?.dashboard?.cards?.find((x) => x.id === 'hourly');
      return owed?.size === 'l' && hourly?.size === 'xl' ? l : null;
    });
    if (!savedSize) throw new Error('sizes not saved on the server');
    await page.screenshot({ path: `${out}/dash-sizes.png` });
    ok('Small shows figures only; Large adds the chart and who owes ("45 days late"); Full width per-hour table lists the test customer; sizes saved on the server');

    // ---- 4. Hide, show, move, drag
    await page.locator('[data-test=card-hide-issues]').click();
    await page.locator('[data-test=cell-issues]').waitFor({ state: 'detached' });
    await page.locator('[data-test=dash-cards]').click();
    await page.locator('[data-test=dash-show-issues]').click();
    await page.keyboard.press('Escape');
    await page.locator('[data-test=cell-issues]').waitFor();
    await page.locator('[data-test=card-size-money]').click();
    await page.locator('[data-test=move-money-up]').click();
    if ((await order())[0] !== 'money') throw new Error(`Move earlier: ${await order()}`);
    // Drag "Today & this week" (now second) onto Money (first): both near the top, no scrolling mid-drag.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('[data-test=card-week] .dash-head').dragTo(page.locator('[data-test=card-money] .dash-body'));
    const afterDrag = await order();
    if (afterDrag[0] !== 'week' || afterDrag[1] !== 'money') throw new Error(`drag: ${afterDrag}`);
    const savedOrder = await waitFor(async () => {
      const l = await serverLayout();
      const ids = (l?.dashboard?.cards ?? []).filter((x) => !x.hidden).map((x) => x.id);
      return ids.join() === afterDrag.join() ? ids : null;
    });
    if (!savedOrder) throw new Error('order not saved on the server');
    ok(`hide and show again (Cards menu); Move earlier; drag and drop → ${afterDrag.join(', ')}; saved`);

    // ---- 5. Full screen
    await page.locator('[data-test=card-full-money]').click();
    await page.locator('[data-test=dash-fullscreen] [data-test=money-table]').waitFor();
    await page.locator('[data-test=dash-fullscreen] svg').first().waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/dash-fullscreen.png` });
    await page.locator('[data-test=dash-fullscreen-close]').click();
    await page.locator('[data-test=dash-fullscreen]').waitFor({ state: 'detached' });
    ok('full screen: money chart with its 12-month table; closes');

    // ---- 6. Another device
    const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
    const phone = await phoneCtx.newPage();
    phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
    await login(phone);
    await openDash(phone);
    const phoneOrder = await waitFor(async () => {
      const o = await order(phone);
      return o.join() === afterDrag.join() ? o : null;
    }, 20000);
    if (!phoneOrder) throw new Error(`phone order ${await order(phone)} vs ${afterDrag}`);
    const xs = await phone.locator('[data-test=dash-grid] > .dash-cell').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))]);
    if (xs.length !== 1) throw new Error(`phone should show one column, got x positions ${xs}`);
    await phone.screenshot({ path: `${out}/dash-phone.png` });
    await phoneCtx.close();
    ok('a phone (fresh device) gets the same layout, in one column');

    // ---- 7. New cards and full-screen tools
    for (const id of ['water', 'pipeline', 'visitTimes', 'mileage', 'equipment', 'system']) await page.locator(`[data-test=card-${id}]`).waitFor();
    await page.locator('[data-test=system-summary]').waitFor();
    const openFull = async (id) => {
      await page.locator(`[data-test=card-full-${id}]`).scrollIntoViewIfNeeded();
      await page.locator(`[data-test=card-full-${id}]`).click();
      await page.locator('[data-test=dash-tools]').waitFor();
    };
    const fs = page.locator('[data-test=dash-fullscreen]');
    const pickCustomer = async () => {
      await fs.locator('.q-field', { has: page.locator('[data-test=tool-customer]') }).click();
      await page.locator('[data-test=tool-customer]').fill(tag);
      await page.getByRole('option', { name: `E2E dash ${tag}` }).click();
    };
    const closeFull = async () => {
      await page.locator('[data-test=dash-fullscreen-close]').click();
      await fs.waitFor({ state: 'detached' });
    };
    // Chemicals for the test customer only: exactly its $8.50.
    await openFull('chemicals');
    await pickCustomer();
    await fs.locator('[data-test=chem-table]').getByText(`E2E dash acid ${tag}`).waitFor({ timeout: 20000 });
    if ((await fs.locator('[data-test=chem-month]').innerText()).trim() !== '$8.50') throw new Error(`chemicals for the customer: ${await fs.locator('[data-test=chem-month]').innerText()}`);
    await fs.locator('.q-field', { has: page.locator('[data-test=tool-range]') }).click();
    await page.getByRole('option', { name: 'Last 3 months' }).click();
    await fs.locator('[data-test=chem-table] th', { hasText: '3 months' }).waitFor();
    await fs.locator('[data-test=tool-format]').getByRole('button', { name: '$1.2k' }).click();
    if ((await fs.locator('[data-test=chem-month]').innerText()).trim() !== '$9') throw new Error(`short format: ${await fs.locator('[data-test=chem-month]').innerText()}`);
    await fs.locator('[data-test=tool-columns]').click();
    await page.locator('.q-menu .q-item', { hasText: 'This month' }).click();
    await page.keyboard.press('Escape');
    if (await fs.locator('[data-test=chem-table] th', { hasText: 'This month' }).count()) throw new Error('"This month" column should be hidden');
    await fs.locator('[data-test=tool-export]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-test=tool-export-csv]').click()]);
    const csv = require('fs').readFileSync(await download.path(), 'utf8');
    if (!csv.includes(`E2E dash acid ${tag},8.5`) || csv.includes('This month') || !/^chemical-costs-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename())) throw new Error(`csv ${download.suggestedFilename()}: ${csv}`);
    await page.screenshot({ path: `${out}/dash-tools.png` });
    await closeFull();
    // Water problems: the test pool's last visit had FC 0.4.
    await openFull('water');
    await pickCustomer();
    const water = (await fs.locator('[data-test=water-table]').innerText({ timeout: 20000 })).replace(/\s+/g, ' ');
    if (!water.includes(`E2E dash ${tag}`) || !water.includes('FC 0.4 (low)')) throw new Error(`water table: ${water}`);
    await closeFull();
    // Equipment age: the 10-year-old pump.
    await openFull('equipment');
    await pickCustomer();
    const eq = (await fs.locator('[data-test=equipment-table] tbody tr').first().innerText()).replace(/\s+/g, ' ');
    if (!eq.includes(`E2E-${tag}`) || !/\b(9|10)\.\d\b/.test(eq)) throw new Error(`equipment row: ${eq}`);
    await closeFull();
    // Visit times for the test customer: one 60-minute visit.
    await openFull('visitTimes');
    await pickCustomer();
    await fs.locator('[data-test=visit-times-avg]', { hasText: '60 min' }).waitFor({ timeout: 20000 });
    await closeFull();
    ok('new cards show; full screen: customer filter (chemicals $8.50), period (3 months), $1.2k format, hidden column, CSV export; water problems FC 0.4 (low); 10-year-old pump; 60-min visit');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    // Put the owner's layout back as it was (or none).
    const now = new Date(Date.now() + 1000).toISOString();
    const restore = savedLayout
      ? { ...savedLayout, updatedAt: now, deletedAt: null }
      : { _id: DASH, dashboard: { cards: [] }, createdAt: now, updatedAt: now, deletedAt: now };
    delete restore.syncedAt;
    delete restore.__v;
    await api.post(url('/api/sync/package'), { data: { packageId: crypto.randomUUID(), createdAt: now, settings: [restore] } }).catch(() => undefined);
    for (const id of customers) {
      for (const i of await getJson(`/invoices?customerId=${id}`).catch(() => [])) await api.delete(url(`/api/invoices/${i._id}`)).catch(() => undefined);
      await api.delete(url(`/api/customers/${id}`)).catch(() => undefined);
    }
    for (const id of chemicals) await api.delete(url(`/api/chemicals/${id}`)).catch(() => undefined);
    console.log(`  (test customer, pool, issue, chemical and invoice hidden; dashboard layout ${savedLayout ? 'restored' : 'back to the usual'})`);
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
