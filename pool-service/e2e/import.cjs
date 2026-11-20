// GPF item 2: customer & pool import, desktop view at 1440×900. Safe next to real data: every
// customer in the file is named "E2E test import <tag> …", the import is undone at the end, and
// whatever is left of this run's customers is hidden.
//  1. Customers → Import opens the page; the blank template downloads.
//  2. A CSV is read: columns are guessed, one is changed to Ignore.
//  3. Preview: 1 new customer (two rows → two pools), 1 existing customer to update, 1 difference.
//  4. "Use file" on the difference, Import: the new customer has its 2 pools, the existing one is
//     filled in (email, phone, notes) and gets the file's rate.
//  5. The new customer shows in the Customers table (synced to this device).
//  6. Past imports lists it; Undo hides the new customer and puts the old values back.
//
//   node import.cjs <baseUrl> <password> <outDir>
const { chromium } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const api = ctx.request;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const tag = Date.now().toString(36);
  const NEW = `E2E test import ${tag} New`;
  const OLD = `E2E test import ${tag} Old`;
  const getJson = async (p) => (await api.get(url(`/api${p}`))).json();
  const field = (name) => page.locator('.q-field', { has: page.locator(`[data-test=${name}]`) });
  const mine = async () => (await getJson('/customers')).filter((c) => c.name.includes(`E2E test import ${tag}`));

  try {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    if (await page.getByLabel('Password').isVisible().catch(() => false)) {
      await page.getByLabel('Password').fill(password);
      await page.locator('[data-test=login]').click();
    }
    await page.locator('[data-test=done-count]').waitFor();
    // An existing customer the file will update (rate 100, no email).
    const made = await api.post(url('/api/customers'), { data: { name: OLD, address: { line1: '40 Test Way' }, monthlyRate: 100, notes: 'Already here' } });
    if (made.status() !== 201) throw new Error(`could not make the existing customer: ${made.status()}`);
    const oldId = (await made.json())._id;

    // ---- 1. Page and template
    await page.evaluate(() => localStorage.setItem('pool:view', 'desk'));
    await page.goto(url('/desk/customers'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=desk-customer-import]').click();
    await page.waitForURL(/\/desk\/import$/);
    await page.locator('[data-test=import-sync-hint]').waitFor();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-test=import-template]').click()]);
    const tpl = require('fs').readFileSync(await dl.path(), 'utf8');
    if (!tpl.includes('Customer name,Phone,Email,Street')) throw new Error(`template: ${tpl.slice(0, 80)}`);
    ok('Customers → Import opens the page, with the sync reminder; the blank template downloads');

    // ---- 2. Read a CSV
    const csv = [
      'Customer Name,Cell Phone,Email,Street,City,Pool,Gallons,Route Day,Gate Code,Rate,Favorite color',
      `${NEW},214-555-0191,new.${tag}@example.com,41 Test Way,Dallas,Front,"12,000",Monday,1234,$150,blue`,
      `${NEW},214-555-0191,,41 Test Way,Dallas,Spa,500,Monday,,,`,
      `${OLD},214-555-0192,old.${tag}@example.com,40 Test Way,,,,,,$120,`,
    ].join('\n');
    await page.locator('input[type=file]').setInputFiles({ name: `import-${tag}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.locator('[data-test=import-columns]').waitFor();
    const guessed = await page.locator('[data-test=import-columns] tbody tr').allInnerTexts();
    const flat = guessed.map((t) => t.replace(/\s+/g, ' '));
    for (const [col, want] of [[0, 'Customer name'], [1, 'Phone'], [7, 'Service day'], [8, 'Access notes'], [10, 'Notes']]) {
      if (!flat[col].includes(want)) throw new Error(`column ${col} should be guessed as ${want}: ${flat[col]}`);
    }
    await field('import-map-10').click();
    await page.getByRole('option', { name: 'Ignore this column' }).click();
    await page.screenshot({ path: `${out}/import-columns.png` });
    ok('the CSV is read: columns guessed (name, phone, service day, gate code → access notes, unknown → notes); one set to Ignore');

    // ---- 3. Preview
    await page.locator('[data-test=import-preview]').click();
    const summary = page.locator('[data-test=import-summary]');
    await summary.waitFor();
    const st = (await summary.innerText()).replace(/\s+/g, ' ');
    for (const want of ['1 new customer', '1 to update', '2 new pools', '1 difference to choose']) if (!st.includes(want)) throw new Error(`summary should say "${want}": ${st}`);
    const oldBlock = page.locator(`[data-test="import-plan-${OLD}"]`);
    await oldBlock.locator('[data-test=import-conflict-monthlyRate]').waitFor();
    const conflictText = (await oldBlock.locator('[data-test=import-conflict-monthlyRate]').innerText()).replace(/\s+/g, ' ');
    if (!conflictText.includes('Keep: $100.00') || !conflictText.includes('Use file: $120.00')) throw new Error(`conflict: ${conflictText}`);
    await page.screenshot({ path: `${out}/import-preview.png`, fullPage: true });
    ok('preview: 1 new customer with 2 pools, 1 to update, 1 difference (Keep $100.00 / Use file $120.00)');

    // ---- 4. Choose and import
    await oldBlock.getByRole('button', { name: /Use file: \$120\.00/ }).click();
    await page.locator('[data-test=import-apply]').click();
    await page.locator('.q-dialog').getByRole('button', { name: 'Import' }).click();
    await page.locator('[data-test=import-done]').waitFor();
    const all = await mine();
    const n = all.find((c) => c.name === NEW);
    const o = all.find((c) => c.name === OLD);
    if (!n) throw new Error('new customer missing');
    const pools = (await getJson(`/pools?customerId=${n._id}`)).map((p) => `${p.name}/${p.volumeGal}/${p.serviceDay}`).sort();
    if (pools.join(',') !== 'Front/12000/mon,Spa/500/mon') throw new Error(`pools: ${pools}`);
    if (n.notes) throw new Error(`ignored column reached the notes: ${n.notes}`);
    if (o.monthlyRate !== 120 || o.email !== `old.${tag}@example.com` || o.phones?.[0]?.number !== '+12145550192' || o.notes !== 'Already here') throw new Error(`existing customer: ${JSON.stringify(o)}`);
    ok('imported: the new customer has Front (12,000 gal) and Spa, Monday; the existing one got email, phone and the file’s rate $120');

    // ---- 5. Shows on this device
    await page.goto(url('/desk/customers'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=table-search]').fill(tag);
    await page.locator('[data-test=desk-customers] tbody tr', { hasText: NEW }).waitFor({ timeout: 20000 });
    ok('the new customer is in the Customers table');

    // ---- 6. Undo
    await page.goto(url('/desk/import'), { waitUntil: 'networkidle' });
    const row = page.locator('[data-test=import-history] tbody tr', { hasText: `import-${tag}.csv` });
    await row.waitFor();
    await row.getByRole('button', { name: 'Undo' }).click();
    await page.locator('.q-dialog').getByRole('button', { name: 'Undo import' }).click();
    await row.getByText('Undone').waitFor();
    const after = await mine();
    if (after.some((c) => c.name === NEW)) throw new Error('new customer still there after undo');
    const o2 = after.find((c) => c.name === OLD);
    if (o2.monthlyRate !== 100 || o2.email || (o2.phones ?? []).length) throw new Error(`existing customer not put back: ${JSON.stringify(o2)}`);
    await page.screenshot({ path: `${out}/import-undone.png` });
    ok('Undo: the new customer is hidden; the existing one is back to $100, no email, no phone');
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    void oldId;
  } finally {
    for (const c of await mine().catch(() => [])) await api.delete(url(`/api/customers/${c._id}`)).catch(() => undefined);
    console.log('  (this run’s test customers hidden)');
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
