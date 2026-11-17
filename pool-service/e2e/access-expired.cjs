// Cloudflare Access login expired (Nov 2026), phone size:
//  1. Cloudflare starts answering every API call with a redirect to its login page
//     (simulated here): the app shows "Cloudflare login needed · Log in again",
//     not "no connection".
//  2. A visit saved meanwhile stays waiting on the phone (not failed) and doesn't reach the server.
//  3. "Log in again" opens /api/access-login. Cloudflare's login is simulated the way it really
//     ends: a redirect to /cdn-cgi/access/authorized, which must reach the network (not the
//     service worker's saved app) so Cloudflare can save the login; then back to
//     /api/access-login, and the server sends the browser to the app. The notice goes and
//     the visit uploads.
// Creates its own "E2E test …" customer and hides it at the end.
//
//   node access-expired.cjs <baseUrl> <password> <outDir>
const { chromium, devices } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const api = ctx.request; // Node-side requests: not affected by the simulated block
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
  const outbox = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('pool-service');
          open.onsuccess = () => {
            const all = open.result.transaction('outbox').objectStore('outbox').getAll();
            all.onsuccess = () => resolve(all.result.map((r) => ({ status: r.status, lastError: r.lastError ?? '' })));
          };
        }),
    );
  // What Cloudflare Access does for a browser without a valid login: redirect to its login site.
  const block = (route) =>
    route.fulfill({ status: 302, headers: { location: 'https://evolutiondfw.cloudflareaccess.com/cdn-cgi/access/login/poolapp.evolutiondfw.com' } });

  try {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();

    const tag = Date.now().toString(36);
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    const c = await (await api.post(url('/api/customers'), { data: { name: `E2E test ${tag}`, address: { line1: '3 Gate Rd', city: 'Dallas', state: 'TX', zip: '75201' } } })).json();
    customers.push(c._id);
    const pool = await (await api.post(url('/api/pools'), { data: { customerId: c._id, name: 'Pool', type: 'chlorine', volumeGal: 15000, serviceDay: day, routeOrder: 993 } })).json();
    await page.goto(url(`/pools/${pool._id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=current-visit]').waitFor();

    // ---- 1. Cloudflare starts blocking (context-wide, so the service worker is blocked too)
    await ctx.route('**/api/**', block);
    await page.locator('[data-test=current-visit] [data-test=reading-filterPsi]').fill('21');
    await page.locator('button[data-test=save-visit]').click();
    await page.locator('div[data-test=save-visit]').waitFor({ timeout: 20000 });
    const notice = page.locator('[data-test=access-needed]');
    await notice.waitFor({ timeout: 30000 });
    const text = (await notice.innerText()).replace(/\s+/g, ' ').trim();
    if (!/Cloudflare login needed/.test(text) || !/Log in again/i.test(text)) throw new Error(`unexpected notice: ${text}`);
    await page.waitForTimeout(1500); // let the message finish sliding in
    await page.screenshot({ path: `${out}/access-needed.png` });
    ok(`blocked: "${text}"`);

    // ---- 2. The visit waits on the phone; nothing reaches the server; not marked failed
    await page.waitForTimeout(5000);
    const rows = await outbox();
    if (!rows.length || rows.some((r) => r.status !== 'pending')) throw new Error(`outbox should hold pending rows: ${JSON.stringify(rows)}`);
    if (await todaysVisit(pool._id)) throw new Error('visit reached the server while blocked');
    ok(`visit waits on the phone: ${rows.length} pending, none failed; server has nothing yet`);

    // ---- 3. "Log in again" → /api/access-login (Cloudflare login simulated by lifting the block) → back in the app
    const opened = page.waitForRequest((r) => r.isNavigationRequest() && new URL(r.url()).pathname === '/api/access-login');
    await ctx.unroute('**/api/**', block);
    // Cloudflare's side: the first visit to /api/access-login goes through its login and comes back
    // to /cdn-cgi/access/authorized, which saves the login cookie and sends the browser on.
    let loggedIn = false;
    let authorizedReachedNetwork = false;
    // (Cloudflare's login page sends the browser on with a new page load; a faked 302 here would hide
    // the next request from ctx.route, which only sees the first request of a redirect chain.)
    await ctx.route('**/api/access-login', (route) =>
      loggedIn
        ? route.continue()
        : route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<p>Cloudflare login (simulated)</p><script>location.assign("/cdn-cgi/access/authorized?token=e2e")</script>',
          }),
    );
    await ctx.route('**/cdn-cgi/**', (route) => {
      authorizedReachedNetwork = true;
      loggedIn = true;
      return route.fulfill({ status: 302, headers: { location: '/api/access-login', 'set-cookie': 'CF_Authorization=e2e; Path=/; Secure; HttpOnly' } });
    });
    await notice.getByRole('button', { name: /Log in again/i }).click();
    await opened;
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => undefined);
    if (!authorizedReachedNetwork) throw new Error(`Cloudflare's /cdn-cgi/access/authorized never reached the network (the app's saved copy took it): ended at ${page.url()}`);
    if (new URL(page.url()).pathname !== '/') throw new Error(`did not land back on the app: ${page.url()}`);
    await page.locator('[data-test=done-count]').waitFor({ timeout: 20000 });
    let v = null;
    for (let i = 0; i < 30 && !(v && v.readings.filterPsi === 21); i++) {
      await page.waitForTimeout(3000);
      v = await todaysVisit(pool._id);
    }
    if (!v || v.readings.filterPsi !== 21) throw new Error('visit did not upload after logging in again');
    if (await notice.count()) throw new Error('"Cloudflare login needed" should be gone');
    ok('"Log in again" → Cloudflare login → /cdn-cgi/access/authorized (reached Cloudflare) → back to the route; the visit uploaded (filter PSI 21), notice gone');

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
