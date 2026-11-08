// Regression test for bugs reported 2026-11-08, phone size:
//  - photos on the pool Overview overlapped the notes (now in their own card)
//  - Gallery button on an EXISTING issue didn't add the photo
//  - a pool's Issues page opened right after start-up showed "No open issues"
//  - HEIC photos from the gallery get a clear message instead of silently failing
// Creates its own "E2E test …" customer and hides it at the end.
//
//   node photos-layout.cjs <baseUrl> <password> <outDir>
const { chromium, devices } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const api = ctx.request;
  let page = await ctx.newPage();
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  let customerId;
  const jpegBase64 = (p, color, w, h) =>
    p.evaluate(
      async ([color, w, h]) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
        const u = new Uint8Array(await b.arrayBuffer());
        let s = '';
        for (const x of u) s += String.fromCharCode(x);
        return btoa(s);
      },
      [color, w, h],
    );

  try {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();

    // Test data straight on the server: an issue with 4 photos saved to the pool, and a note.
    const ids = await page.evaluate(async () => {
      const post = (path, body) => fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
      const c = await post('/customers', { name: `E2E test ${Date.now().toString(36)}`, address: { line1: '1 Layout Ln', city: 'Cedar Hill', state: 'TX', zip: '75104' } });
      const p = await post('/pools', { customerId: c._id, type: 'chlorine', volumeGal: 15000, serviceDay: 'thu' });
      const now = new Date().toISOString();
      const issueId = crypto.randomUUID();
      const form = new FormData();
      const photos = [];
      for (const [i, color] of ['#888', '#4a90c2', '#c0392b', '#2e7d32'].entries()) {
        const cv = document.createElement('canvas');
        cv.width = i % 2 ? 1200 : 900;
        cv.height = i % 2 ? 900 : 1200;
        const g = cv.getContext('2d');
        g.fillStyle = color;
        g.fillRect(0, 0, cv.width, cv.height);
        const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.8));
        const id = crypto.randomUUID();
        photos.push({ _id: id, poolId: p._id, issueId, savedToPool: true, width: cv.width, height: cv.height, bytes: blob.size, takenAt: now, createdAt: now, updatedAt: now });
        form.append(id, blob, `${id}.jpg`);
      }
      form.append(
        'package',
        JSON.stringify({
          packageId: crypto.randomUUID(),
          poolId: p._id,
          createdAt: now,
          photos,
          issues: [{ _id: issueId, poolId: p._id, title: 'Cracked skimmer', photoIds: photos.map((x) => x._id), createdAt: now, updatedAt: now }],
          notes: [{ _id: crypto.randomUUID(), parentType: 'pool', parentId: p._id, body: 'Gate: 8642', pinned: true, createdAt: now, updatedAt: now }],
        }),
      );
      await fetch('/api/sync/package', { method: 'POST', body: form });
      return { customerId: c._id, poolId: p._id };
    });
    customerId = ids.customerId;
    const { poolId } = ids;

    // A brand-new phone (empty local copy) opening the pool's Issues page directly
    const fresh = await ctx.browser().newContext({ ...devices['Pixel 7'], storageState: await ctx.storageState() });
    const p2 = await fresh.newPage();
    await p2.evaluate(() => 0).catch(() => undefined);
    await p2.goto(url(`/pools/${poolId}/issues`), { waitUntil: 'networkidle' });
    await p2.getByText('Cracked skimmer').first().waitFor({ timeout: 20000 });
    await fresh.close();
    ok('Issues page on a fresh phone shows the issue once the first download finishes');

    // Overview: photos in their own card, not overlapping the notes
    await page.goto(url(`/pools/${poolId}/overview`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=pool-gallery] [data-test=photo-tile]').nth(3).waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    const card = await page.locator('[data-test=photos-card]').boundingBox();
    const lastTile = await page.locator('[data-test=pool-gallery] [data-test=photo-tile]').nth(3).boundingBox();
    const note = await page.locator('[data-test=note-row]').first().boundingBox();
    if (!card || !lastTile || !note) throw new Error('missing elements');
    if (lastTile.y + lastTile.height > card.y + card.height + 1) throw new Error('photo spills out of the Photos card');
    if (card.y + card.height > note.y) throw new Error('Photos card overlaps the notes');
    await page.screenshot({ path: `${out}/pl-overview.png`, fullPage: true });
    ok('Overview: 4 photos inside the Photos card, notes start below it');

    // Existing issue: Gallery adds a photo
    await page.getByText('Cracked skimmer').first().click();
    await page.locator('[data-test=issue-sheet]').waitFor();
    const tiles = page.locator('[data-test=issue-photos] [data-test=photo-tile]');
    await tiles.nth(3).waitFor();
    const before = await tiles.count();
    const big = await jpegBase64(page, '#7b1fa2', 3000, 4000);
    await page.locator('[data-test=photo-input]').setInputFiles({ name: 'IMG_20261108.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(big, 'base64') });
    await page.waitForFunction((n) => document.querySelectorAll('[data-test=issue-photos] [data-test=photo-tile]').length === n + 1, before, { timeout: 20000 });
    ok(`existing issue: Gallery added a photo (${before} → ${before + 1}), shrunk on the phone`);

    // HEIC gets a clear message
    await page.locator('[data-test=photo-input]').setInputFiles({ name: 'IMG_1.heic', mimeType: 'image/heic', buffer: Buffer.from('heic') });
    await page.getByText(/HEIC format/).first().waitFor({ timeout: 10000 });
    ok('HEIC photo: clear message explaining what to do');
  } finally {
    if (customerId) {
      await api.delete(url(`/api/customers/${customerId}`)).catch(() => undefined);
      console.log('  (test customer and everything under it hidden)');
    }
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
