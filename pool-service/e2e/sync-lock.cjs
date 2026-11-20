// Sync can't get stuck (Nov 2026), phone size:
//  1. Another tab holds the sync lock forever (like a tab Chrome paused mid-upload):
//     a visit saved in this tab still reaches the server, after ~90 s.
//  2. An upload that never gets a reply gives up after 60 s ("Timed out" on the Sync
//     screen) and goes through on the next try.
// Creates its own "E2E test …" customer and hides it at the end. Takes about 4 minutes.
//
//   node sync-lock.cjs <baseUrl> <password> <outDir>
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
  const customers = [];
  const todaysVisit = async (poolId) => {
    const visits = await (await api.get(url(`/api/pools/${poolId}/visits`))).json();
    const list = Array.isArray(visits) ? visits : visits.items ?? visits.visits ?? [];
    return list.find((v) => new Date(v.visitedAt).toDateString() === new Date().toDateString());
  };
  const waitFor = async (fn, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await new Promise((r) => setTimeout(r, 3000));
    }
  };

  try {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL || 'owner');
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();

    const tag = Date.now().toString(36);
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    const c = await (await api.post(url('/api/customers'), { data: { name: `E2E test ${tag}`, address: { line1: '9 Lock Ln', city: 'Dallas', state: 'TX', zip: '75201' } } })).json();
    customers.push(c._id);
    const pool = await (await api.post(url('/api/pools'), { data: { customerId: c._id, name: 'Pool', type: 'chlorine', volumeGal: 15000, serviceDay: day, routeOrder: 992 } })).json();

    // ---- 1. A second tab grabs the sync lock and never lets go
    const other = await ctx.newPage();
    await other.goto(url('/'), { waitUntil: 'networkidle' });
    await other.evaluate(() => {
      void navigator.locks.request('pool-sync', () => new Promise(() => {}));
    });
    await page.goto(url(`/pools/${pool._id}`), { waitUntil: 'networkidle' });
    const current = page.locator('[data-test=current-visit]');
    await current.locator('[data-test=reading-filterPsi]').fill('17');
    await page.locator('button[data-test=save-visit]').click();
    await page.locator('div[data-test=save-visit]').waitFor({ timeout: 20000 });
    const t0 = Date.now();
    await page.waitForTimeout(20000);
    if (await todaysVisit(pool._id)) throw new Error('visit uploaded while the other tab held the lock (test setup is wrong)');
    const v1 = await waitFor(() => todaysVisit(pool._id), 150000);
    if (!v1 || v1.readings.filterPsi !== 17) throw new Error(`visit never reached the server while another tab held the lock: ${JSON.stringify(v1)}`);
    ok(`other tab holds the sync lock: visit still uploaded after ${Math.round((Date.now() - t0) / 1000)} s`);
    await other.close();

    // ---- 2. An upload that never gets a reply
    await ctx.route('**/api/sync/package', () => {}); // swallow: no reply ever (context-wide, so the service worker can't bypass it)
    await current.locator('[data-test=reading-filterPsi]').fill('19');
    await page.locator('button[data-test=save-visit]').click();
    await page.locator('div[data-test=save-visit]').waitFor({ timeout: 20000 });
    // Stay on this screen (a reload would cancel the upload); read the phone's outbox directly.
    const lastError = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open('pool-service');
            open.onsuccess = () => {
              const all = open.result.transaction('outbox').objectStore('outbox').getAll();
              all.onsuccess = () => resolve(all.result.map((r) => r.lastError ?? '').join('|'));
            };
          }),
      );
    if (!(await waitFor(async () => /Timed out/.test(await lastError()), 150000))) throw new Error(`upload never timed out: "${await lastError()}"`);
    await page.goto(url('/more/sync'));
    const row = page.locator('[data-test=outbox-row]').first();
    await row.filter({ hasText: /Timed out/ }).waitFor({ timeout: 20000 }).catch(async (e) => {
      await page.screenshot({ path: `${out}/sync-debug.png` });
      throw new Error(`${e.message.split('\n')[0]} · screen: ${(await page.locator('main, .q-page').first().innerText()).replace(/\s+/g, ' ').slice(0, 300)}`);
    });
    await page.screenshot({ path: `${out}/sync-timed-out.png` });
    ok(`hung upload gives up: "${(await row.innerText()).replace(/\s+/g, ' ').trim()}"`);

    await ctx.unroute('**/api/sync/package');
    await page.locator('[data-test=sync-now]').click();
    const v2 = await waitFor(async () => {
      const v = await todaysVisit(pool._id);
      return v && v.readings.filterPsi === 19 ? v : null;
    }, 60000);
    if (!v2) throw new Error('timed-out change did not upload on retry');
    await page.getByText('Nothing waiting').waitFor({ timeout: 20000 });
    ok('after the time-out: Sync now uploads it (filter PSI 19 on the server), nothing waiting');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    for (const id of customers) await api.delete(url(`/api/customers/${id}`)).catch(() => undefined);
    if (customers.length) console.log('  (test customer and everything under it hidden)');
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
