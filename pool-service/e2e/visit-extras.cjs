// Visit screen extras (Nov 2026), phone size:
//  - Filter PSI reading (no amber/red range), shown on the previous visit card
//  - separate Skimmer baskets / Pump basket tasks; old "Baskets emptied" still shows on old visits
//  - the customer's pinned notes (gate code, dog…) show above the timer; unpinned ones don't
//  - previous visit card shows its timer: start – end · pauses (length) · time on site
//  - Pause keeps each pause as a gap between time segments
// Creates its own "E2E test …" customer and hides it at the end.
//
//   node visit-extras.cjs <baseUrl> <password> <outDir>
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
    const c = await (await api.post(url('/api/customers'), { data: { name: `E2E test ${tag}`, address: { line1: '7 Gate Ln', city: 'Dallas', state: 'TX', zip: '75201' } } })).json();
    customers.push(c._id);
    const pool = await (await api.post(url('/api/pools'), { data: { customerId: c._id, name: 'Pool', type: 'chlorine', volumeGal: 15000, serviceDay: day, routeOrder: 991 } })).json();
    await api.post(url('/api/notes'), { data: { parentType: 'customer', parentId: c._id, body: 'Gate code 4321', pinned: true } });
    await api.post(url('/api/notes'), { data: { parentType: 'customer', parentId: c._id, body: 'Paid through June', pinned: false } });

    // Last week's visit, made the old way: "Baskets emptied", 9:00–9:20 then 9:25–9:40 (one 5 min pause)
    const at = new Date(Date.now() - 7 * 86400000);
    at.setHours(9, 0, 0, 0);
    const t = (min) => new Date(at.getTime() + min * 60000).toISOString();
    await api.post(url('/api/sync/package'), {
      data: {
        packageId: crypto.randomUUID(),
        poolId: pool._id,
        createdAt: t(0),
        visit: {
          _id: crypto.randomUUID(),
          poolId: pool._id,
          visitedAt: t(0),
          createdAt: t(0),
          updatedAt: t(0),
          readings: { fc: 3, filterPsi: 22 },
          doses: [],
          tasks: { brushed: true, basketsEmptied: true },
          timeLog: { segments: [{ start: t(0), end: t(20) }, { start: t(25), end: t(40) }], finished: true },
        },
      },
    });

    await page.goto(url(`/pools/${pool._id}`), { waitUntil: 'networkidle' });
    const notes = page.locator('[data-test=access-notes]');
    await notes.waitFor({ timeout: 20000 });
    const notesText = await notes.innerText();
    if (!/Gate code 4321/.test(notesText)) throw new Error(`pinned customer note missing: ${notesText}`);
    if (/Paid through June/.test(notesText)) throw new Error('unpinned note should not show on the visit screen');
    const above = await page.evaluate(() => {
      const n = document.querySelector('[data-test=access-notes]');
      const tm = document.querySelector('[data-test=visit-timer]');
      return !!(n && tm && n.compareDocumentPosition(tm) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    if (!above) throw new Error('customer notes should be above the timer');
    ok('visit screen: pinned customer note "Gate code 4321" above the timer; unpinned note hidden');

    const prev = page.locator('[data-test=previous-visit]');
    const time = (await prev.locator('[data-test=prev-duration]').innerText()).replace(/^timer\s*/, '');
    if (!/9:00 AM – 9:40 AM/.test(time) || !/1 pause \(5 min\)/.test(time) || !/35 min on site/.test(time)) throw new Error(`previous timer line wrong: "${time}"`);
    ok(`previous visit timer: "${time.trim()}"`);

    const psi = await prev.locator('[data-test=prev-reading-filterPsi]').innerText();
    if (!/22/.test(psi) || !/psi/.test(psi)) throw new Error(`previous filter PSI wrong: ${psi}`);
    const prevTasks = await prev.locator('[data-test=prev-tasks]').innerText();
    if (!/Baskets emptied/.test(prevTasks)) throw new Error(`old "Baskets emptied" should still show: ${prevTasks}`);
    ok(`previous visit: Filter PSI ${psi.replace(/\s+/g, ' ').trim()}; old task "Baskets emptied" still shown`);

    // Today's visit: Start, Pause, Resume, Stop; filter PSI; the two basket tasks
    await page.locator('[data-test=timer-start]').click();
    await page.locator('[data-test=timer-pause]').waitFor();
    await page.waitForTimeout(1200);
    await page.locator('[data-test=timer-pause]').click();
    await page.locator('[data-test=timer-resume]').waitFor();
    await page.waitForTimeout(1200);
    await page.locator('[data-test=timer-resume]').click();
    await page.locator('[data-test=timer-stop]').click();
    await page.locator('[data-test=timer-reopen]').waitFor();
    const state = await page.locator('[data-test=timer-state]').innerText();
    if (!/1 pause/.test(state)) throw new Error(`pause not kept: ${state}`);
    ok(`timer: Start → Pause → Resume → Stop keeps the pause ("${state.trim()}")`);

    const current = page.locator('[data-test=current-visit]');
    if (await current.locator('[data-test=task-basketsEmptied]').count()) throw new Error('old combined task should not be offered');
    await current.locator('[data-test=reading-filterPsi]').fill('18');
    await current.locator('[data-test=task-skimmerBaskets]').click();
    await current.locator('[data-test=task-pumpBasket]').click();
    await page.locator('button[data-test=save-visit]').click();
    await page.locator('div[data-test=save-visit]').waitFor({ timeout: 20000 });
    await page.screenshot({ path: `${out}/visit-extras.png`, fullPage: true });

    const visits = await (await api.get(url(`/api/pools/${pool._id}/visits`))).json();
    const list = Array.isArray(visits) ? visits : visits.items ?? visits.visits ?? [];
    const today = list.find((v) => new Date(v.visitedAt).toDateString() === new Date().toDateString());
    if (!today) throw new Error(`today's visit not on the server: ${JSON.stringify(visits).slice(0, 200)}`);
    if (today.readings.filterPsi !== 18) throw new Error(`filter PSI not saved: ${JSON.stringify(today.readings)}`);
    if (!today.tasks.skimmerBaskets || !today.tasks.pumpBasket) throw new Error(`basket tasks not saved: ${JSON.stringify(today.tasks)}`);
    if (today.timeLog.segments.length !== 2) throw new Error(`expected 2 time segments: ${JSON.stringify(today.timeLog)}`);
    ok('saved to server: filter PSI 18, Skimmer baskets ✓, Pump basket ✓, 2 time segments (1 pause)');

    // Pin hint on the customer screen
    await page.goto(url(`/customers/${c._id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=pin-hint]').waitFor();
    ok('customer screen: "Tap the pin to show a note on the visit screen" hint');

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
