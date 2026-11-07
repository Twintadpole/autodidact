// Phone-size end-to-end test of Segment D: visit timer (start/pause/resume/stop,
// editing times, history) and issue photos (upload, Save to pool, pool gallery).
// Creates its own "E2E test …" customer and deletes it at the end.
//
//   node segment-d.cjs <baseUrl> <password> <outDir>
const { chromium, devices } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let customerId;

  try {
    // Login
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();

    // Never touch a real running timer on the live site.
    const running = await page.evaluate(async () => (await (await fetch('/api/visits/active')).json()).length);
    if (running) throw new Error(`a real visit timer is running (${running}); stop it first so this test doesn't pause it`);

    // Test customer + pool on today's route (via the API, to keep this test about the new features)
    const ids = await page.evaluate(async (day) => {
      const j = (r) => r.json();
      const post = (path, body) => fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j);
      const c = await post('/customers', { name: `E2E test ${Date.now().toString(36)}`, address: { line1: '1 Timer Rd', city: 'Dallas', state: 'TX', zip: '75201' } });
      const p = await post('/pools', { customerId: c._id, name: 'Backyard', type: 'chlorine', volumeGal: 12000, serviceDay: day });
      return { customerId: c._id, poolId: p._id };
    }, days[new Date().getDay()]);
    customerId = ids.customerId;
    const { poolId } = ids;
    ok('logged in; test customer and pool created');

    // Timer: start → shows on Route → pause → resume → stop
    await page.goto(url(`/pools/${poolId}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=timer-start]').click();
    await page.getByText('Timer started').waitFor();
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.locator(`[data-test=running-${poolId}]`).waitFor();
    const chip = await page.locator(`[data-test=running-${poolId}]`).innerText();
    await shot('d1-route-timer');
    ok(`timer started; Route shows it running (${chip.trim()})`);

    await page.goto(url(`/pools/${poolId}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=timer-pause]').click();
    await page.getByText('Timer paused').waitFor();
    await page.locator('[data-test=timer-resume]').click();
    await page.getByText('Timer resumed').waitFor();
    await page.locator('[data-test=timer-stop]').click();
    await page.getByText('Timer stopped').waitFor();
    const state = await page.locator('[data-test=timer-state]').innerText();
    if (!/1 pause/.test(state)) throw new Error(`expected 1 pause in "${state}"`);
    ok(`pause → resume → stop (${state.trim()})`);

    // Reload: stopped timer persisted; no longer running on Route
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-test=timer-reopen]').waitFor();
    ok('reload: stopped timer was saved on the server');

    // Edit times: move the first start 30 minutes earlier
    await page.locator('[data-test=timer-edit]').click();
    const startInput = page.locator('[data-test=time-start-0]');
    const original = await startInput.inputValue();
    const d = new Date(original);
    d.setMinutes(d.getMinutes() - 30);
    const pad = (n) => String(n).padStart(2, '0');
    const earlier = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    await startInput.fill(earlier);
    // An impossible edit is refused…
    await page.locator('[data-test=time-end-0]').fill(earlier.replace(/T\d\d:\d\d$/, 'T00:00'));
    await page.locator('[data-test=time-save]').click();
    await page.locator('[data-test=time-error]').waitFor();
    // …a valid one is saved
    await page.locator('[data-test=time-end-0]').fill(original);
    await page.locator('[data-test=time-start-0]').fill(earlier);
    await shot('d2-edit-times');
    await page.locator('[data-test=time-save]').click();
    await page.getByText('Times updated').waitFor();
    const elapsed = await page.locator('[data-test=timer-elapsed]').innerText();
    if (!/^(29|30|31):\d\d$/.test(elapsed.trim())) throw new Error(`expected about 30 minutes, got ${elapsed}`);
    ok(`times edited (start moved 30 min earlier → ${elapsed.trim()}); bad edit rejected`);

    // History shows the change
    await page.locator('[data-test=timer-history]').click();
    await page.locator('[data-test=history-entry]').first().waitFor();
    const hist = await page.locator('[data-test=history-dialog]').innerText();
    if (!/Times:/.test(hist)) throw new Error('history should list the time edit');
    await shot('d3-history');
    await page.keyboard.press('Escape');
    ok(`edit history recorded (${await page.locator('[data-test=history-entry]').count()} entries)`);

    // Issue with a photo
    await page.locator('[data-test=add-issue]').click();
    await page.locator('[data-test=issue-title]').fill('Cracked coping stone');
    const jpeg = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 2400;
      c.height = 1600;
      const g = c.getContext('2d');
      g.fillStyle = '#4a90c2';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff';
      g.font = '200px sans-serif';
      g.fillText('E2E', 900, 900);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of buf) s += String.fromCharCode(b);
      return btoa(s);
    });
    await page.locator('[data-test=photo-input]').setInputFiles({ name: 'crack.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
    await page.locator('[data-test=issue-photo]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-test=photo-save-to-pool]').first().click();
    await shot('d4-issue-photo');
    await page.locator('[data-test=issue-save]').click();
    await page.getByText('Issue added').waitFor();
    const meta = await page.evaluate(async (pid) => (await (await fetch(`/api/photos?poolId=${pid}`)).json())[0], poolId);
    if (!meta || Math.max(meta.width, meta.height) > 1600) throw new Error(`photo should be shrunk to ≤1600 px, got ${meta?.width}x${meta?.height}`);
    ok(`issue saved with a photo (shrunk on the phone to ${meta.width}×${meta.height}, ${Math.round(meta.bytes / 1024)} KB), marked Save to pool`);

    // Pool gallery on the overview
    await page.goto(url(`/pools/${poolId}/overview`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=gallery-photo]').first().waitFor();
    await page.locator('[data-test=gallery-photo]').first().scrollIntoViewIfNeeded();
    await shot('d5-gallery');
    await page.locator('[data-test=gallery-photo]').first().click();
    await page.locator('[data-test=photo-viewer]').waitFor();
    const loaded = await page.locator('[data-test=photo-viewer] img').evaluate((img) => img.complete && img.naturalWidth > 0);
    if (!loaded) throw new Error('full-size photo did not load');
    await page.keyboard.press('Escape');
    ok('photo appears in the pool gallery and opens full size');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    // Clean up the test customer and pool
    if (customerId) {
      await page.evaluate(async (cid) => {
        const pools = await (await fetch(`/api/pools?customerId=${cid}`)).json();
        for (const p of pools) {
          for (const i of await (await fetch(`/api/issues?poolId=${p._id}`)).json()) await fetch(`/api/issues/${i._id}`, { method: 'DELETE' });
          for (const ph of await (await fetch(`/api/photos?poolId=${p._id}`)).json()) await fetch(`/api/photos/${ph._id}`, { method: 'DELETE' });
          await fetch(`/api/pools/${p._id}`, { method: 'DELETE' });
        }
        await fetch(`/api/customers/${cid}`, { method: 'DELETE' });
      }, customerId);
      console.log('  (test customer and pool deleted)');
    }
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
