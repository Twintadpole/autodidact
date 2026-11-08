// Alpha polish round (v0.1.0-alpha), phone size:
//  - generic "Pool" names are hidden; named pools still show
//  - Issues badge counts every open issue; red only when one is "Do now"
//  - visit history: list by date → open a visit → Older/Newer → back to the pool
//  - "Done this week" lives in the timer card; slim "Saved" line instead of a disabled button
//  - version shown on More; screens keep a readable width on a computer
// Creates its own "E2E test …" customers and hides them at the end.
//
//   node alpha-polish.cjs <baseUrl> <password> <outDir>
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

  try {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();

    const tag = Date.now().toString(36);
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    const mk = async (name, poolName) => {
      const c = await (await api.post(url('/api/customers'), { data: { name, address: { line1: '5 Polish Pl', city: 'Dallas', state: 'TX', zip: '75201' } } })).json();
      customers.push(c._id);
      const p = await (await api.post(url('/api/pools'), { data: { customerId: c._id, name: poolName, type: 'chlorine', volumeGal: 12000, serviceDay: day, routeOrder: 990 } })).json();
      return p;
    };
    const plain = await mk(`E2E test ${tag} A`, 'Pool');
    const named = await mk(`E2E test ${tag} B`, 'Backyard');

    // Three past visits on the plain pool, a week apart
    const chem = (await (await api.get(url('/api/chemicals'))).json())[0];
    const visitIds = [];
    for (const [i, weeks] of [3, 2, 1].entries()) {
      const at = new Date(Date.now() - weeks * 7 * 86400000).toISOString();
      const id = crypto.randomUUID();
      visitIds.push(id);
      await api.post(url('/api/sync/package'), {
        data: {
          packageId: crypto.randomUUID(),
          poolId: plain._id,
          createdAt: at,
          visit: {
            _id: id,
            poolId: plain._id,
            visitedAt: at,
            createdAt: at,
            updatedAt: at,
            readings: { fc: 2 + i, ph: 7.4 + i / 10 },
            doses: [{ chemicalId: chem._id, amount: 1, unit: chem.defaultUnit }],
            tasks: { brushed: true, skimmed: i === 2 },
            notes: `Visit ${i + 1}`,
            timeLog: { segments: [{ start: at, end: new Date(Date.parse(at) + (20 + i * 5) * 60000).toISOString() }], finished: true },
          },
        },
      });
    }
    // Issues: one "Schedule" (orange badge), then one "Do now" (red)
    await api.post(url('/api/issues'), { data: { poolId: named._id, title: 'Loose ladder', important: true } });

    await page.reload({ waitUntil: 'networkidle' });
    const rowA = page.locator(`[data-test=route-row-${plain._id}]`);
    const rowB = page.locator(`[data-test=route-row-${named._id}]`);
    await rowA.waitFor({ timeout: 20000 });
    const captionA = await rowA.locator('.q-item__label--caption').first().innerText();
    const captionB = await rowB.locator('.q-item__label--caption').first().innerText();
    if (/^Pool ·/.test(captionA)) throw new Error(`generic pool name should be hidden: "${captionA}"`);
    if (!/^Backyard ·/.test(captionB)) throw new Error(`named pool should show its name: "${captionB}"`);
    ok(`Route: "${captionA}" (generic name hidden) · "${captionB}"`);

    const badge = page.locator('[data-test=issues-badge]');
    const before = Number(await badge.innerText());
    const orange = await badge.evaluate((el) => el.classList.contains('bg-orange-8'));
    await api.post(url('/api/issues'), { data: { poolId: named._id, title: 'Pump grinding', urgent: true, important: true } });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction((n) => Number(document.querySelector('[data-test=issues-badge]')?.textContent) === n + 1, before, { timeout: 20000 });
    const red = await badge.evaluate((el) => el.classList.contains('bg-negative'));
    if (!red) throw new Error('badge should turn red with a Do now issue');
    ok(`Issues badge counts every open issue (${before} → ${before + 1}); ${orange ? 'orange, then ' : ''}red once one is "Do now"`);

    // Visit screen: done toggle inside the timer card, no disabled "Nothing to save" button
    await page.goto(url(`/pools/${plain._id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=visit-timer] [data-test=done-toggle]').waitFor();
    if (await page.getByText('Nothing to save yet').count()) throw new Error('old "Nothing to save yet" bar still shown');
    await page.locator('[data-test=reading-fc]').fill('3');
    await page.locator('[data-test=save-visit]').filter({ hasText: 'Save visit' }).click();
    await page.locator('[data-test=save-visit]').filter({ hasText: 'Saved' }).waitFor();
    await page.screenshot({ path: `${out}/ap-visit.png`, fullPage: true });
    ok('visit screen: "Done this week" inside the timer card; Save button only when needed, then a slim "Saved"');

    // Visit history
    await page.goto(url(`/pools/${plain._id}/overview`), { waitUntil: 'networkidle' });
    const service = await page.getByText(/· stop 990/).count();
    if (!service) throw new Error('stop number should read "· stop 990"');
    await page.locator('[data-test=all-visits]').click();
    await page.waitForURL(new RegExp(`/pools/${plain._id}/visits$`));
    await page.locator('[data-test=visit-row]').nth(3).waitFor({ timeout: 20000 });
    const rows = await page.locator('[data-test=visit-row]').count();
    await page.screenshot({ path: `${out}/ap-visits.png`, fullPage: true });
    await page.locator('[data-test=visit-row]').nth(1).click(); // the visit 1 week ago
    await page.locator('[data-test=visit-detail]').waitFor();
    const detail = await page.locator('[data-test=visit-detail]').innerText();
    if (!/Visit 3/.test(detail) || !/Brushed/.test(detail) || !/on site/.test(detail)) throw new Error(`detail missing note/tasks/time: ${detail.slice(0, 200)}`);
    await page.locator('[data-test=older-visit]').click();
    await page.waitForFunction(() => /Visit 2/.test(document.querySelector('[data-test=visit-detail]')?.textContent ?? ''));
    await page.locator('[data-test=newer-visit]').click();
    await page.waitForFunction(() => /Visit 3/.test(document.querySelector('[data-test=visit-detail]')?.textContent ?? ''));
    await page.screenshot({ path: `${out}/ap-visit-detail.png`, fullPage: true });
    await page.locator('[data-test=back-to-pool]').click();
    await page.waitForURL(new RegExp(`/pools/${plain._id}/overview$`));
    // Overview table rows open the visit too
    await page.locator('[data-test=history-row]').first().click();
    await page.waitForURL(/\/visits\/[0-9a-f-]{36}$/);
    await page.locator('[data-test=back]').click();
    await page.waitForURL(new RegExp(`/pools/${plain._id}/overview$`));
    ok(`visit history: ${rows} visits by date → detail (note, tasks, time on site) → Older/Newer → back to the pool`);

    // Version on More
    await page.goto(url('/more'), { waitUntil: 'networkidle' });
    const version = await page.locator('[data-test=app-version]').innerText();
    if (!/v0\.1\.0-alpha/.test(version)) throw new Error(`version not shown: ${version}`);
    ok(`More: "${version.trim()}"`);

    // A deployed update shows a one-tap refresh message (the service worker fires this event)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('pool:update-ready')));
    await page.getByText('New version available').waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Later' }).click();
    ok('update ready: "New version available · Refresh / Later" message appears');

    // Desktop: readable width
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    const width = await page.locator('.q-page').first().evaluate((el) => el.getBoundingClientRect().width);
    if (width > 800) throw new Error(`page too wide on desktop: ${width}px`);
    ok(`desktop: route list ${Math.round(width)} px wide, centered`);

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    for (const id of customers) await api.delete(url(`/api/customers/${id}`)).catch(() => undefined);
    if (customers.length) console.log('  (test customers and everything under them hidden)');
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
