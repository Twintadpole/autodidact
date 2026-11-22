// Beta segment 3: Help, Send feedback, the Beta label, app errors. Phone size.
//  1. The login screen shows the Beta label.
//  2. More has Help and Send feedback; the version line has the Beta label and the legal line.
//  3. Help lists the topics; search "timer" finds "Doing a visit"; a topic opens; support email shown.
//  4. The "?" on the Route opens the Route's own topic.
//  5. Send feedback from the Route's "?" → Help → Send feedback: sent with the screen; it's listed.
//  6. Offline: the note waits on the phone; back online, it's sent (listed once).
//  7. In Spanish: the Help list and a topic are translated (then back to English).
//  8. An error in the app is reported to the server (/client-log answers ok).
//  9. Desktop view: the "?" opens Help inside the desktop view.
// Cleans up nothing it can't: the feedback notes it sends stay (marked "e2e").
//
//   node help-feedback.cjs <baseUrl> <password> <outDir>
const { chromium } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const email = process.env.E2E_EMAIL || 'owner';
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const stamp = `e2e ${Date.now()}`;

  try {
    // ---- 1
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=beta-badge]').waitFor();
    ok('login screen shows the Beta label');

    await page.locator('[data-test=email] input, input[data-test=email]').first().fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();

    // ---- 2
    await page.goto(url('/more'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=more-help]').waitFor();
    await page.locator('[data-test=more-feedback]').waitFor();
    const footer = await page.locator('[data-test=app-version]').innerText();
    if (!/Beta/.test(footer) || !/S R Donaldson, all rights reserved/.test(footer)) throw new Error(`footer: ${footer}`);
    await page.screenshot({ path: `${out}/help-more.png` });
    ok('More: Help, Send feedback, Beta and the legal line');

    // ---- 3
    await page.locator('[data-test=more-help]').click();
    await page.locator('[data-test=help-list]').waitFor();
    const count = await page.locator('[data-test=help-list] .q-item').count();
    if (count < 10) throw new Error(`only ${count} topics`);
    await page.locator('[data-test=help-support] a[href^="mailto:steven@evolutiondfw.com"]').waitFor();
    await page.screenshot({ path: `${out}/help-list.png` });
    await page.locator('[data-test=help-search] input, input[data-test=help-search]').fill('timer');
    await page.locator('[data-test=help-visit]').waitFor();
    if (await page.locator('[data-test=help-invoices]').count()) throw new Error('search "timer" still lists Invoices');
    await page.locator('[data-test=help-visit]').click();
    await page.locator('[data-test=help-topic-title]', { hasText: 'Doing a visit' }).waitFor();
    await page.getByText('Start the timer when you arrive.').waitFor();
    await page.screenshot({ path: `${out}/help-topic.png` });
    ok(`Help: ${count} topics, search "timer" → Doing a visit, support email`);

    // ---- 4
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=help-button]').click();
    await page.locator('[data-test=help-topic-title]', { hasText: 'The route' }).waitFor();
    ok('"?" on the Route opens "The route"');

    // ---- 5
    await page.locator('[data-test=help-feedback]').click();
    await page.locator('[data-test=feedback-page]').waitFor();
    await page.getByText('this screen (/)').waitFor();
    await page.locator('[data-test=feedback-kind]').getByText('Idea').click();
    await page.locator('[data-test=feedback-text] textarea, textarea[data-test=feedback-text]').fill(`${stamp} online note`);
    await page.locator('[data-test=feedback-send]').click();
    await page.getByText('Thanks! Your feedback was sent.').waitFor();
    await page.locator('[data-test=feedback-item]', { hasText: `${stamp} online note` }).waitFor();
    const item = await page.locator('[data-test=feedback-item]', { hasText: `${stamp} online note` }).innerText();
    if (!/ · \/ · v\d/.test(item)) throw new Error(`no screen/version: ${item}`);
    await page.screenshot({ path: `${out}/help-feedback.png` });
    ok('feedback sent with its screen and version, and listed');

    // ---- 6
    await ctx.setOffline(true);
    await page.locator('[data-test=feedback-text] textarea, textarea[data-test=feedback-text]').fill(`${stamp} offline note`);
    await page.locator('[data-test=feedback-send]').click();
    await page.getByText('Saved on phone. It’s sent when there’s signal.').waitFor();
    await page.locator('[data-test=feedback-waiting]').waitFor();
    await ctx.setOffline(false);
    await page.waitForFunction(() => !localStorage.getItem('pool.feedbackQueue'), null, { timeout: 15000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-test=feedback-item]', { hasText: `${stamp} offline note` }).waitFor();
    const copies = await page.locator('[data-test=feedback-item]', { hasText: `${stamp} offline note` }).count();
    if (copies !== 1) throw new Error(`${copies} copies of the offline note`);
    ok('offline: the note waited, then was sent once');

    // ---- 7
    await page.goto(url('/more/account'), { waitUntil: 'networkidle' });
    const setLang = async (label) => {
      await page.locator('.q-field', { has: page.locator('[data-test=language]') }).click();
      await page.getByRole('option', { name: label }).click();
      await page.waitForTimeout(800);
    };
    await setLang(/Español/);
    await page.goto(url('/more/help'), { waitUntil: 'networkidle' });
    await page.getByText('Primeros pasos').waitFor();
    await page.getByText('Hacer una visita').click();
    await page.getByText('Inicia el cronómetro al llegar.').waitFor();
    const text = await page.locator('body').innerText();
    if (/undefined|\{[a-z]+\}/.test(text)) throw new Error('odd text in Spanish help');
    await page.screenshot({ path: `${out}/help-topic-es.png` });
    await page.goto(url('/more/account'), { waitUntil: 'networkidle' });
    await setLang('English');
    ok('Help in Spanish (then back to English)');

    // ---- 8
    const reported = page.waitForResponse((r) => r.url().endsWith('/api/client-log') && r.request().method() === 'POST', { timeout: 10000 });
    await page.evaluate((s) => setTimeout(() => { throw new Error(`${s} test error`); }), stamp);
    const res = await reported;
    const body = JSON.parse(res.request().postData() || '{}');
    if (res.status() !== 200 || !body.appVersion || !body.screen) throw new Error(`client-log: ${res.status()} ${JSON.stringify(body)}`);
    errors.splice(errors.findIndex((e) => e.includes('test error')), 1);
    ok(`an app error is reported (screen ${body.screen}, v${body.appVersion})`);

    // ---- 9
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(url('/desk/customers'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=beta-badge]').waitFor();
    await page.locator('[data-test=help-button]').click();
    await page.waitForURL(/\/desk\/help\/customers/);
    await page.locator('[data-test=help-topic-title]', { hasText: 'Customers and pools' }).waitFor();
    await page.screenshot({ path: `${out}/help-desk.png` });
    ok('desktop view: "?" opens Help in the desktop view');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    console.log('All help/feedback checks passed');
  } catch (e) {
    console.error('FAILED:', e.message);
    await page.screenshot({ path: `${out}/help-failure.png` }).catch(() => {});
    process.exitCode = 1;
  } finally {
    // The language choice went back to the phone's own (other scripts expect that).
    await ctx.request.patch(url('/api/auth/me'), { data: { language: null } }).catch(() => undefined);
    await browser.close();
  }
})();
