// Phase 7A, fuller customer records (Nov 2026), phone size:
//  1. A prospect saved with just a name (no address, phone or anything else): Prospect label,
//     found under Prospects and by search, not under Current.
//  2. Billing fields (monthly rate, payment method, billing email, start date, distance from HQ)
//     saved and shown; clearing one clears it on the server too.
//  3. Making a customer Past takes their pool off the Route; Current brings it back.
//  4. A pool with no type, gallons or service day: listed under "Not scheduled", not counted.
//  5. Equipment: a pump with model, serial and a photo; an "other" item with its own name;
//     removing the pump removes its photo too.
// Creates its own "E2E test …" customers and hides them at the end.
//
//   node customer-records.cjs <baseUrl> <password> <outDir>
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
  const getJson = async (p) => (await api.get(url(`/api${p}`))).json();
  const waitFor = async (fn, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
  const serverCustomer = (id) => getJson(`/customers/${id}`);
  // Like the owner: open the customer, tap Edit (Save then goes back to the customer).
  const openEdit = async (id) => {
    await page.goto(url(`/customers/${id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=edit-customer]').click();
    await page.locator('[data-test=customer-name]').waitFor();
  };
  const tag = Date.now().toString(36);

  try {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();

    // ---- 1. Prospect with a name only
    await page.goto(url('/customers'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=customer-filter]').getByRole('button', { name: /Prospects/ }).click();
    await page.locator('[data-test=new-customer]').click();
    const prospectName = `E2E test ${tag} prospect`;
    await page.locator('[data-test=customer-name]').fill(prospectName);
    // the phone row starts empty; nothing else filled in
    await page.locator('[data-test=customer-status]').getByRole('button', { name: 'Prospect' }).click();
    await page.locator('[data-test=customer-save]').click();
    await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);
    const prospectId = page.url().split('/').pop();
    customers.push(prospectId);
    await page.locator('[data-test=customer-status-badge]').filter({ hasText: 'Prospect' }).waitFor();
    const p1 = await waitFor(async () => {
      const c = await serverCustomer(prospectId);
      return c?.name === prospectName ? c : null;
    });
    if (!p1 || p1.status !== 'prospect' || p1.address) throw new Error(`prospect not saved as expected: ${JSON.stringify(p1)}`);

    await page.goto(url('/customers'), { waitUntil: 'networkidle' });
    const filter = page.locator('[data-test=customer-filter]');
    await filter.getByRole('button', { name: /Current/ }).click();
    if (await page.locator(`[data-test=customer-${prospectId}]`).count()) throw new Error('prospect listed under Current');
    await filter.getByRole('button', { name: /Prospects/ }).click();
    await page.locator(`[data-test=customer-${prospectId}]`).waitFor();
    await filter.getByRole('button', { name: /Current/ }).click();
    await page.locator('[data-test=customer-search]').fill(`${tag} prospect`);
    await page.locator(`[data-test=customer-${prospectId}]`).waitFor();
    await page.locator(`[data-test=status-${prospectId}]`).filter({ hasText: 'Prospect' }).waitFor();
    await page.screenshot({ path: `${out}/customers-search.png` });
    ok('prospect saved with only a name (no address on the server); under Prospects, not Current; search finds it with a "Prospect" label');

    // ---- 2. A current customer with billing fields, and a pool on today's route
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    const c = await (await api.post(url('/api/customers'), { data: { name: `E2E test ${tag} current`, address: { line1: '12 Billing Rd', city: 'Dallas', state: 'TX', zip: '75201' } } })).json();
    customers.push(c._id);
    const pool = await (await api.post(url('/api/pools'), { data: { customerId: c._id, name: 'Pool', type: 'chlorine', volumeGal: 15000, serviceDay: day, routeOrder: 994 } })).json();

    await openEdit(c._id);
    await page.locator('[data-test=customer-rate]').fill('150');
    await page.locator('[data-test=customer-payment]').click();
    await page.getByRole('option', { name: 'Check' }).click();
    await page.locator('[data-test=customer-billing-email]').fill('billing@example.com');
    await page.locator('[data-test=customer-start]').fill('2026-11-01');
    await page.locator('[data-test=customer-distance]').fill('7.5');
    await page.locator('[data-test=customer-save]').click();
    await page.waitForURL((u) => u.pathname === `/customers/${c._id}`);
    const billing = page.locator('[data-test=customer-billing]');
    await billing.waitFor();
    const billingText = (await billing.innerText()).replace(/\s+/g, ' ');
    for (const want of ['$150.00', 'Check', 'billing@example.com', 'Nov 1, 2026', '7.5 mi']) if (!billingText.includes(want)) throw new Error(`billing missing "${want}": ${billingText}`);
    const c2 = await waitFor(async () => {
      const s = await serverCustomer(c._id);
      return s.monthlyRate === 150 ? s : null;
    });
    if (!c2 || c2.paymentMethod !== 'check' || c2.billingEmail !== 'billing@example.com' || c2.distanceMiles !== 7.5 || !String(c2.startDate).startsWith('2026-11-01'))
      throw new Error(`billing not on the server: ${JSON.stringify(c2)}`);

    await openEdit(c._id);
    await page.locator('[data-test=customer-rate]').fill('');
    await page.locator('[data-test=customer-save]').click();
    await page.waitForURL((u) => u.pathname === `/customers/${c._id}`);
    const c3 = await waitFor(async () => {
      const s = await serverCustomer(c._id);
      return s.monthlyRate === null && s.paymentMethod === 'check' ? s : null;
    });
    if (!c3) throw new Error('clearing the monthly rate did not clear it on the server');
    ok(`billing saved and shown (${billingText.trim()}); clearing the rate cleared it on the server, the rest kept`);

    // ---- 3. Past takes the pool off the Route; Current brings it back
    const routeRow = page.locator(`[data-test=route-row-${pool._id}]`);
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await routeRow.waitFor();
    await openEdit(c._id);
    await page.locator('[data-test=customer-status]').getByRole('button', { name: 'Past' }).click();
    await page.locator('[data-test=customer-end]').fill('2026-12-31');
    await page.locator('[data-test=customer-save]').click();
    await page.waitForURL((u) => u.pathname === `/customers/${c._id}`);
    await page.locator('[data-test=customer-status-badge]').filter({ hasText: 'Past' }).waitFor();
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=done-count]').waitFor();
    if (await routeRow.count()) throw new Error('past customer still on the Route');
    await openEdit(c._id);
    await page.locator('[data-test=customer-status]').getByRole('button', { name: 'Current' }).click();
    await page.locator('[data-test=customer-save]').click();
    await page.waitForURL((u) => u.pathname === `/customers/${c._id}`);
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await routeRow.waitFor();
    const c4 = await waitFor(async () => ((await serverCustomer(c._id)).status === 'current' ? true : null));
    if (!c4) throw new Error('status not back to current on the server');
    ok('Past: pool off the Route (history kept); Current again: back on the Route');

    // ---- 4. A pool with nothing but its customer: "Not scheduled", not counted
    const countBefore = await page.locator('[data-test=done-count]').innerText();
    await page.goto(url(`/customers/${c._id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=add-pool]').click();
    await page.locator('[data-test=pool-name]').fill('Spa');
    await page.locator('[data-test=pool-save]').click();
    await page.waitForURL(/\/pools\/[0-9a-f-]{36}\/overview$/);
    const spaId = page.url().split('/').slice(-2)[0];
    await page.getByText('Not scheduled').first().waitFor();
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=route-group-none]').waitFor();
    await page.locator(`[data-test=route-row-${spaId}]`).waitFor();
    const countAfter = await page.locator('[data-test=done-count]').innerText();
    if (countAfter !== countBefore) throw new Error(`weekly count changed: ${countBefore} → ${countAfter}`);
    const spa = await waitFor(async () => (await getJson(`/pools?customerId=${c._id}`)).find((p) => p._id === spaId));
    if (!spa || spa.type || spa.volumeGal || spa.serviceDay) throw new Error(`blank pool not saved blank: ${JSON.stringify(spa)}`);
    await page.screenshot({ path: `${out}/route-not-scheduled.png`, fullPage: true });
    ok(`pool with no type, gallons or day: under "Not scheduled" on the Route; weekly count unchanged (${countAfter})`);

    // ---- 5. Equipment
    await page.goto(url(`/pools/${pool._id}/overview`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=add-equipment-pump]').click();
    const dlg = page.locator('[data-test=equipment-dialog]');
    await dlg.waitFor();
    await page.locator('[data-test=equipment-model]').fill('Pentair SuperFlo VS');
    await page.locator('[data-test=equipment-serial]').fill('SF-123');
    const jpeg = await page.evaluate(async () => {
      const cv = document.createElement('canvas');
      cv.width = 800;
      cv.height = 600;
      const g = cv.getContext('2d');
      g.fillStyle = '#1565c0';
      g.fillRect(0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of buf) s += String.fromCharCode(b);
      return btoa(s);
    });
    await page.locator('[data-test=equipment-photo-input]').setInputFiles({ name: 'pump.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
    await dlg.locator('[data-test=photo-tile]').first().waitFor({ timeout: 20000 });
    await page.locator('[data-test=equipment-save]').click();
    await dlg.waitFor({ state: 'hidden' });
    const pumpRow = page.locator('[data-test=equipment-pump]');
    await pumpRow.waitFor();
    if (!/Pentair SuperFlo VS/.test(await pumpRow.innerText())) throw new Error(`pump row: ${await pumpRow.innerText()}`);

    await page.locator('[data-test=add-equipment-other]').click();
    await dlg.waitFor();
    await page.locator('[data-test=equipment-name]').fill('Booster pump');
    await page.locator('[data-test=equipment-save]').click();
    await dlg.waitFor({ state: 'hidden' });
    await page.locator('[data-test=equipment-other]').filter({ hasText: 'Booster pump' }).waitFor();
    await page.screenshot({ path: `${out}/equipment.png`, fullPage: true });

    const withEquipment = await waitFor(async () => {
      const p = (await getJson(`/pools?customerId=${c._id}`)).find((x) => x._id === pool._id);
      return p?.equipment?.length === 2 ? p : null;
    });
    if (!withEquipment) throw new Error('equipment not on the server');
    const pump = withEquipment.equipment.find((e) => e.kind === 'pump');
    if (pump.model !== 'Pentair SuperFlo VS' || pump.serial !== 'SF-123') throw new Error(`pump details: ${JSON.stringify(pump)}`);
    // Photos as the phone downloads them (the sync pull carries deletions too).
    const pumpPhotos = async () => ((await getJson('/sync/pull')).photos ?? []).filter((p) => p.equipmentId === pump._id && !p.deletedAt);
    if (!(await waitFor(async () => ((await pumpPhotos()).length === 1 ? true : null)))) throw new Error('pump photo not on the server with its equipmentId');
    ok('equipment: pump (model, serial, 1 photo) and "Booster pump" saved; on the server with the photo tied to the pump');

    await pumpRow.click();
    await dlg.waitFor();
    await page.locator('[data-test=equipment-remove]').click();
    await page.getByRole('button', { name: 'Remove' }).last().click();
    await dlg.waitFor({ state: 'hidden' });
    await page.locator('[data-test=add-equipment-pump]').waitFor();
    if (!(await waitFor(async () => ((await pumpPhotos()).length === 0 ? true : null)))) throw new Error('pump photo not removed with the pump');
    const after = (await getJson(`/pools?customerId=${c._id}`)).find((x) => x._id === pool._id);
    if (after.equipment.length !== 1 || after.equipment[0].name !== 'Booster pump') throw new Error(`equipment after removal: ${JSON.stringify(after.equipment)}`);
    ok('removing the pump removed its photo too; "Booster pump" kept');

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
