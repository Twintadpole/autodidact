// GPF item 3: logins, roles and assigned routes, phone size (412×915). Test environment only: it
// logs in for real as the owner and as a new tech, so it can't use E2E_SESSION (local-cookies.cjs
// answers the login screen itself). Uses 4 logins (limit: 5 per 15 minutes per address).
//  1. Owner logs in (email + password); More has My account and Team.
//  2. Team: add a tech; the temporary password is shown once; put pool A on their route.
//  3. Owner's Route: filter by tech, and pool A shows whose route it's on.
//  4. The tech logs in on the same phone: the owner's copy is cleared, and the temporary password
//     must be changed first.
//  5. The tech sees only pool A; no money (More, customer page, customer form), no deletes;
//     owner-only screens send them to the Route.
//  6. The tech ticks pool A done: it reaches the server.
//  7. The owner moves pool A off the tech's route: at the tech's next sync it's gone.
//  8. The owner logs in again on the phone: the tech's copy is cleared, everything is back;
//     My account lists this device.
//
//   node accounts.cjs <baseUrl> <owner password> <outDir>      (owner's login name: E2E_EMAIL or "owner")
const { chromium, request } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const ownerEmail = process.env.E2E_EMAIL || 'owner';
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const tag = Date.now().toString(36);
  const techEmail = `tech.${tag}@example.com`;
  const techName = `E2E Tech ${tag}`;
  // The owner's own API connection, apart from the phone (logged in once).
  const owner = await request.newContext({ baseURL: base });
  const login = await owner.post('/api/auth/login', { data: { email: ownerEmail, password } });
  if (login.status() !== 200) throw new Error(`owner API login: ${login.status()}`);
  const api = async (method, path, data) => {
    const r = await owner.fetch(`/api${path}`, { method, ...(data && { data }) });
    if (r.status() >= 400) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const ids = { a: null, b: null, a1: null, b1: null, tech: null };

  const uiLogin = async (email, pw) => {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(pw);
    await page.locator('[data-test=login]').click();
  };
  const logout = async () => {
    await page.goto(url('/more/account'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=account-logout]').click();
    await page.waitForURL(/\/login/);
  };
  const routeHas = async (poolId) => (await page.locator(`[data-test=route-row-${poolId}]`).count()) > 0;
  const syncAndRoute = async () => {
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=done-count]').waitFor();
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-test=done-count]').waitFor();
    await page.waitForTimeout(1000);
  };

  try {
    // Two customers with a Monday pool each; A has a rate.
    const today = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    ids.a = (await api('POST', '/customers', { name: `E2E test acct ${tag} A`, monthlyRate: 150, address: { line1: '1 Test Rd' } }))._id;
    ids.b = (await api('POST', '/customers', { name: `E2E test acct ${tag} B` }))._id;
    ids.a1 = (await api('POST', '/pools', { customerId: ids.a, name: 'A pool', serviceDay: today }))._id;
    ids.b1 = (await api('POST', '/pools', { customerId: ids.b, name: 'B pool', serviceDay: today }))._id;

    // ---- 1
    await uiLogin(ownerEmail, password);
    await page.locator('[data-test=done-count]').waitFor();
    await page.goto(url('/more'), { waitUntil: 'networkidle' });
    for (const t of ['more-account', 'more-team', 'more-money', 'more-invoices']) await page.locator(`[data-test=${t}]`).waitFor();
    ok('owner logs in with email + password; More has My account, Team, Money, Invoices');

    // ---- 2
    await page.locator('[data-test=more-team]').click();
    await page.locator('[data-test=team-add]').click();
    await page.locator('[data-test=team-new-name]').fill(techName);
    await page.locator('[data-test=team-new-email]').fill(techEmail);
    await page.locator('[data-test=team-new-save]').click();
    const temp = (await page.locator('[data-test=team-temp-value]').innerText()).trim();
    if (!/^[A-Za-z0-9]{12}$/.test(temp)) throw new Error(`temporary password: ${temp}`);
    await page.screenshot({ path: `${out}/accounts-temp-password.png` });
    await page.locator('[data-test=team-temp-done]').click();
    ids.tech = (await api('GET', '/team')).find((m) => m.email === techEmail)._id;
    await page.locator(`[data-test="team-route-${techEmail}"]`).click();
    await page.locator(`[data-test=route-pool-${ids.a1}] .q-checkbox`).click();
    await page.locator('[data-test=team-route-save]').click();
    await page.locator('[data-test=team-route-dialog]').waitFor({ state: 'hidden' });
    const a1 = (await api('GET', `/pools/${ids.a1}`));
    if (a1.techId !== ids.tech) throw new Error(`pool A not on the tech's route: ${a1.techId}`);
    ok('Team: tech added, temporary password shown once; pool A put on their route');

    // ---- 3
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.locator(`[data-test=route-tech-${ids.a1}]`).waitFor({ timeout: 15000 });
    await page.locator('.q-field', { has: page.locator('[data-test=route-tech]') }).click();
    await page.getByRole('option', { name: `${techName}’s` }).click();
    await page.waitForTimeout(300);
    if (!(await routeHas(ids.a1)) || (await routeHas(ids.b1))) throw new Error('tech filter should show A only');
    await page.locator('.q-field', { has: page.locator('[data-test=route-tech]') }).click();
    await page.getByRole('option', { name: 'Everyone’s' }).click();
    ok('owner’s Route: pool A shows the tech’s name; the tech filter shows only their pools');

    // ---- 4
    await logout();
    await uiLogin(techEmail, temp);
    await page.waitForURL(/\/more\/account\?change=1/);
    await page.locator('[data-test=account-must-change]').waitFor();
    await page.locator('[data-test=account-current]').fill(temp);
    await page.locator('[data-test=account-new]').fill(`tech-pass-${tag}`);
    await page.locator('[data-test=account-new2]').fill(`tech-pass-${tag}`);
    await page.locator('[data-test=account-save]').click();
    await page.waitForURL((u) => new URL(u).pathname === '/');
    // Beta: the welcome screens follow a first login (onboarding.cjs checks them).
    await page.locator('[data-test=welcome-skip]').click();
    ok('tech logs in on the same phone: asked to choose their own password first');

    // ---- 5
    await syncAndRoute();
    if (!(await routeHas(ids.a1))) throw new Error('tech should see pool A');
    if (await routeHas(ids.b1)) throw new Error('tech must not see pool B');
    const local = await page.evaluate(async () => {
      const open = indexedDB.open('pool-service');
      const db = await new Promise((r) => (open.onsuccess = () => r(open.result)));
      const all = (t) => new Promise((r) => { const q = db.transaction(t).objectStore(t).getAll(); q.onsuccess = () => r(q.result); });
      return { customers: await all('customers'), invoices: await all('invoices'), ledger: await all('ledger') };
    });
    const mine = local.customers.filter((c) => c.name.includes(tag));
    if (mine.length !== 1 || mine[0]._id !== ids.a || 'monthlyRate' in mine[0]) throw new Error(`tech's phone: ${JSON.stringify(mine)}`);
    if (local.invoices.length || local.ledger.length) throw new Error('tech phone has money records');
    await page.goto(url('/more'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=more-account]').waitFor();
    for (const t of ['more-team', 'more-money', 'more-invoices', 'more-business', 'more-export-all', 'more-desktop']) {
      if (await page.locator(`[data-test=${t}]`).count()) throw new Error(`tech's More shows ${t}`);
    }
    await page.goto(url(`/customers/${ids.a}`), { waitUntil: 'networkidle' });
    await page.getByText('A pool').first().waitFor();
    if (await page.locator('[data-test=customer-invoices]').count()) throw new Error('tech sees invoices');
    await page.goto(url(`/customers/${ids.a}/edit`), { waitUntil: 'networkidle' });
    await page.getByLabel('Name').first().waitFor();
    if (await page.locator('[data-test=customer-rate]').count()) throw new Error('tech sees the monthly rate field');
    if (await page.getByRole('button', { name: 'Delete customer' }).count()) throw new Error('tech can delete a customer');
    await page.goto(url('/more/money'), { waitUntil: 'networkidle' });
    await page.waitForURL((u) => new URL(u).pathname === '/');
    await page.goto(url('/desk'), { waitUntil: 'networkidle' });
    await page.waitForURL((u) => new URL(u).pathname === '/');
    await page.screenshot({ path: `${out}/accounts-tech-route.png` });
    ok('tech sees only pool A; no rate, invoices or ledger on the phone; no money screens, Team, desktop or deletes');

    // ---- 6
    await page.locator(`[data-test=done-${ids.a1}]`).click();
    let done = false;
    for (let i = 0; i < 20 && !done; i++) {
      await page.waitForTimeout(1000);
      done = (await api('GET', `/pools/${ids.a1}`)).week.done === true;
    }
    if (!done) throw new Error('tech’s checkmark did not reach the server');
    ok('tech ticks pool A done; the server has it');

    // ---- 7
    await api('POST', '/pools/assign', { poolIds: [ids.a1], techId: null });
    await syncAndRoute();
    if (await routeHas(ids.a1)) throw new Error('pool A should be gone from the tech’s phone');
    const left = await page.evaluate(async () => {
      const open = indexedDB.open('pool-service');
      const db = await new Promise((r) => (open.onsuccess = () => r(open.result)));
      return new Promise((r) => { const q = db.transaction('pools').objectStore('pools').getAll(); q.onsuccess = () => r(q.result.length); });
    });
    if (left !== 0) throw new Error(`tech phone still has ${left} pool(s)`);
    ok('owner moves pool A off the route: gone from the tech’s phone at the next sync');

    // ---- 8
    await logout();
    await uiLogin(ownerEmail, password);
    await page.locator('[data-test=done-count]').waitFor();
    await syncAndRoute();
    if (!(await routeHas(ids.a1)) || !(await routeHas(ids.b1))) throw new Error('owner should see both pools again');
    await page.goto(url('/more/account'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=account-devices] .q-item', { hasText: 'This device' }).waitFor();
    ok('owner logs in again on the phone: everything is back; My account lists this device');
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } catch (e) {
    await page.screenshot({ path: `${out}/accounts-failed.png` }).catch(() => undefined);
    console.log(`  (at ${page.url()})`);
    throw e;
  } finally {
    for (const id of [ids.a, ids.b]) if (id) await owner.delete(`/api/customers/${id}`).catch(() => undefined);
    if (ids.tech) await owner.patch(`/api/team/${ids.tech}`, { data: { active: false } }).catch(() => undefined);
    console.log('  (test customers hidden, test tech login turned off)');
    await owner.dispose();
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
