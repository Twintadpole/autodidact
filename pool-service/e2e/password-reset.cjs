// Beta segment 4: password reset by email, end to end. Test environment only: it needs a test mail
// server (Mailpit; its API in MAILPIT, default http://127.0.0.1:8025) and the sender running
// (deploy/mail-lib.sh with an smtp:// URL to Mailpit). Adds a tech and a second owner; both turned off at the end.
//  1. Login → "Forgot password?" → the tech's email → "an email with a link is on its way".
//  2. The tech gets the link; the other owner gets a notice naming the business and the tech, without the link.
//  3. The link → a new password → back to Log in with the email filled in → logged in with it.
//  4. The same link again is refused ("expired or was already used").
//
//   MAILPIT=http://127.0.0.1:8025 node password-reset.cjs <baseUrl> <password> <outDir>
const { chromium, request } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const email = process.env.E2E_EMAIL || 'owner';
  const mailpit = process.env.MAILPIT || 'http://127.0.0.1:8025';
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const tag = Date.now().toString(36);
  const tech = { email: `reset.${tag}@example.com`, name: `Reset Tech ${tag}` };
  const boss = { email: `boss.${tag}@example.com`, name: `Second Owner ${tag}` };
  const owner = await request.newContext({ baseURL: base });
  const ids = [];

  /** Waits for a message to `to` in Mailpit; returns { subject, text }. */
  async function mailTo(to, timeout = 60000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const list = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
      const m = list.messages?.[0];
      if (m) {
        const full = await (await fetch(`${mailpit}/api/v1/message/${m.ID}`)).json();
        return { subject: full.Subject, text: full.Text, from: full.From?.Address };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`no email to ${to} within ${timeout / 1000} s`);
  }

  try {
    const login = await owner.post('/api/auth/login', { data: { email, password, remember: false } });
    if (!login.ok()) throw new Error(`owner login: ${login.status()}`);
    for (const p of [{ ...tech, role: 'tech' }, { ...boss, role: 'owner' }]) {
      const r = await owner.post('/api/team', { data: p });
      if (r.status() !== 201) throw new Error(`add ${p.email}: ${r.status()}`);
      ids.push((await r.json()).member._id);
    }

    // ---- 1
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=forgot]').click();
    await page.locator('[data-test=forgot-email]').waitFor();
    await page.locator('[data-test=forgot-email]').fill(tech.email);
    await page.screenshot({ path: `${out}/reset-forgot.png` });
    await page.locator('[data-test=forgot-send]').click();
    await page.locator('[data-test=forgot-sent]').waitFor();
    await page.getByText(`If ${tech.email} has a login, an email with a link is on its way.`).waitFor();
    ok('Forgot password? → email → "an email with a link is on its way"');

    // ---- 2
    const mail = await mailTo(tech.email);
    const link = mail.text.match(/https?:\/\/\S+\/reset\?token=[\w-]+/)?.[0];
    if (!link) throw new Error(`no link in: ${mail.text}`);
    if (!/reset your .* password/i.test(mail.subject)) throw new Error(`subject: ${mail.subject}`);
    const notice = await mailTo(boss.email);
    if (!notice.text.includes(tech.name) || !notice.text.includes(tech.email) || /token=/.test(notice.text)) throw new Error(`notice: ${notice.text}`);
    ok(`the tech got the link ("${mail.subject}", from ${mail.from}); the other owner got a notice without it`);

    // ---- 3
    await page.goto(link.replace(/^https?:\/\/[^/]+/, new URL(base).origin), { waitUntil: 'networkidle' });
    await page.locator('[data-test=reset-new]').fill(`reset-pass-${tag}`);
    await page.locator('[data-test=reset-new2]').fill(`reset-pass-${tag}`);
    await page.screenshot({ path: `${out}/reset-new.png` });
    await page.locator('[data-test=reset-save]').click();
    await page.waitForURL(/\/login/);
    const filled = await page.locator('[data-test=email] input, input[data-test=email]').first().inputValue();
    if (filled !== tech.email) throw new Error(`login email: ${filled}`);
    await page.locator('input[type=password]').fill(`reset-pass-${tag}`);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();
    ok('the link → new password → Log in (email filled in) → logged in with the new password');

    // ---- 4
    await page.goto(link.replace(/^https?:\/\/[^/]+/, new URL(base).origin), { waitUntil: 'networkidle' });
    await page.locator('[data-test=reset-new]').fill(`another-pass-${tag}`);
    await page.locator('[data-test=reset-new2]').fill(`another-pass-${tag}`);
    await page.locator('[data-test=reset-save]').click();
    await page.getByText('This link has expired or was already used. Ask for a new one.').waitFor();
    ok('the same link again is refused');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    console.log('All password reset checks passed');
  } catch (e) {
    console.error('FAILED:', e.message);
    await page.screenshot({ path: `${out}/reset-failure.png` }).catch(() => {});
    process.exitCode = 1;
  } finally {
    for (const id of ids) await owner.patch(`/api/team/${id}`, { data: { active: false } }).catch(() => undefined);
    console.log('  (test logins turned off)');
    await owner.dispose();
    await browser.close();
  }
})();
