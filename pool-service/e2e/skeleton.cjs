// Phone-size smoke test of the skeleton test page. Logs in, runs the sync test, resets the demo data.
// Run on the VPS with:
//   docker run --rm --network host -v "$PWD/e2e:/e2e" -w /e2e mcr.microsoft.com/playwright:v1.56.1-noble \
//     bash -c "npm i -s playwright@1.56.1 >/dev/null && node skeleton.cjs https://poolapp.evolutiondfw.com/ \"$PW\" /e2e/out"
// Usage: node skeleton.cjs <baseUrl> <password> <outDir>
const { chromium, devices } = require('playwright');
(async () => {
  const [base, password, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const log = (m) => console.log(m);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('API: ok').waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${out}/1-login.png`, fullPage: true });
  log('page loaded, API ok');
  await page.getByLabel('App password').fill(password);
  await page.locator('[data-test=login]').click();
  await page.getByText('Logged in').waitFor({ timeout: 10000 });
  await page.getByText(/Chemicals in the database \(11\)/).waitFor({ timeout: 10000 });
  log('logged in; 11 chemicals listed');
  await page.locator('[data-test=sync-test]').click();
  const verdict = page.locator('[data-test=sync-verdict]');
  await verdict.waitFor({ timeout: 20000 });
  const text = (await verdict.innerText()).trim();
  log('sync verdict: ' + text);
  log('steps:\n' + (await page.locator('[data-test=sync-steps]').innerText()));
  await verdict.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/2-sync-test.png`, fullPage: true });
  // Service worker + manifest (needed for "Add to Home screen")
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    return reg ? (reg.active || reg.waiting || reg.installing ? 'registered' : 'pending') : 'none';
  });
  const manifest = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null);
  log(`service worker: ${sw}; manifest: ${manifest}`);
  await page.locator('[data-test=reset-demo]').click();
  await page.getByText(/Demo data removed|No demo data/).waitFor({ timeout: 10000 });
  log('reset demo ok');
  await browser.close();
  if (!text.startsWith('Sync works')) process.exit(2);
})().catch((e) => { console.error(e); process.exit(1); });
