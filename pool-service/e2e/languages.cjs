// GPF item 5: languages, phone size. Test environment only (it changes the owner's language and
// clears it again at the end).
//  1. The login screen follows the phone's language (a Spanish phone shows Spanish).
//  2. Log in; the Route, the menu and More are in Spanish.
//  3. My account → Language: English; it's saved to the login (another browser gets English).
//  4. Back to Español: it follows the login to a new browser that is set to English.
//  5. Screens in Spanish (screenshots): customer, visit, issues, sync; no "undefined" or {placeholders}.
//  6. Vietnamese, Chinese, Tagalog and Arabic from My account: More in that language; Arabic turns
//     the page right to left (screenshots).
//
//   node languages.cjs <baseUrl> <password> <outDir>
const { chromium } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const email = process.env.E2E_EMAIL || 'owner';
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const errors = [];
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const newPage = async (locale) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page };
  };
  const login = async (page) => {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=email] input, input[data-test=email]').first().fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();
  };
  const noJunk = async (page, where) => {
    const text = await page.locator('body').innerText();
    if (/undefined|\{[a-z]+\}|\$t\(/.test(text)) throw new Error(`${where}: odd text: ${text.match(/.{0,40}(undefined|\{[a-z]+\}|\$t\().{0,40}/)?.[0]}`);
  };
  let api;
  let made = null;

  try {
    // ---- 1
    const es = await newPage('es-MX');
    await es.page.goto(url('/login'), { waitUntil: 'networkidle' });
    await es.page.getByRole('button', { name: 'Iniciar sesión' }).waitFor();
    await es.page.getByText('Recordar este dispositivo (90 días)').waitFor();
    await es.page.screenshot({ path: `${out}/lang-login-es.png` });
    ok('a Spanish phone gets a Spanish login screen');

    // ---- 2
    await login(es.page);
    api = es.ctx.request;
    await es.page.getByText(/^Semana del /).waitFor();
    await es.page.getByText('Ruta', { exact: true }).first().waitFor();
    await noJunk(es.page, 'Route');
    await es.page.screenshot({ path: `${out}/lang-route-es.png` });
    await es.page.goto(url('/more'), { waitUntil: 'networkidle' });
    for (const s of ['Mi cuenta', 'Equipo', 'Dinero', 'Facturas', 'Datos del negocio']) await es.page.getByText(s, { exact: true }).first().waitFor();
    await noJunk(es.page, 'More');
    await es.page.screenshot({ path: `${out}/lang-more-es.png` });
    ok('logged in: Route ("Semana del …") and More (Mi cuenta, Equipo, Dinero, Facturas) in Spanish');

    // ---- 3
    await es.page.goto(url('/more/account'), { waitUntil: 'networkidle' });
    await es.page.locator('.q-field', { has: es.page.locator('[data-test=language]') }).click();
    await es.page.getByRole('option', { name: 'English' }).click();
    await es.page.getByText('My devices').waitFor();
    const me1 = await (await api.get(url('/api/auth/me'))).json();
    if (me1.me.language !== 'en') throw new Error(`saved language: ${me1.me.language}`);
    ok('My account → English: the screen switches and the login saves "en"');

    // ---- 4
    await es.page.locator('.q-field', { has: es.page.locator('[data-test=language]') }).click();
    await es.page.getByRole('option', { name: /Español/ }).click();
    await es.page.getByText('Mis dispositivos').waitFor();
    const en = await newPage('en-US');
    await login(en.page);
    await en.page.goto(url('/more'), { waitUntil: 'networkidle' });
    await en.page.getByText('Mi cuenta', { exact: true }).waitFor();
    ok('back to Español; it follows the login to a browser set to English');

    // ---- 5
    const cust = await (await api.post(url('/api/customers'), { data: { name: `E2E test lang ${Date.now().toString(36)}`, monthlyRate: 150, phones: [{ label: 'mobile', number: '+15550100099' }] } })).json();
    made = cust._id;
    const pool = await (await api.post(url('/api/pools'), { data: { customerId: cust._id, name: 'Pool', serviceDay: 'mon', type: 'salt', volumeGal: 15000 } })).json();
    const shots = [['/customers', 'customers'], ['/issues', 'issues'], ['/more/sync', 'sync'], ['/more/team', 'team']];
    if (pool) shots.push([`/pools/${pool._id}`, 'visit'], [`/customers/${pool.customerId}`, 'customer'], [`/pools/${pool._id}/overview`, 'overview']);
    for (const [p, name] of shots) {
      await es.page.goto(url(p), { waitUntil: 'networkidle' });
      await es.page.waitForTimeout(800);
      await noJunk(es.page, name);
      await es.page.screenshot({ path: `${out}/lang-${name}-es.png`, fullPage: true });
    }
    ok(`${shots.length} more screens in Spanish without odd text (screenshots saved)`);

    // ---- 6
    const WORDS = { vi: ['Tài khoản của tôi', 'Hóa đơn'], zh: ['我的账户', '发票'], tl: ['Aking account', 'Mga invoice'], ar: ['حسابي', 'الفواتير'] };
    const NAMES = { vi: 'Tiếng Việt', zh: '中文（简体）', tl: 'Tagalog', ar: 'العربية' };
    for (const code of ['vi', 'zh', 'tl', 'ar']) {
      await es.page.goto(url('/more/account'), { waitUntil: 'networkidle' });
      await es.page.locator('.q-field', { has: es.page.locator('[data-test=language]') }).click();
      await es.page.getByRole('option', { name: new RegExp(NAMES[code]) }).click();
      await es.page.waitForTimeout(500);
      await es.page.goto(url('/more'), { waitUntil: 'networkidle' });
      for (const w of WORDS[code]) await es.page.getByText(w, { exact: true }).first().waitFor();
      await noJunk(es.page, `More (${code})`);
      const dir = await es.page.evaluate(() => document.documentElement.dir);
      if ((code === 'ar') !== (dir === 'rtl')) throw new Error(`${code}: page direction ${dir}`);
      await es.page.screenshot({ path: `${out}/lang-more-${code}.png` });
      if (code === 'ar') {
        await es.page.goto(url(`/pools/${pool._id}`), { waitUntil: 'networkidle' });
        await es.page.waitForTimeout(800);
        await noJunk(es.page, 'visit (ar)');
        await es.page.screenshot({ path: `${out}/lang-visit-ar.png`, fullPage: true });
        await es.page.goto(url('/'), { waitUntil: 'networkidle' });
        await es.page.screenshot({ path: `${out}/lang-route-ar.png` });
      }
    }
    ok('Vietnamese, Chinese, Tagalog and Arabic: More in each language; Arabic right to left');
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    if (api && made) await api.delete(url(`/api/customers/${made}`)).catch(() => undefined);
    if (api) await api.patch(url('/api/auth/me'), { data: { language: null } }).catch(() => undefined);
    console.log('  (language choice cleared: the phone’s language again)');
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
