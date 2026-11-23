// Finds visits, issues, notes and photos whose pool/customer/visit is deleted or missing.
// APPLY (set by cleanup-orphans.sh) = expected count to hide, or 0 for a dry run.
const now = new Date();
const livePools = new Map(db.pools.find({ deletedAt: null }, { _id: 1 }).toArray().map((p) => [p._id, true]));
const liveCustomers = new Map(db.customers.find({ deletedAt: null }, { _id: 1 }).toArray().map((c) => [c._id, true]));
const poolInfo = (id) => {
  const p = db.pools.findOne({ _id: id });
  if (!p) return { label: `missing pool ${id}`, test: false };
  const c = db.customers.findOne({ _id: p.customerId });
  const name = c ? c.name : 'missing customer';
  return { label: `${name} · ${p.name} (pool deleted ${p.deletedAt ? p.deletedAt.toISOString().slice(0, 10) : '?'})`, test: !!c && /^E2E test /.test(c.name) };
};

const orphans = [];
const byPool = (coll, describe) => {
  for (const d of db.getCollection(coll).find({ deletedAt: null }).toArray()) {
    if (!livePools.has(d.poolId)) orphans.push({ coll, _id: d._id, owner: poolInfo(d.poolId), what: describe(d) });
  }
};
byPool('visits', (v) => `visit ${v.visitedAt.toISOString().slice(0, 16).replace('T', ' ')}`);
byPool('issues', (i) => `issue "${i.title}" (${i.status})`);
byPool('photos', (p) => `photo ${p.takenAt.toISOString().slice(0, 10)}`);
const liveVisit = (id) => !!db.visits.findOne({ _id: id, deletedAt: null }) && !orphans.some((o) => o.coll === 'visits' && o._id === id);
for (const n of db.notes.find({ deletedAt: null }).toArray()) {
  let owner = null;
  if (n.parentType === 'pool' && !livePools.has(n.parentId)) owner = poolInfo(n.parentId);
  if (n.parentType === 'customer' && !liveCustomers.has(n.parentId)) {
    const c = db.customers.findOne({ _id: n.parentId });
    owner = { label: c ? `${c.name} (customer deleted)` : `missing customer ${n.parentId}`, test: !!c && /^E2E test /.test(c.name) };
  }
  if (n.parentType === 'visit' && !liveVisit(n.parentId)) {
    const v = db.visits.findOne({ _id: n.parentId });
    owner = v ? poolInfo(v.poolId) : { label: `missing visit ${n.parentId}`, test: false };
  }
  if (owner) orphans.push({ coll: 'notes', _id: n._id, owner, what: `note "${String(n.body).slice(0, 40)}"` });
}

const groups = {};
for (const o of orphans) (groups[o.owner.label] ??= []).push(o);
print(`Records whose pool/customer is already deleted: ${orphans.length}`);
for (const [label, items] of Object.entries(groups)) {
  print(`\n  ${label}`);
  for (const o of items) print(`    - ${o.what}`);
}
const allTest = orphans.every((o) => o.owner.test);
print(`\nALL_FROM_E2E_TEST_CUSTOMERS: ${orphans.length ? (allTest ? 'yes' : 'NO') : 'n/a'}`);
print(`COUNT: ${orphans.length}`);

if (APPLY > 0) {
  if (APPLY !== orphans.length) {
    print(`\nNot applying: expected ${APPLY} records but found ${orphans.length}. Run the dry run again.`);
    quit(2);
  }
  for (const o of orphans) {
    db.getCollection(o.coll).updateOne({ _id: o._id, deletedAt: null }, { $set: { deletedAt: now, updatedAt: now, syncedAt: now } });
  }
  db.auditLog.insertOne({
    _id: 'cleanup-' + now.getTime(),
    at: now,
    collectionName: '*',
    docId: '*',
    action: 'bulk',
    source: 'system',
    changes: [],
    note: `Cleanup: hid ${orphans.length} records left under deleted pools/customers (${Object.keys(groups).join('; ')})`,
  });
  print(`\nHidden ${orphans.length} records (soft delete; nothing erased).`);
}
