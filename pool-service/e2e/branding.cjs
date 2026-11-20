// GPF item 4: branding, phone size. Test environment only: it changes Business details (name and
// logo) and puts them back blank at the end, so run it against a test copy, not a real business.
//  1. A blank business: the login screen shows Great Pool Friend and its icon; no "Powered by".
//  2. The home-screen file isn't cached by the app (the service worker leaves it to the server).
//  3. Owner logs in; More ends with "Great Pool Friend v…".
//  4. Business details: name and logo saved.
//  5. The login screen shows the business's name and logo, "Powered by Great Pool Friend"; the
//     home-screen file has the name and icons made from the logo.
//
//   node branding.cjs <baseUrl> <password> <outDir>
const { chromium } = require('playwright');
const zlib = require('node:zlib');

/** A 64×64 solid red PNG, made here (no image library needed). */
function redPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const w = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: w }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([200, 30, 30]))])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const name = `Evolution Test ${Date.now().toString(36)}`;
  const manifest = async () => (await ctx.request.get(url('/manifest.json'))).json();

  try {
    // ---- 1
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=login-name]', { hasText: 'Great Pool Friend' }).waitFor();
    if (await page.locator('[data-test=login-powered]').count()) throw new Error('no "Powered by" without a business name');
    if ((await page.title()) !== 'Great Pool Friend') throw new Error(`page title: ${await page.title()}`);
    await page.screenshot({ path: `${out}/branding-blank.png` });
    ok('blank business: login shows Great Pool Friend and its icon');

    // ---- 2
    const sw = await (await ctx.request.get(url('/sw.js'))).text();
    if (/["']manifest\.json["']/.test(sw)) throw new Error('the service worker precaches manifest.json');
    if (!/icon-192x192\.png/.test(sw)) throw new Error('expected the app icons in the precache list');
    ok('the service worker doesn’t cache the home-screen file');

    // ---- 3
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL || 'owner');
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();
    await page.goto(url('/more'), { waitUntil: 'networkidle' });
    const footer = await page.locator('[data-test=app-version]').innerText();
    if (!footer.startsWith('Great Pool Friend v')) throw new Error(`footer: ${footer}`);
    ok(`More ends with "${footer}"`);

    // ---- 4
    await page.goto(url('/more/business'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=business-name] input, input[data-test=business-name]').first().fill(name);
    await page.locator('[data-test=business-logo-input]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: redPng() });
    await page.locator('[data-test=business-logo] img').waitFor();
    await page.locator('[data-test=business-save]').click();
    let m;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      m = await manifest();
      if (m.name === name && m.gpf.logo) break;
    }
    if (m.name !== name || !m.gpf.logo) throw new Error(`manifest after saving: ${JSON.stringify(m.gpf)}`);
    ok('Business details: name and logo saved');

    // ---- 5
    await page.goto(url('/more/account'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=account-logout]').click();
    await page.waitForURL(/\/login/);
    await page.locator('[data-test=login-name]', { hasText: name }).waitFor();
    await page.locator('[data-test=login-powered]', { hasText: 'Powered by Great Pool Friend' }).waitFor();
    const logoOk = await page.locator('[data-test=login-logo]').evaluate((img) => img.complete && img.naturalWidth === 192);
    if (!logoOk) throw new Error('the login logo did not load at 192 px');
    if (m.short_name !== 'Evolution' || m.icons.length !== 3 || !m.icons.every((i) => i.src.startsWith('icons/business/'))) throw new Error(`manifest: ${JSON.stringify({ s: m.short_name, i: m.icons })}`);
    for (const i of m.icons) {
      const r = await ctx.request.get(url(i.src));
      if (r.status() !== 200 || r.headers()['content-type'] !== 'image/png') throw new Error(`icon ${i.src}: ${r.status()}`);
    }
    await page.screenshot({ path: `${out}/branding-business.png` });
    ok(`login shows "${name}", its logo and "Powered by Great Pool Friend"; home screen: "${m.short_name}" with icons from the logo`);
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    // Back to blank (log in through the API if the browser isn't).
    const api = ctx.request;
    await api.post(url('/api/auth/login'), { data: { email: process.env.E2E_EMAIL || 'owner', password } }).catch(() => undefined);
    const all = await (await api.get(url('/api/settings'))).json().catch(() => []);
    const biz = Array.isArray(all) ? all.find((s) => s._id === '00000000-0000-4000-8000-000000000001') : null;
    if (biz) await api.patch(url(`/api/settings/${biz._id}`), { data: { businessName: '', logoDataUrl: '' } }).catch(() => undefined);
    console.log('  (business name and logo cleared again)');
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
