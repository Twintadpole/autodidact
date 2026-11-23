// Phase 7B: one-time dates, business details, chemical costs, invoices, visit recap (Nov 2026), phone size.
//  1. One-time date: today → under today's group (counted); in 10 days → "Coming up".
//  2. Business details (only when none exist yet; removed again afterwards): name, payment
//     instructions, terms, logo.
//  3. Chemical cost: a priced chemical dosed on a visit gets its cost when the visit is saved,
//     shown on the visit details for the owner only.
//  4. Visit recap: preview has tasks, readings, chemicals added (no cost) and the customer
//     note, never the private visit note; sharing it records "recap sent".
//  5. Invoice: from the customer screen; extra line; PDF (shared via a stubbed share sheet) has
//     the lines and totals and no chemical cost; Mark sent; part payment then paid in full.
//  6. Monthly drafts (only on a database where no other customer has a monthly rate);
//     a draft can be deleted, a sent invoice voided.
// Creates its own "E2E test …" customer and chemical and hides them (and their invoices) at the end.
//
//   node invoices-recap.cjs <baseUrl> <password> <outDir>
const { chromium, devices } = require('playwright');

(async () => {
  const [base, password, out] = process.argv.slice(2);
  const url = (p) => new URL(p, base).toString();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const api = ctx.request;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let step = 0;
  const ok = (m) => console.log(`✓ ${++step}. ${m}`);
  const customers = [];
  const chemicals = [];
  let createdSettings = false;
  const SETTINGS_ID = '00000000-0000-4000-8000-000000000001';
  const getJson = async (p) => (await api.get(url(`/api${p}`))).json();
  const waitFor = async (fn, ms = 30000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn().catch(() => null);
      if (v) return v;
      if (Date.now() > end) return null;
      await new Promise((r) => setTimeout(r, 1000));
    }
  };
  const iso = () => new Date().toISOString();
  const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tag = Date.now().toString(36);

  // A stand-in for Android's share menu: records what the app shares.
  await ctx.addInitScript(() => {
    window.__shares = [];
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      const files = [];
      for (const f of data.files || []) {
        const buf = new Uint8Array(await f.arrayBuffer());
        let s = '';
        for (const b of buf) s += String.fromCharCode(b);
        files.push({ name: f.name, type: f.type, b64: btoa(s) });
      }
      window.__shares.push({ title: data.title, text: data.text, files });
    };
  });
  const lastShare = () => page.evaluate(() => window.__shares[window.__shares.length - 1] || null);

  try {
    await page.goto(url('/login'), { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL || 'owner');
    await page.getByLabel('Password').fill(password);
    await page.locator('[data-test=login]').click();
    await page.locator('[data-test=done-count]').waitFor();

    const c = await (await api.post(url('/api/customers'), { data: { name: `E2E test ${tag}`, email: 'e2e-customer@example.com', address: { line1: '5 Invoice Way', city: 'Dallas', state: 'TX', zip: '75201' }, monthlyRate: 150, paymentMethod: 'check' } })).json();
    customers.push(c._id);

    // ---- 1. One-time date
    await page.goto(url(`/customers/${c._id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=add-pool]').click();
    await page.locator('[data-test=pool-day]').click();
    await page.getByRole('option', { name: 'One-time date' }).click();
    await page.locator('[data-test=pool-once-date]').fill(localDate(new Date()));
    await page.locator('[data-test=pool-save]').click();
    await page.waitForURL(/\/pools\/[0-9a-f-]{36}\/overview$/);
    const poolId = page.url().split('/').slice(-2)[0];
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    const todayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    await page.locator(`[data-test=once-${poolId}]`).waitFor();
    const inToday = await page.evaluate(([pid, day]) => {
      const header = document.querySelector(`[data-test=route-group-${day}]`);
      const row = document.querySelector(`[data-test=route-row-${pid}]`);
      return !!(header && row && header.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, [poolId, todayKey]);
    if (!inToday) throw new Error("one-time pool isn't under today's group");
    await page.goto(url(`/pools/${poolId}/edit`), { waitUntil: 'networkidle' });
    const later = new Date(Date.now() + 10 * 86400000);
    await page.locator('[data-test=pool-once-date]').fill(localDate(later));
    await page.locator('[data-test=pool-save]').click();
    await page.waitForURL(/\/overview$/);
    await page.goto(url('/'), { waitUntil: 'networkidle' });
    await page.locator('[data-test=route-group-upcoming]').waitFor();
    const p1 = await waitFor(async () => {
      const p = (await getJson(`/pools?customerId=${c._id}`)).find((x) => x._id === poolId);
      return p && String(p.oneTimeDate).startsWith(localDate(later)) ? p : null;
    });
    if (!p1 || p1.serviceDay) throw new Error(`one-time date not on the server: ${JSON.stringify(p1)}`);
    ok(`one-time date: today → under today's group; ${localDate(later)} → "Coming up"; saved on the server`);

    // ---- 2. Business details (only on a database that has none)
    const existingSettings = (await getJson('/sync/pull')).settings?.find((s) => s._id === SETTINGS_ID && !s.deletedAt);
    if (!existingSettings) {
      createdSettings = true;
      await page.goto(url('/more/business'), { waitUntil: 'networkidle' });
      await page.locator('[data-test=business-name]').fill('E2E Pool Co');
      await page.locator('[data-test=business-phone]').fill('(214) 555-0100');
      await page.locator('[data-test=business-payment]').fill('Checks payable to E2E Pool Co · Zelle: pay@example.com');
      await page.locator('[data-test=business-terms]').click();
      await page.getByRole('option', { name: 'Net 15' }).click();
      const png = await page.evaluate(async () => {
        const cv = document.createElement('canvas');
        cv.width = 600;
        cv.height = 600;
        const g = cv.getContext('2d');
        g.fillStyle = '#1b4f72';
        g.beginPath();
        g.arc(300, 300, 280, 0, 7);
        g.fill();
        const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (const b of buf) s += String.fromCharCode(b);
        return btoa(s);
      });
      await page.locator('[data-test=business-logo-input]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await page.locator('[data-test=business-logo] img').waitFor();
      await page.locator('[data-test=business-save]').click();
      const s = await waitFor(async () => (await getJson('/sync/pull')).settings?.find((x) => x._id === SETTINGS_ID && x.businessName === 'E2E Pool Co'));
      if (!s || s.terms !== 'net15' || !String(s.logoDataUrl).startsWith('data:image/png') || !/Zelle/.test(s.paymentInstructions)) throw new Error(`business details not saved: ${JSON.stringify({ ...s, logoDataUrl: s?.logoDataUrl?.slice(0, 30) })}`);
      ok('business details saved: name, phone, payment instructions, Net 15, logo (shrunk on the phone)');
    } else {
      ok(`business details already set ("${existingSettings.businessName ?? ''}"): left untouched`);
    }
    const biz = (await getJson('/sync/pull')).settings?.find((s) => s._id === SETTINGS_ID && !s.deletedAt);

    // ---- 3. Chemical cost on a visit
    const chem = await (await api.post(url('/api/chemicals'), { data: { name: `E2E test chlorine ${tag}`, defaultUnit: 'gal', price: 4.5, priceUnit: 'gal' } })).json();
    chemicals.push(chem._id);
    const weeklyPool = await (await api.post(url('/api/pools'), { data: { customerId: c._id, name: 'Pool', type: 'chlorine', volumeGal: 15000, serviceDay: todayKey, routeOrder: 995 } })).json();
    const visitId = crypto.randomUUID();
    const now = iso();
    const privateNote = `PRIVATE-NOTE-${tag}`;
    await api.post(url('/api/sync/package'), {
      data: {
        packageId: crypto.randomUUID(),
        poolId: weeklyPool._id,
        createdAt: now,
        visit: { _id: visitId, poolId: weeklyPool._id, visitedAt: now, createdAt: now, updatedAt: now, readings: { fc: 3, ph: 7.5 }, doses: [{ chemicalId: chem._id, amount: 2, unit: 'gal' }], tasks: { brushed: true, skimmerBaskets: true }, notes: privateNote },
      },
    });
    // The app loads the chemical, then the owner opens today's visit and saves it.
    await page.goto(url('/more/chemicals'), { waitUntil: 'networkidle' });
    await page.getByText(`E2E test chlorine ${tag}`).waitFor({ timeout: 20000 });
    await page.goto(url(`/pools/${weeklyPool._id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=current-visit] [data-test=reading-filterPsi]').fill('20');
    await page.locator('button[data-test=save-visit]').click();
    await page.locator('div[data-test=save-visit]').waitFor({ timeout: 20000 });
    const v1 = await waitFor(async () => {
      const list = await getJson(`/pools/${weeklyPool._id}/visits`);
      const v = (Array.isArray(list) ? list : list.items ?? list.visits ?? []).find((x) => x._id === visitId);
      return v?.doses?.[0]?.cost === 9 ? v : null;
    });
    if (!v1) throw new Error('dose cost (2 gal × $4.50 = $9.00) not saved with the visit');
    await page.goto(url(`/pools/${weeklyPool._id}/visits/${visitId}`), { waitUntil: 'networkidle' });
    const costLine = await page.locator('[data-test=visit-chem-cost]').innerText();
    if (!/\$9\.00/.test(costLine)) throw new Error(`cost line: ${costLine}`);
    ok(`chemical cost: 2 gal at $4.50/gal → $9.00 saved with the dose; visit details show "${costLine.replace(/\s+/g, ' ').trim()}"`);

    // ---- 4. Visit recap
    await page.locator('[data-test=send-recap]').click();
    await page.waitForURL(/\/recap$/);
    await page.locator('[data-test=recap-note]').fill('Water looks great. See you next week!');
    const preview = await page.locator('[data-test=recap-preview]').innerText();
    for (const want of ['Brushed the walls and steps', 'Emptied the skimmer baskets', 'Free chlorine: 3 ppm', 'pH: 7.5', `E2E test chlorine ${tag}: 2 gal`, 'Water looks great']) {
      if (!preview.includes(want)) throw new Error(`recap missing "${want}":\n${preview}`);
    }
    for (const never of ['$', '9.00', '4.5', privateNote, 'cost']) if (preview.toLowerCase().includes(never.toLowerCase())) throw new Error(`recap contains "${never}":\n${preview}`);
    const mailto = await page.locator('[data-test=recap-email]').getAttribute('href');
    if (!mailto?.startsWith('mailto:e2e-customer%40example.com?subject=') && !mailto?.startsWith('mailto:e2e-customer@example.com?subject=')) throw new Error(`mailto: ${mailto}`);
    await page.locator('[data-test=recap-chemicals]').click(); // chemicals off
    if ((await page.locator('[data-test=recap-preview]').innerText()).includes('Chemicals added')) throw new Error('chemicals still in the recap after switching them off');
    await page.locator('[data-test=recap-share]').click();
    await page.locator('.q-dialog').getByRole('button', { name: 'Mark sent' }).click();
    await page.locator('[data-test=recap-sent]').waitFor();
    const shared = await lastShare();
    if (!shared || !shared.text.includes('Water looks great') || shared.text.includes(privateNote)) throw new Error(`shared recap: ${JSON.stringify(shared)?.slice(0, 300)}`);
    const v2 = await waitFor(async () => {
      const list = await getJson(`/pools/${weeklyPool._id}/visits`);
      const v = (Array.isArray(list) ? list : list.items ?? list.visits ?? []).find((x) => x._id === visitId);
      return v?.recapSentAt && v.customerNote === 'Water looks great. See you next week!' && v.notes === privateNote ? v : null;
    });
    if (!v2) throw new Error('recap sent / customer note not on the server (or the private note changed)');
    await page.screenshot({ path: `${out}/recap.png`, fullPage: true });
    ok('recap: tasks, readings, chemicals (no cost, no private note), customer note; Share → Mark sent → saved on the server');

    // ---- 5. Invoice from the customer screen
    await page.goto(url(`/customers/${c._id}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=new-invoice]').click();
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
    const invId = page.url().split('/').pop();
    const desc0 = await page.locator('[data-test=line-desc-0]').inputValue();
    if (!/^Monthly pool service · /.test(desc0) || (await page.locator('[data-test=line-amount-0]').inputValue()) !== '150') throw new Error(`first line: ${desc0}`);
    await page.locator('[data-test=add-line]').click();
    await page.locator('[data-test=line-desc-1]').fill('Filter cartridge');
    await page.locator('[data-test=line-amount-1]').fill('85');
    await page.locator('[data-test=invoice-notes]').fill('Thanks for choosing us!');
    await page.locator('[data-test=invoice-save]').click();
    await page.locator('[data-test=invoice-save]').waitFor({ state: 'hidden' });
    if ((await page.locator('[data-test=invoice-total]').innerText()).trim() !== '$235.00') throw new Error('total is not $235.00');
    await page.locator('[data-test=invoice-share]').click();
    await page.locator('.q-dialog').getByRole('button', { name: 'Mark sent' }).click();
    await page.locator('[data-test=invoice-state]').filter({ hasText: 'Sent' }).waitFor();
    const pdfShare = await lastShare();
    const pdf = pdfShare?.files?.[0];
    if (!pdf || pdf.type !== 'application/pdf' || !/^Invoice-\d+\.pdf$/.test(pdf.name)) throw new Error(`PDF not shared: ${JSON.stringify(pdfShare)?.slice(0, 200)}`);
    const raw = Buffer.from(pdf.b64, 'base64').toString('latin1');
    for (const want of ['INVOICE', 'Monthly pool service', 'Filter cartridge', '$235.00', 'BILL TO', `E2E test ${tag}`, 'Thanks for choosing us!']) if (!raw.includes(want)) throw new Error(`PDF missing "${want}"`);
    if (biz?.paymentInstructions && !raw.includes('HOW TO PAY')) throw new Error('PDF missing payment instructions');
    for (const never of ['$9.00', 'E2E test chlorine', privateNote]) if (raw.includes(never)) throw new Error(`PDF contains "${never}"`);
    require('fs').writeFileSync(`${out}/${pdf.name}`, Buffer.from(pdf.b64, 'base64'));

    // Part payment, then the rest.
    await page.locator('[data-test=invoice-pay]').click();
    await page.locator('[data-test=payment-amount]').fill('100');
    await page.locator('[data-test=payment-reference]').fill('#2231');
    await page.locator('[data-test=payment-save]').click();
    await page.locator('[data-test=invoice-balance]').filter({ hasText: '$135.00' }).waitFor();
    if ((await page.locator('[data-test=invoice-state]').innerText()).trim() !== 'Sent') throw new Error('part-paid invoice should still be Sent');
    await page.locator('[data-test=invoice-pay]').click();
    if ((await page.locator('[data-test=payment-amount]').inputValue()) !== '135') throw new Error('payment amount should start at the balance');
    await page.locator('[data-test=payment-save]').click();
    await page.locator('[data-test=invoice-state]').filter({ hasText: 'Paid' }).waitFor();
    const inv = await waitFor(async () => {
      const i = await getJson(`/invoices/${invId}`);
      return i?.payments?.length === 2 && i.status === 'sent' ? i : null;
    });
    if (!inv || inv.payments[0].method !== 'check' || inv.payments[0].reference !== '#2231' || inv.lines.length !== 2) throw new Error(`invoice on the server: ${JSON.stringify(inv)}`);
    await page.screenshot({ path: `${out}/invoice.png`, fullPage: true });
    ok(`invoice #${inv.number}: $150 + $85 = $235; PDF shared (lines, totals, no chemical cost); Sent; $100 check #2231 then $135 → Paid`);

    // ---- 6. Monthly drafts (only when no other customer has a rate), delete a draft, void a sent one
    const all = await getJson('/customers');
    const others = all.filter((x) => x._id !== c._id && !x.deletedAt && (x.status ?? 'current') === 'current' && x.monthlyRate > 0);
    if (!others.length) {
      // c already has a November invoice: bill next month so it gets exactly one draft.
      await page.goto(url('/more/invoices'), { waitUntil: 'networkidle' });
      await page.locator('[data-test=invoices-period]').click();
      await page.getByRole('option').last().click();
      await page.locator('[data-test=create-monthly]').click();
      await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/, { timeout: 15000 }).catch(async (e) => {
        await page.screenshot({ path: `${out}/monthly-debug.png` });
        throw new Error(`no draft opened: ${(await page.locator('.q-notification, .q-page').first().innerText()).replace(/\s+/g, ' ').slice(0, 300)} (${e.message.split('\n')[0]})`);
      });
      await page.locator('[data-test=invoice-state]').filter({ hasText: 'Draft' }).waitFor();
      await page.locator('[data-test=invoice-delete]').click();
      await page.locator('.q-dialog').getByRole('button', { name: 'Delete' }).click();
      await page.waitForURL(/\/more\/invoices$/, { timeout: 15000 }).catch(async (e) => {
        await page.screenshot({ path: `${out}/delete-debug.png` });
        throw new Error(`after delete: at ${page.url()}: ${(await page.locator('.q-page').first().innerText()).replace(/\s+/g, ' ').slice(0, 200)} (${e.message.split('\n')[0]})`);
      });
      ok('monthly drafts: one draft for next month (the only customer with a rate); draft deleted');
    } else {
      ok(`monthly drafts skipped: ${others.length} real customer(s) have a monthly rate`);
    }
    await page.goto(url(`/invoices/${invId}`), { waitUntil: 'networkidle' });
    await page.locator('[data-test=invoice-void]').click();
    await page.locator('.q-dialog').getByRole('button', { name: 'Void' }).click();
    await page.locator('[data-test=invoice-state]').filter({ hasText: 'Void' }).waitFor();
    if (!(await waitFor(async () => ((await getJson(`/invoices/${invId}`)).status === 'void' ? true : null)))) throw new Error('void not on the server');
    ok('a sent invoice can be voided (kept on record)');

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    for (const id of customers) {
      for (const i of await getJson(`/invoices?customerId=${id}`).catch(() => [])) await api.delete(url(`/api/invoices/${i._id}`)).catch(() => undefined);
      await api.delete(url(`/api/customers/${id}`)).catch(() => undefined);
    }
    for (const id of chemicals) await api.delete(url(`/api/chemicals/${id}`)).catch(() => undefined);
    if (createdSettings) await api.delete(url(`/api/settings/${SETTINGS_ID}`)).catch(() => undefined);
    console.log(`  (test customer, chemical and invoices hidden${createdSettings ? '; test business details removed' : ''})`);
    await browser.close();
  }
  console.log(`ALL ${step} CHECKS PASSED`);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
