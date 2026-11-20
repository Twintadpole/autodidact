// Dummy data for a demo tenant (made-up names, 555-01xx phone numbers, "Test" streets), sent
// through the tenant's edge address like the app would:
//   node seed-demo.cjs <edge host:port> <tenant host> <owner email> <owner password> <business name> <customers> <seed>
// Business details, chemical prices, one tech with half the pools on their route, customers and
// pools (some with a spa and equipment), six weeks of visits (readings, chemicals, time), a few
// issues, this month's invoices and some expenses. Refuses a tenant that already has customers.
const http = require('node:http');
const crypto = require('node:crypto');

const [edge, host, email, password, business, howMany, seedArg] = process.argv.slice(2);
const [edgeHost, edgePort] = edge.split(':');
let seed = Number(seedArg) || 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi, step = 1) => Math.round((lo + rnd() * (hi - lo)) / step) * step;
const id = () => crypto.randomUUID();
let cookie = '';

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      { host: edgeHost, port: Number(edgePort), method, path: `/api${path}`, headers: { host, ...(cookie && { cookie }), ...(data && { 'content-type': 'application/json' }) } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const sc = res.headers['set-cookie'];
          if (sc) cookie = String(sc[0]).split(';')[0];
          if (res.statusCode >= 400) return reject(new Error(`${method} ${path}: ${res.statusCode} ${text.slice(0, 300)}`));
          resolve(text ? JSON.parse(text) : null);
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const FIRST = ['Avery', 'Blake', 'Casey', 'Dana', 'Ellis', 'Finley', 'Gray', 'Harper', 'Indy', 'Jordan', 'Kendall', 'Logan', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sage', 'Taylor'];
const LAST = ['Adams', 'Brooks', 'Carter', 'Diaz', 'Evans', 'Foster', 'Garcia', 'Hughes', 'Irwin', 'James', 'Kim', 'Lopez', 'Moore', 'Nguyen', 'Ortiz', 'Patel', 'Reed', 'Shaw', 'Torres', 'Vega'];
const STREETS = ['Maple', 'Cedar', 'Willow', 'Lakeview', 'Sunset', 'Briar', 'Pecan', 'Mesquite', 'Bluebonnet', 'Juniper'];
const CITIES = ['Testville', 'Sampletown', 'Demo Springs'];
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

(async () => {
  await call('POST', '/auth/login', { email, password, remember: false });
  if ((await call('GET', '/customers')).length) throw new Error(`${host} already has customers; not adding dummy data twice`);

  const now = new Date();
  const iso = (d) => d.toISOString();
  await call('POST', '/settings', { _id: '00000000-0000-4000-8000-000000000001', businessName: business, phone: '(555) 010-0100', email: `office@${host.split('.')[0]}.example`, paymentInstructions: 'Demo only: no real payments.', mileageRate: 0.67 });

  // Chemical prices (per each chemical's own unit).
  const PRICE = { 'Liquid chlorine': 5.5, 'Cal-hypo': 3.2, 'Trichlor tabs': 1.1, 'Muriatic acid': 0.12, 'Sodium bicarb': 0.9, 'Soda ash': 1.2, 'Calcium chloride': 1.0, 'CYA / stabilizer': 4.5, Salt: 0.25, 'Phosphate remover': 0.6, Algaecide: 0.5 };
  const chems = await call('GET', '/chemicals');
  for (const c of chems) if (PRICE[c.name]) await call('PATCH', `/chemicals/${c._id}`, { price: PRICE[c.name], priceUnit: c.defaultUnit });
  const chem = (name) => chems.find((c) => c.name === name);

  const tech = await call('POST', '/team', { email: `tech@${host.split('.')[0]}.example`, name: `${pick(FIRST)} (tech)`, role: 'tech' });

  const n = Number(howMany) || 12;
  const pools = [];
  const customers = [];
  for (let i = 0; i < n; i++) {
    const status = i === n - 1 ? 'past' : i === n - 2 ? 'prospect' : 'current';
    const rate = status === 'prospect' ? null : between(120, 220, 5);
    const c = await call('POST', '/customers', {
      name: `${FIRST[(i * 7 + Number(seedArg)) % FIRST.length]} ${LAST[(i * 3 + Number(seedArg)) % LAST.length]}`,
      phones: [{ label: 'mobile', number: `+1555010${String(10 + i).padStart(4, '0').slice(-4)}`.slice(0, 12) }],
      email: `customer${i + 1}@${host.split('.')[0]}.example`,
      address: { line1: `${between(100, 9900)} ${pick(STREETS)} Test St`, city: pick(CITIES), state: 'TX', zip: `7${between(5000, 5999)}` },
      status,
      ...(rate && { monthlyRate: rate, paymentMethod: pick(['check', 'cash', 'electronic']) }),
      distanceMiles: between(2, 25, 0.5),
      startDate: '2026-01-15',
      notes: 'Dummy customer (demo data).',
    });
    customers.push({ ...c, rate });
    const salt = rnd() < 0.5;
    const main = await call('POST', '/pools', {
      customerId: c._id,
      name: 'Pool',
      type: salt ? 'salt' : 'chlorine',
      surface: pick(['Plaster', 'Pebble', 'Quartz']),
      volumeGal: between(12000, 30000, 500),
      serviceDay: DAYS[i % DAYS.length],
      routeOrder: Math.floor(i / DAYS.length) + 1,
      accessNotes: `Gate code ${between(1000, 9999)}`,
      active: status === 'current',
      equipment: [
        { _id: id(), kind: 'pump', model: pick(['VS Pump 1.5HP', 'VS Pump 2.7HP']), installedOn: '2021-04-01' },
        { _id: id(), kind: 'filter', model: pick(['Cartridge 420', 'DE 60']) },
        ...(salt ? [{ _id: id(), kind: 'saltCell', model: 'Cell 40k' }] : []),
      ],
      ...(i % 2 === 0 && { techId: tech.member._id }),
    });
    pools.push({ ...main, salt, status });
    if (i % 4 === 1) pools.push({ ...(await call('POST', '/pools', { customerId: c._id, name: 'Spa', type: 'chlorine', volumeGal: 500, serviceDay: DAYS[i % DAYS.length], routeOrder: 9, active: status === 'current' })), salt: false, status });
  }

  // Six weeks of weekly visits for current pools.
  let visits = 0;
  for (const p of pools.filter((x) => x.status === 'current')) {
    for (let w = 6; w >= 1; w--) {
      const day = new Date(now.getTime() - w * 7 * 86_400_000 - between(0, 2) * 86_400_000);
      day.setUTCHours(between(14, 21), between(0, 59), 0, 0);
      const minutes = between(18, 42);
      const doses = [];
      const fc = between(0.5, 5, 0.1);
      if (fc < 2) doses.push({ chemicalId: chem('Liquid chlorine')._id, amount: between(1, 3), unit: 'gal' });
      const ph = between(7.1, 8.0, 0.1);
      if (ph > 7.7) doses.push({ chemicalId: chem('Muriatic acid')._id, amount: between(16, 48, 8), unit: 'fl oz' });
      if (p.salt && rnd() < 0.2) doses.push({ chemicalId: chem('Salt')._id, amount: 40, unit: 'lb' });
      for (const d of doses) d.cost = Math.round(d.amount * PRICE[chems.find((c) => c._id === d.chemicalId).name] * 100) / 100;
      await call('POST', '/sync/package', {
        packageId: id(),
        poolId: p._id,
        createdAt: iso(day),
        visit: {
          _id: id(),
          poolId: p._id,
          visitedAt: iso(day),
          readings: { fc, ph, ta: between(60, 130, 10), cya: between(20, 80, 10), ...(p.salt && { salt: between(2600, 3800, 100) }), tempF: between(55, 75) },
          doses,
          tasks: { brushed: true, skimmed: true, vacuumed: rnd() < 0.5, skimmerBaskets: true, pumpBasket: rnd() < 0.7, filterCleaned: rnd() < 0.15, basketsEmptied: false },
          timeLog: { segments: [{ start: iso(day), end: iso(new Date(day.getTime() + minutes * 60_000)) }], finished: true },
          createdAt: iso(day),
          updatedAt: iso(day),
        },
      });
      visits++;
    }
  }
  // A few issues.
  for (const [p, title, urgent] of [[pools[0], 'Pump making a grinding noise', true], [pools[2], 'Light not working', false], [pools[4], 'Cracked skimmer lid', false]]) {
    if (p) await call('POST', '/issues', { poolId: p._id, title, urgent, important: true, description: 'Dummy issue (demo data).' });
  }
  // This month's invoices for current customers with a rate.
  let number = 1001;
  const period = now.toISOString().slice(0, 7);
  for (const c of customers.filter((x) => x.rate && x.status === 'current')) {
    await call('POST', '/invoices', { customerId: c._id, number: number++, period, issueDate: `${period}-01`, lines: [{ _id: id(), description: `Weekly pool service, ${period}`, amount: c.rate }], status: 'draft' });
  }
  // Some expenses and mileage.
  for (const [category, amount, vendor] of [['supplies', 84.5, 'Demo Pool Supply'], ['tools', 129, 'Demo Hardware'], ['fuel', 46.2, 'Demo Gas']]) {
    await call('POST', '/ledger', { kind: 'expense', date: `${period}-05`, amount, category, vendor, note: 'Dummy expense (demo data).' });
  }
  await call('POST', '/ledger', { kind: 'mileage', date: `${period}-06`, amount: 64, note: 'Dummy miles (demo data).' });

  console.log(JSON.stringify({ business, customers: customers.length, pools: pools.length, visits, techPools: pools.filter((p) => p.techId).length, invoices: number - 1001, tech: tech.member.email, techPassword: '(not printed)' }));
})().catch((e) => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
