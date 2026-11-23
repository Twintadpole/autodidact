// Beta docs: Terms of beta use and Privacy, public (no login). Phone size.
//  1. Login screen → Terms of beta use: the text, with the support email as a link.
//  2. → Privacy (from the Terms page) → Back to the login screen.
//  3. A Spanish phone: the links are translated and the page says it's in English only.
//
//   node legal.cjs <baseUrl> <password> <outDir>
const { chromium } = require('playwright');

(async () => {
  const [base, , out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const errors = [];
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const open = async (locale) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    return page;
  };
  try {
    // ---- 1
    const page = await open('en-US');
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=login-legal]').getByText('Terms of beta use').click();
    await page.waitForURL(/\/terms$/);
    await page.locator('[data-test=legal-text]').getByText('Your data is yours').waitFor();
    await page.locator('[data-test=legal-text] a[href="mailto:steven@evolutiondfw.com"]').first().waitFor();
    if (await page.locator('[data-test=legal-english-only]').count()) throw new Error('English page shows the English-only note');
    await page.screenshot({ path: `${out}/legal-terms.png`, fullPage: true });
    ok('login → Terms of beta use (with the support email link)');

    // ---- 2
    await page.getByRole('button', { name: 'Privacy' }).click();
    await page.waitForURL(/\/privacy$/);
    await page.locator('[data-test=legal-text]').getByText('What the app keeps').waitFor();
    await page.locator('[data-test=legal-back]').click();
    await page.waitForURL(/\/login/);
    ok('→ Privacy → Back to the login screen');

    // ---- 3
    const es = await open('es-MX');
    await es.goto(url('/login'), { waitUntil: 'networkidle' });
    await es.locator('[data-test=login-legal]').getByText('Privacidad').click();
    await es.locator('[data-test=legal-english-only]').waitFor();
    ok('Spanish phone: "Privacidad", with the English-only note');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    console.log('All legal page checks passed');
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
