// Beta segment 2: onboarding. Phone size. Test environment only (it adds a tech login; turned off at the end).
//  1. Owner: the Getting started card is on the Route, with its count; a step opens its screen.
//  2. Hide: the card goes and stays gone after a reload.
//  3. Team → add a tech → Invite: the share sheet gets the app's address, their login and the temporary password.
//  4. The tech's first login: choose a password → three welcome screens ("Your route") → gone for good.
//  5. The tech sees no Getting started card.
//
//   node onboarding.cjs <baseUrl> <password> <outDir>
const { chromium } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const email = process.env.E2E_EMAIL || 'owner';
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const errors = [];
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'en-US' });
    // A phone's share sheet: remember what was shared.
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = d; } });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page };
  };
  const login = async (page, who, pw) => {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=email] input, input[data-test=email]').first().fill(who);
    await page.locator('input[type=password]').fill(pw);
    await page.locator('[data-test=login]').click();
  };
  const tag = Date.now().toString(36);
  const techEmail = `onboard.${tag}@example.com`;
  let owner;
  let techId = null;

  try {
    // ---- 1
    owner = await newPage();
    const p = owner.page;
    await login(p, email, password);
    await p.locator('[data-test=done-count]').waitFor();
    const card = p.locator('[data-test=getting-started]');
    await card.waitFor();
    const count = await p.locator('[data-test=getting-started-count]').innerText();
    if (!/^\d+ of 8 done$/.test(count)) throw new Error(`count: ${count}`);
    await p.screenshot({ path: `${out}/onboard-card.png` });
    await p.locator('[data-test=getting-started-prices]').click();
    await p.waitForURL(/\/more\/chemicals/);
    ok(`owner's Route: Getting started card (${count}); "Chemical prices" opens Chemicals`);

    // ---- 2
    await p.goto(url('/'), { waitUntil: 'networkidle' });
    await p.locator('[data-test=getting-started-hide]').click();
    await card.waitFor({ state: 'hidden' });
    await p.reload({ waitUntil: 'networkidle' });
    await p.locator('[data-test=done-count]').waitFor();
    await p.waitForTimeout(500);
    if (await card.count()) throw new Error('card back after reload');
    ok('Hide: the card stays hidden');

    // ---- 3
    await p.goto(url('/more/team'), { waitUntil: 'networkidle' });
    await p.locator('[data-test=team-add]').click();
    await p.locator('[data-test=team-new-name]').fill('Onboard Tech');
    await p.locator('[data-test=team-new-email]').fill(techEmail);
    await p.locator('[data-test=team-new-save]').click();
    const temp = (await p.locator('[data-test=team-temp-value]').innerText()).trim();
    await p.screenshot({ path: `${out}/onboard-temp.png` });
    await p.locator('[data-test=team-invite]').click();
    await p.waitForFunction(() => !!window.__shared);
    const shared = await p.evaluate(() => window.__shared);
    for (const want of [techEmail, temp, new URL(base).origin, 'Onboard Tech']) {
      if (!shared.text.includes(want)) throw new Error(`invite lacks ${want}: ${shared.text}`);
    }
    await p.locator('[data-test=team-temp-done]').click();
    const team = await (await owner.ctx.request.get(url('/api/team'))).json();
    techId = (team.members ?? team).find((m) => m.email === techEmail)?._id ?? null;
    ok('Invite shares the address, the login and the temporary password');
    console.log(`    ${shared.text.split('\n').join('\n    ')}`);

    // ---- 4
    const tech = await newPage();
    const q = tech.page;
    await login(q, techEmail, temp);
    await q.waitForURL(/\/more\/account\?change=1/);
    await q.locator('[data-test=account-current]').fill(temp);
    await q.locator('[data-test=account-new]').fill(`onboard-${tag}`);
    await q.locator('[data-test=account-new2]').fill(`onboard-${tag}`);
    await q.locator('[data-test=account-save]').click();
    await q.waitForURL((u) => new URL(u).pathname === '/');
    await q.locator('[data-test=welcome-title]').waitFor();
    if (!/^Welcome to /.test(await q.locator('[data-test=welcome-title]').innerText())) throw new Error('welcome title');
    await q.screenshot({ path: `${out}/onboard-welcome-1.png` });
    await q.locator('[data-test=welcome-next]').click();
    await q.locator('[data-test=welcome-title]', { hasText: 'Your route' }).waitFor();
    await q.screenshot({ path: `${out}/onboard-welcome-2.png` });
    await q.locator('[data-test=welcome-next]').click();
    await q.locator('[data-test=welcome-title]', { hasText: 'No signal? Keep working' }).waitFor();
    await q.locator('[data-test=welcome-done]').click();
    await q.locator('[data-test=welcome-title]').waitFor({ state: 'hidden' });
    await q.reload({ waitUntil: 'networkidle' });
    await q.locator('[data-test=done-count]').waitFor();
    await q.waitForTimeout(500);
    if (await q.locator('[data-test=welcome-title]').count()) throw new Error('welcome shown again');
    ok('tech first login: new password → 3 welcome screens ("Your route") → not shown again');

    // ---- 5
    if (await q.locator('[data-test=getting-started]').count()) throw new Error('tech sees the Getting started card');
    ok('the tech sees no Getting started card');
    await tech.ctx.close();

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
    console.log('All onboarding checks passed');
  } catch (e) {
    console.error('FAILED:', e.message);
    if (owner) await owner.page.screenshot({ path: `${out}/onboard-failure.png` }).catch(() => {});
    process.exitCode = 1;
  } finally {
    if (owner && techId) await owner.ctx.request.patch(url(`/api/team/${techId}`), { data: { active: false } }).catch(() => undefined);
    console.log('  (test tech login turned off)');
    await browser.close();
  }
})();
