// Airplane-mode test (Phase 4), phone size:
//  1. Load the app online (installs the service worker and the phone's copy of the data).
//  2. Go offline, reload: the app still opens and shows the route.
//  3. Log 3 pools offline: timer + readings, an issue with a photo, checkmarks, a note.
//  4. Nothing reaches the server while offline; the outbox survives a reload.
//  5. Back online: everything uploads within 60 s, exactly once.
//  6. Lost reply: the server applies a package but the phone never hears back;
//     the retry is recognised as a duplicate (no double records).
// Creates its own "E2E test …" customer and deletes it at the end.
//
//   node offline.cjs <baseUrl> <password> <outDir>
const { chromium, devices } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const api = ctx.request; // Node-side requests with the same login cookie; not affected by setOffline
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  const chip = () => page.locator('[data-test=sync-chip]');
  const waitChip = (re, timeout = 30000) => chip().filter({ hasText: re }).waitFor({ timeout });
  const getJson = async (p) => (await api.get(url(`/api${p}`))).json();
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let customerId;

  try {
    // ---- 1. Online: log in, test data, service worker, local copy
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();
    if ((await getJson('/visits/active')).length) throw new Error('a real visit timer is running; stop it first so this test does not touch it');

    const today = days[new Date().getDay()];
    const tag = Date.now().toString(36);
    const cust = await (await api.post(url('/api/customers'), { data: { name: `E2E test ${tag}`, address: { line1: '9 Dead Zone Rd', city: 'Dallas', state: 'TX', zip: '75201' } } })).json();
    customerId = cust._id;
    const pools = [];
    for (const [i, name] of ['Pool A', 'Pool B', 'Pool C'].entries()) {
      pools.push(await (await api.post(url('/api/pools'), { data: { customerId, name, type: 'chlorine', volumeGal: 12000, serviceDay: today, routeOrder: 900 + i } })).json());
    }
    const [A, B, C] = pools;

    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle' }); // now controlled by the service worker
    for (const p of pools) await page.locator(`[data-test=route-row-${p._id}]`).waitFor({ timeout: 20000 });
    await waitChip(/Synced/);
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (!controlled) throw new Error('service worker is not controlling the page');
    ok('online: logged in, 3 test pools on the phone, service worker installed');

    // ---- 2. Airplane mode: the app still opens
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    for (const p of pools) await page.locator(`[data-test=route-row-${p._id}]`).waitFor({ timeout: 20000 });
    await waitChip(/Offline/);
    await shot('o1-offline-route');
    ok('offline: app reopens from the phone and shows the route');

    // ---- 3. Field work with no signal
    // Pool A: timer + readings, saved
    await page.locator(`[data-test=open-${A._id}]`).click();
    await page.locator('[data-test=timer-start]').click();
    await page.locator('[data-test=reading-fc]').fill('3.2');
    await page.locator('[data-test=reading-ph]').fill('7.6');
    await page.locator('[data-test=timer-stop]').click();
    await page.locator('[data-test=timer-reopen]').waitFor();
    // Stop saves the whole visit (readings included) on the phone
    await page.locator('[data-test=save-visit]').filter({ hasText: /Saved/ }).waitFor();
    await shot('o2-offline-visit');

    // Pool B: issue with a photo + done toggle
    await page.goto(url(`/pools/${B._id}`), { waitUntil: 'domcontentloaded' });
    await page.locator('[data-test=done-toggle]').click();
    await page.locator('[data-test=add-issue]').click();
    await page.locator('[data-test=issue-title]').fill('Pump leaking (offline)');
    const jpeg = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 2000;
      c.height = 1500;
      const g = c.getContext('2d');
      g.fillStyle = '#c0392b';
      g.fillRect(0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of buf) s += String.fromCharCode(b);
      return btoa(s);
    });
    await page.locator('[data-test=photo-input]').setInputFiles({ name: 'leak.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
    await page.locator('[data-test=issue-photo]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-test=issue-save]').click();
    await page.getByText('Issue added').waitFor();

    // Pool C: checkmark on Route, readings + note, leave the screen (auto-saves)
    await page.locator('[data-test=tab-route]').click();
    await page.locator(`[data-test=done-${C._id}]`).click();
    await page.locator(`[data-test=open-${C._id}]`).click();
    await page.locator('[data-test=reading-ph]').fill('7.4');
    await page.locator('[data-test=visit-note]').fill('Logged with no signal');
    await page.locator('[data-test=back]').click();
    await page.locator('[data-test=done-count]').waitFor();
    await waitChip(/Offline · \d+/);
    const waiting = Number((await chip().innerText()).match(/(\d+)/)[1]);
    await shot('o3-offline-waiting');
    ok(`offline work saved on the phone: ${waiting} changes waiting (chip "${(await chip().innerText()).trim()}")`);

    // ---- 4. Nothing on the server yet; outbox survives a reload
    const before = await Promise.all(pools.map((p) => getJson(`/pools/${p._id}/visits?limit=5`)));
    if (before.some((v) => v.length)) throw new Error('visits reached the server while offline?');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitChip(new RegExp(`Offline · ${waiting}`));
    ok('server has nothing yet; the waiting changes survive closing/reopening the app');

    // ---- 5. Signal returns
    const t0 = Date.now();
    await ctx.setOffline(false);
    await waitChip(/Synced/, 60000);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const [va, vb, vc] = await Promise.all(pools.map((p) => getJson(`/pools/${p._id}/visits?limit=5`)));
    if (va.length !== 1 || va[0].readings.fc !== 3.2 || va[0].timeLog?.finished !== true) throw new Error(`pool A visit wrong: ${JSON.stringify(va)}`);
    if (vc.length !== 1 || vc[0].readings.ph !== 7.4 || vc[0].notes !== 'Logged with no signal') throw new Error(`pool C visit wrong: ${JSON.stringify(vc)}`);
    if (vb.length !== 0) throw new Error('pool B should have no visit');
    const issues = await getJson(`/issues?poolId=${B._id}`);
    if (issues.length !== 1 || issues[0].photoIds.length !== 1) throw new Error(`pool B issue wrong: ${JSON.stringify(issues)}`);
    const thumb = await api.get(url(`/api/photos/${issues[0].photoIds[0]}/thumb`));
    if (thumb.status() !== 200) throw new Error('uploaded photo has no thumbnail');
    const serverPools = await getJson(`/pools?customerId=${customerId}`);
    const done = Object.fromEntries(serverPools.map((p) => [p.name, p.week.done]));
    if (!done['Pool B'] || !done['Pool C'] || done['Pool A']) throw new Error(`checkmarks wrong: ${JSON.stringify(done)}`);
    await shot('o4-back-online');
    ok(`back online: everything uploaded in ${secs}s — 2 visits, 1 issue + photo (thumbnail made), 2 checkmarks, each exactly once`);

    // ---- 6. Lost reply → retry → server says duplicate, nothing doubled
    let dropped = 0;
    // context.route also sees requests made while a service worker controls the page.
    await ctx.route('**/api/sync/package', async (route) => {
      if (dropped === 0) {
        dropped++;
        await route.fetch(); // the server receives and applies it…
        return route.abort('connectionreset'); // …but the phone never gets the answer
      }
      return route.continue();
    });
    await page.goto(url(`/pools/${A._id}/overview`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=note-input]').fill('Retry-safety note');
    await page.locator('[data-test=note-add]').click();
    await page.locator('[data-test=note-row]').filter({ hasText: 'Retry-safety note' }).waitFor();
    await chip().filter({ hasNotText: /Synced/ }).waitFor({ timeout: 10000 }).catch(() => undefined);
    await waitChip(/Synced/, 60000);
    await ctx.unroute('**/api/sync/package');
    const notes = (await getJson(`/notes?parentType=pool&parentId=${A._id}`)).filter((n) => n.body === 'Retry-safety note');
    if (dropped !== 1 || notes.length !== 1) throw new Error(`expected 1 note after a dropped reply, got ${notes.length} (dropped=${dropped})`);
    ok('lost reply: the phone retried, the server recognised the repeat, the note exists once');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    await ctx.setOffline(false).catch(() => undefined);
    if (customerId) {
      await api.delete(url(`/api/customers/${customerId}`)).catch(() => undefined); // hides pools and everything under them
      console.log('  (test customer, pools, visits, issue, photo and notes hidden)');
    }
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
