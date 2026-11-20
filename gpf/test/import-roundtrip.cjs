// Round trip through two tenants (run by import-roundtrip.sh, through the edge as a visitor would):
//   seed   <edge> <host> <password>                  fill a tenant with varied customers and pools
//   import <edge> <host> <password> <xlsx> <src-host> <src-password>
//          import that tenant's "Export everything" into a blank tenant, compare, re-import, undo
// Uses node:http so the Host header picks the tenant.
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');

const [cmd, edge, host, password, xlsx, srcHost, srcPassword] = process.argv.slice(2);
const [edgeHost, edgePort] = edge.split(':');
let step = 0;
const ok = (m) => console.log(`  PASS  ${++step}. ${m}`);

function request(h, cookie, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: edgeHost, port: Number(edgePort), method, path: `/api${path}`, headers: { host: h, ...(cookie && { cookie }), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try {
          json = JSON.parse(buf.toString('utf8'));
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, buf });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const send = (h, cookie, method, path, data) => request(h, cookie, method, path, data && JSON.stringify(data), data ? { 'content-type': 'application/json' } : {});
async function login(h, pw) {
  const r = await send(h, null, 'POST', '/auth/login', { password: pw, remember: false });
  if (r.status !== 200) throw new Error(`login to ${h}: ${r.status}`);
  return String(r.headers['set-cookie'][0]).split(';')[0];
}
function multipart(fileName, data, options) {
  const b = `----rt${crypto.randomUUID()}`;
  const parts = [];
  if (options) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify(options)}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${b}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
const upload = (h, cookie, path, data, options) => {
  const m = multipart('everything.xlsx', data, options);
  return request(h, cookie, 'POST', path, m.body, m.headers);
};
const check = (cond, msg, detail) => {
  if (!cond) throw new Error(`${msg}${detail ? `: ${detail}` : ''}`);
  ok(msg);
};

// What must survive the trip: everything but ids and server times.
function customerKey(c) {
  return JSON.stringify({
    name: c.name, phones: c.phones ?? [], email: c.email ?? null, address: c.address ?? null, notes: c.notes ?? null,
    status: c.status ?? 'current', monthlyRate: c.monthlyRate ?? null, billingEmail: c.billingEmail ?? null,
    paymentMethod: c.paymentMethod ?? null, startDate: c.startDate ?? null, endDate: c.endDate ?? null, distanceMiles: c.distanceMiles ?? null,
  });
}
function poolKey(p, customerName) {
  return JSON.stringify({
    customer: customerName, name: p.name, address: p.address ?? null, type: p.type ?? null, surface: p.surface ?? null,
    volumeGal: p.volumeGal ?? null, serviceDay: p.serviceDay ?? null, oneTimeDate: p.oneTimeDate ?? null, routeOrder: p.routeOrder,
    active: p.active, accessNotes: p.accessNotes ?? '',
    equipment: (p.equipment ?? []).map(({ _id, ...e }) => ({ ...e })),
  });
}
async function snapshot(h, cookie) {
  const customers = (await send(h, cookie, 'GET', '/customers')).json;
  const pools = (await send(h, cookie, 'GET', '/pools')).json;
  const byId = new Map(customers.map((c) => [c._id, c.name]));
  return { customers: customers.map(customerKey).sort(), pools: pools.filter((p) => byId.has(p.customerId)).map((p) => poolKey(p, byId.get(p.customerId))).sort() };
}

async function seed() {
  const cookie = await login(host, password);
  const id = () => crypto.randomUUID();
  const customers = [
    { name: 'Avery Adams', status: 'current', phones: [{ label: 'mobile', number: '+12145550111' }, { label: 'home', number: '+19725550112' }], email: 'avery@example.com', address: { line1: '10 Lake Dr', line2: 'Gate B', city: 'Dallas', state: 'TX', zip: '75201' }, monthlyRate: 165, billingEmail: 'billing@example.com', paymentMethod: 'electronic', startDate: '2024-03-01', distanceMiles: 8.5, notes: 'Prefers texts\nKey under mat' },
    { name: 'Blake Brown', status: 'prospect', phones: [{ label: 'mobile', number: '+14695550121' }], address: { line1: '22 Hill Rd', city: 'Plano', state: 'TX', zip: '75024' } },
    { name: 'Casey Cole', status: 'past', email: 'casey@example.com', monthlyRate: 140, paymentMethod: 'check', startDate: '2023-01-15', endDate: '2025-06-30' },
    { name: 'Drew Diaz', phones: [{ label: 'work', number: '+18175550131' }], address: { line1: '5 Oak Ct', city: 'Frisco', state: 'TX' }, monthlyRate: 210.5, paymentMethod: 'cash' },
  ].map((c) => ({ _id: id(), ...c }));
  for (const c of customers) {
    const r = await send(host, cookie, 'POST', '/customers', c);
    if (r.status !== 201) throw new Error(`seed customer ${c.name}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  const [a, b, , d] = customers;
  const pools = [
    { customerId: a._id, name: 'Backyard', type: 'salt', surface: 'Pebble', volumeGal: 18000, serviceDay: 'mon', routeOrder: 3, accessNotes: 'Gate code 4455\nDog: Max', equipment: [
      { _id: id(), kind: 'pump', model: 'IntelliFlo VSF', serial: 'P-1', installedOn: '2021-04-10' },
      { _id: id(), kind: 'saltCell', model: 'IC40', notes: 'Clean every 3 months' },
      { _id: id(), kind: 'other', name: 'Booster pump', model: 'PB4-60' },
    ] },
    { customerId: a._id, name: 'Spa', type: 'chlorine', volumeGal: 600, serviceDay: 'mon', routeOrder: 4, address: { line1: '12 Lake Dr', city: 'Dallas', state: 'TX', zip: '75201' } },
    { customerId: b._id, name: 'Pool', serviceDay: null, oneTimeDate: '2026-12-05', routeOrder: 0, active: true },
    { customerId: d._id, name: 'Lap pool', type: 'chlorine', surface: 'Plaster', volumeGal: 25000, serviceDay: 'thu', routeOrder: 1, active: false },
  ];
  for (const p of pools) {
    const r = await send(host, cookie, 'POST', '/pools', { _id: id(), ...p });
    if (r.status !== 201) throw new Error(`seed pool ${p.name}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  const snap = await snapshot(host, cookie);
  check(snap.customers.length === 4 && snap.pools.length === 4, `${host}: 4 customers and 4 pools to export (classes, phones, addresses, rates, one-time date, inactive pool, equipment)`);
}

async function importIt() {
  const file = fs.readFileSync(xlsx);
  const src = await login(srcHost, srcPassword);
  const dst = await login(host, password);
  const want = await snapshot(srcHost, src);
  const before = await snapshot(host, dst);
  check(before.customers.length === 0, `${host} starts empty`);

  const read = await upload(host, dst, '/import/read', file);
  check(read.status === 200 && read.json.kind === 'app', `${host} recognises ${srcHost}'s Export everything file`, `${read.status} ${read.json?.kind}`);
  const preview = await upload(host, dst, '/import/preview', file, { mapping: [] });
  const s = preview.json.summary;
  check(s.customersNew === 4 && s.poolsNew === 4 && s.customersMerged === 0 && s.conflicts === 0 && s.warnings === 0, 'preview: 4 new customers, 4 new pools, no differences, no warnings', JSON.stringify(s));
  const applied = await upload(host, dst, '/import/apply', file, { mapping: [] });
  check(applied.status === 200, 'import applied', `${applied.status} ${JSON.stringify(applied.json)}`);

  const got = await snapshot(host, dst);
  const diff = (a, b) => a.filter((x) => !b.includes(x));
  check(JSON.stringify(got.customers) === JSON.stringify(want.customers), 'every customer field matches the source', JSON.stringify({ missing: diff(want.customers, got.customers), extra: diff(got.customers, want.customers) }, null, 1));
  check(JSON.stringify(got.pools) === JSON.stringify(want.pools), 'every pool field matches, equipment included', JSON.stringify({ missing: diff(want.pools, got.pools), extra: diff(got.pools, want.pools) }, null, 1));

  const againPreview = (await upload(host, dst, '/import/preview', file, { mapping: [] })).json;
  const changed = againPreview.customers.filter((c) => c.action !== 'same').map((c) => ({ name: c.name, changes: c.changes, conflicts: c.conflicts, pools: c.pools.filter((p) => p.action !== 'same') }));
  check(changed.length === 0, 'preview of the same file again: everything up to date', JSON.stringify(changed, null, 1));
  const again = await upload(host, dst, '/import/apply', file, { mapping: [] });
  check(again.status === 400 && /Nothing to import/.test(again.json?.message ?? ''), 'importing the same file again changes nothing', `${again.status}`);
  const self = await upload(srcHost, src, '/import/apply', file, { mapping: [] });
  check(self.status === 400, `${srcHost}'s own export into ${srcHost}: nothing to import`, `${self.status}`);
  const srcAfter = await snapshot(srcHost, src);
  check(JSON.stringify(srcAfter) === JSON.stringify(want), `${srcHost} unchanged`);

  const undo = await send(host, dst, 'POST', `/imports/${applied.json.importId}/undo`);
  check(undo.status === 200 && undo.json.hidden === 8, 'Undo hides all 8 records', JSON.stringify(undo.json));
  const empty = await snapshot(host, dst);
  check(empty.customers.length === 0 && empty.pools.length === 0, `${host} is empty again`);
}

(cmd === 'seed' ? seed() : importIt()).catch((e) => {
  console.log(`  FAIL  ${e.message}`);
  process.exit(1);
});
