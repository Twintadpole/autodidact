// Phone-size end-to-end test of the Phase 3 screens.
// Creates its own customer ("E2E test …") and deletes it at the end.
//
//   node phase3.cjs <baseUrl> <password> <outDir>
//
// On the VPS (see deploy/README.md):
//   docker run --rm --network host -v "$PWD/e2e:/e2e" -w /e2e mcr.microsoft.com/playwright:v1.56.1-noble \
//     bash -c "npm i -s playwright@1.56.1 >/dev/null && node phase3.cjs https://poolapp.evolutiondfw.com/ \"$PW\" /e2e/out"
const { chromium, devices } = require('playwright');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABEL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

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
  const expectText = async (locator, re, what) => {
    await locator.filter({ hasText: re }).first().waitFor({ timeout: 10000 }).catch(async () => {
      throw new Error(`${what}: expected ${re}, got "${(await locator.first().innerText().catch(() => '?')).slice(0, 200)}"`);
    });
  };
  const stamp = Date.now().toString(36);
  const customerName = `E2E test ${stamp}`;
  const today = DAYS[new Date().getDay()];

  // 1. Login redirect + login
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  await page.waitForURL(/\/login/);
  await shot('01-login');
  await page.getByLabel('Password').fill(password);
  await page.locator('[data-test=login]').click();
  await page.locator('[data-test=done-count]').waitFor();
  ok('login screen → Route list');

  // 2. New customer
  await page.locator('[data-test=tab-customers]').click();
  await page.locator('[data-test=new-customer]').click();
  await page.locator('[data-test=customer-name]').fill(customerName);
  await page.locator('[data-test=customer-phone]').fill('512 555 0123');
  await page.locator('[data-test=addr-line1]').fill('100 Test Lane');
  await page.locator('[data-test=addr-city]').fill('Dallas');
  await page.locator('[data-test=addr-zip]').fill('75201');
  await page.locator('[data-test=customer-save]').click();
  await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);
  const tel = await page.locator('[data-test=tel-link]').first().getAttribute('href');
  const sms = await page.locator('[data-test=sms-link]').first().getAttribute('href');
  const maps = await page.locator('[data-test=maps-link]').first().getAttribute('href');
  if (tel !== 'tel:+15125550123' || sms !== 'sms:+15125550123') throw new Error(`phone links wrong: ${tel} ${sms}`);
  if (!maps?.startsWith('https://www.google.com/maps/dir/?api=1&destination=100%20Test%20Lane')) throw new Error(`maps link wrong: ${maps}`);
  await shot('02-customer');
  ok(`customer created; links ${tel}, ${sms}, Google Maps`);

  // 3. New pool on today's service day
  await page.locator('[data-test=add-pool]').click();
  await page.locator('[data-test=pool-name]').fill('Backyard');
  await page.locator('[data-test=pool-day]').click();
  await page.getByRole('option', { name: DAY_LABEL[today] }).click();
  await page.locator('[data-test=pool-access]').fill('Gate code 1234 · friendly dog');
  await page.locator('[data-test=pool-save]').click();
  await page.waitForURL(/\/pools\/([0-9a-f-]{36})\/overview$/);
  const poolId = /\/pools\/([0-9a-f-]{36})\//.exec(page.url())[1];
  ok(`pool created (${DAY_LABEL[today]})`);

  // 4. Seed last week's visit through the sync API (what a previous visit looks like)
  const seeded = await page.evaluate(async (pid) => {
    const chems = await (await fetch('/api/chemicals')).json();
    const chlorine = chems.find((c) => c.name === 'Liquid chlorine') ?? chems[0];
    const at = new Date(Date.now() - 7 * 86400000).toISOString();
    const res = await fetch('/api/sync/package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        packageId: crypto.randomUUID(),
        poolId: pid,
        createdAt: at,
        visit: { _id: crypto.randomUUID(), poolId: pid, visitedAt: at, createdAt: at, updatedAt: at, readings: { fc: 1.5, ph: 7.9, ta: 80 }, doses: [{ chemicalId: chlorine._id, amount: 1.5, unit: 'gal' }] },
      }),
    });
    return res.status;
  }, poolId);
  if (seeded !== 200) throw new Error(`seeding previous visit failed: ${seeded}`);
  ok('seeded last week’s visit (FC 1.5, pH 7.9, 1.5 gal chlorine)');

  // 5. Route: check the pool off
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  const row = page.locator(`[data-test=route-row-${poolId}]`);
  await row.waitFor();
  const before = await page.locator('[data-test=done-count]').innerText();
  await page.locator(`[data-test=done-${poolId}]`).click();
  await page.waitForFunction((id) => document.querySelector(`[data-test=done-${id}]`)?.getAttribute('aria-checked') === 'true', poolId);
  const after = await page.locator('[data-test=done-count]').innerText();
  await shot('03-route');
  ok(`Route checkbox: "${before}" → "${after}"`);

  // 6. Visit screen: previous card, access notes, shared done toggle
  await page.locator(`[data-test=open-${poolId}]`).click();
  await page.waitForURL(new RegExp(`/pools/${poolId}$`));
  await page.locator('[data-test=previous-visit]').waitFor();
  await expectText(page.locator('[data-test=access-notes]'), /Gate code 1234/, 'access notes');
  const prevFcClass = await page.locator('[data-test=prev-reading-fc]').getAttribute('class');
  if (!/reading-warn/.test(prevFcClass)) throw new Error(`previous FC 1.5 should be amber, class=${prevFcClass}`);
  const prevPhClass = await page.locator('[data-test=prev-reading-ph]').getAttribute('class');
  if (!/reading-bad/.test(prevPhClass)) throw new Error(`previous pH 7.9 should be red, class=${prevPhClass}`);
  const toggleOn = await page.locator('[data-test=done-toggle]').getAttribute('aria-checked');
  if (toggleOn !== 'true') throw new Error('done toggle should match the Route checkbox');
  ok('visit screen: previous card (FC amber, pH red), access notes, done toggle = Route checkbox');

  // 7. Fill the current visit card and save
  await page.locator('[data-test=reading-fc]').fill('3');
  await page.locator('[data-test=reading-ph]').fill('7.5');
  await page.locator('[data-test=reading-ta]').fill('90');
  await page.locator('[data-test=same-as-last]').click();
  if ((await page.locator('[data-test=dose-row]').count()) !== 1) throw new Error('Same as last time should copy 1 dose');
  await page.locator('[data-test=task-brushed]').click();
  await page.locator('[data-test=visit-note]').fill('E2E visit note');
  await shot('04-visit-filled');
  await page.locator('[data-test=save-visit]').click();
  await page.getByText('Visit saved').waitFor();
  ok('current visit card filled (readings, Same as last time, task, note) and saved');

  // 8. Reopen: today's visit loads for editing, previous card unchanged
  await page.reload({ waitUntil: 'networkidle' });
  await expectText(page.locator('[data-test=current-visit]'), /Today’s visit \(saved\)/, 'current card title');
  const fc = await page.locator('[data-test=reading-fc]').inputValue();
  if (fc !== '3') throw new Error(`saved FC should reload as 3, got ${fc}`);
  await expectText(page.locator('[data-test=prev-reading-fc]'), /1\.5/, 'previous FC');
  await page.locator('[data-test=previous-visit]').scrollIntoViewIfNeeded();
  await shot('05-visit-cards');
  ok('reload: today’s visit reopens for editing; previous card still last week');

  // 9. Issue: add → grid → postpone → reopen → complete
  await page.locator('[data-test=add-issue]').click();
  await page.locator('[data-test=issue-title]').fill('Cracked skimmer lid');
  await page.locator('[data-test=issue-urgent]').click();
  await page.locator('[data-test=issue-important]').click();
  await page.locator('[data-test=issue-save]').click();
  await page.getByText('Issue added').waitFor();
  await page.locator('[data-test=open-issues]').click();
  await page.waitForURL(new RegExp(`/pools/${poolId}/issues$`));
  await expectText(page.locator('[data-test=quad-do_now]'), /Cracked skimmer lid/, 'Do now quadrant');
  await shot('06-issues-grid');
  await page.locator('[data-test=quad-do_now] .quad-item').first().click();
  await page.locator('[data-test=issue-postpone]').click();
  await page.locator('[data-test=postponed-section]').waitFor();
  await page.locator('[data-test=postponed-section]').click();
  await page.locator('[data-test=postponed-section] .q-item').filter({ hasText: 'Cracked skimmer lid' }).first().click();
  await page.locator('[data-test=issue-reopen]').click();
  await expectText(page.locator('[data-test=quad-do_now]'), /Cracked skimmer lid/, 'reopened issue');
  await page.locator('[data-test=quad-do_now] .quad-item').first().click();
  await page.locator('[data-test=issue-complete]').click();
  await page.locator('[data-test=completed-section]').waitFor();
  await page.locator('[data-test=issues-view]').getByRole('button', { name: 'List' }).click();
  ok('issue: Do now grid → Postpone → Reopen → Completed');

  // 10. Overview: history + notes
  await page.goto(url(`/pools/${poolId}/overview`), { waitUntil: 'networkidle' });
  await page.locator('[data-test=history] tbody tr').nth(1).waitFor();
  const rows = await page.locator('[data-test=history] tbody tr').count();
  await page.locator('[data-test=note-input]').fill('Pump is behind the shed');
  await page.locator('[data-test=note-add]').click();
  await expectText(page.locator('[data-test=note-row]'), /Pump is behind the shed/, 'note');
  await shot('07-overview');
  ok(`overview: ${rows} visits in history, trend charts, note added`);

  // 11. Reset week clears the checkmark
  await page.goto(url('/'), { waitUntil: 'networkidle' });
  await page.locator('[data-test=route-menu]').click();
  await page.locator('[data-test=reset-week]').click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByText('Week reset').waitFor();
  await page.waitForFunction((id) => document.querySelector(`[data-test=done-${id}]`)?.getAttribute('aria-checked') === 'false', poolId);
  ok(`Reset week: checkmarks cleared ("${await page.locator('[data-test=done-count]').innerText()}")`);

  // 12. More: backup time + chemicals
  await page.locator('[data-test=tab-more]').click();
  await expectText(page.locator('[data-test=backup-status]'), /ago|No backup yet/, 'backup row');
  const backup = (await page.locator('[data-test=backup-status]').innerText()).replace(/\s+/g, ' ');
  await shot('08-more');
  await page.locator('[data-test=more-chemicals]').click();
  await page.locator('[data-test=chemicals-list] .q-item').nth(10).waitFor();
  ok(`More: "${backup}"; chemicals list loads`);

  // 13. Clean up the test customer (and its pool)
  await page.goto(url('/customers'), { waitUntil: 'networkidle' });
  await page.locator('[data-test=customer-search]').fill(customerName);
  await page.locator('[data-test=customer-list] .q-item').first().click();
  await page.locator('[data-test=edit-customer]').click();
  await page.getByRole('button', { name: 'Delete customer' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForURL(/\/customers$/);
  const gone = await page.evaluate(async (pid) => (await (await fetch('/api/pools')).json()).every((p) => p._id !== pid), poolId);
  if (!gone) throw new Error('test pool still listed after delete');
  ok('test customer and pool deleted');

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
