import mongoose, { type ClientSession } from 'mongoose';
import {
  customerStatus,
  IMPORT_FIELDS,
  type Address,
  type Equipment,
  type ImportApplyResult,
  type ImportConflict,
  type ImportFieldChange,
  type ImportFieldKey,
  type ImportOptions,
  type ImportPlanCustomer,
  type ImportPlanPool,
  type ImportPreview,
  type ImportSummary,
} from '@pool/shared';
import { Customer, ImportLog, Invoice, Issue, Ledger, Note, Photo, Pool, Visit } from '../models/index.js';
import { HttpError, newId } from '../util.js';
import { recordAudit, type Change } from './audit.js';
import {
  cleanAddress,
  cleanDate,
  cleanDay,
  cleanEmail,
  cleanNumber,
  cleanPayment,
  cleanPhones,
  cleanPoolType,
  cleanStatus,
  cleanText,
  cleanYesNo,
  EQUIPMENT_FROM_FIELD,
  phoneLabel,
  prettyPhone,
  type Clean,
} from './importClean.js';
import { cellText, type Cell, type ReadFile } from './importRead.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Doc = Record<string, any>;
type Warning = { row: number | null; message: string };
type NewEquipment = Omit<Equipment, '_id'>;

interface PoolDraft {
  key: string;
  name: string;
  fields: Doc; // address, type, surface, volumeGal, serviceDay, oneTimeDate, routeOrder, active
  accessNotes: string[];
  equipment: NewEquipment[];
}
interface CustomerDraft {
  key: string;
  rows: number[];
  name: string;
  fields: Doc; // email, address, status, monthlyRate, billingEmail, paymentMethod, startDate, endDate, distanceMiles
  phones: { label: string; number: string }[];
  notes: string[];
  pools: PoolDraft[];
}

const LABEL: Record<string, string> = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key.split('.')[1]!, f.label.replace(/ \(.*\)$/, '')]));
LABEL.name = 'Name';
LABEL.equipment = 'Equipment';
LABEL.phones = 'Phones';
LABEL.notes = 'Notes';
LABEL.accessNotes = 'Access notes';
LABEL.address = 'Address';

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const addressText = (a?: Address | null) => (a ? [a.line1, a.line2, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter((x) => x?.trim()).join(', ') : '');

/** Comparable form: dates as ISO strings, objects with sorted keys and no empty values. */
function canon(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Doc)
      .filter(([k, x]) => k !== '_id' && x !== undefined && x !== null && x !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => [k, canon(x)]);
    return entries.length ? Object.fromEntries(entries) : null;
  }
  return v === undefined || v === '' ? null : v;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const isBlank = (v: unknown) => canon(v) === null || (Array.isArray(v) && v.length === 0);

// ---------------------------------------------------------------- rows → drafts
export function buildDrafts(file: ReadFile, opts: Pick<ImportOptions, 'sheet' | 'mapping'>): { drafts: CustomerDraft[]; warnings: Warning[]; rows: number; skipped: number } {
  const table = file.tables[opts.sheet];
  if (!table) throw new HttpError(400, `There is no sheet ${opts.sheet + 1}`);
  const mapping = file.kind === 'app' ? file.mapping! : opts.mapping;
  const warnings: Warning[] = [];
  const drafts = new Map<string, CustomerDraft>();
  let skipped = 0;

  for (const { row, cells } of table.rows) {
    const single = new Map<ImportFieldKey, { header: string; cell: Cell }>();
    const multi = new Map<ImportFieldKey, { header: string; cell: Cell }[]>();
    mapping.forEach((key, i) => {
      if (!key || i >= cells.length) return;
      const cell = cells[i] ?? null;
      if (cell === null || cellText(cell) === '') return;
      const def = IMPORT_FIELDS.find((f) => f.key === key)!;
      const entry = { header: table.headers[i] ?? `Column ${i + 1}`, cell };
      if ('multi' in def && def.multi) multi.set(key, [...(multi.get(key) ?? []), entry]);
      else if (!single.has(key)) single.set(key, entry);
      else multi.set('customer.notes', [...(multi.get('customer.notes') ?? []), entry]);
    });

    const notes: string[] = [];
    const keep = (header: string, text: string) => {
      notes.push(`${header}: ${text}`);
      warnings.push({ row, message: `Couldn’t read ${header} “${text}”; kept it in the customer’s notes` });
    };
    const take = <T>(key: ImportFieldKey, clean: (c: Cell) => Clean<T>): T | undefined => {
      const e = single.get(key);
      if (!e) return undefined;
      const r = clean(e.cell);
      if (!r) return undefined;
      if ('bad' in r) {
        keep(e.header, r.bad);
        return undefined;
      }
      return r.ok;
    };

    // Customer
    const fields: Doc = {};
    const phones: { label: string; number: string }[] = [];
    for (const e of multi.get('customer.phone') ?? []) {
      const r = cleanPhones(e.cell, phoneLabel(e.header));
      if (!r) continue;
      for (const p of r.ok) if (!phones.some((x) => x.number === p.number)) phones.push(p);
      for (const b of r.bad) keep(e.header, b);
    }
    const email = take('customer.email', cleanEmail);
    if (email) fields.email = email;
    const address: Address = { ...(take('customer.address', cleanAddress) ?? {}) };
    for (const part of ['line1', 'line2', 'city', 'state', 'zip'] as const) {
      const v = take(`customer.${part}` as ImportFieldKey, cleanText);
      if (v) address[part] = v;
    }
    if (!isBlank(address)) fields.address = address;
    const status = take('customer.status', cleanStatus);
    if (status) fields.status = status;
    const rate = take('customer.monthlyRate', (c) => cleanNumber(c, { min: 0 }));
    if (rate !== undefined) fields.monthlyRate = rate;
    const billing = take('customer.billingEmail', cleanEmail);
    if (billing) fields.billingEmail = billing;
    const payE = single.get('customer.paymentMethod');
    if (payE) {
      const r = cleanPayment(payE.cell);
      if (r && 'ok' in r) {
        fields.paymentMethod = r.ok;
        if (r.note) notes.push(`${payE.header}: ${r.note}`);
      }
    }
    const start = take('customer.startDate', cleanDate);
    if (start) fields.startDate = start;
    const end = take('customer.endDate', cleanDate);
    if (end) fields.endDate = end;
    const miles = take('customer.distanceMiles', (c) => cleanNumber(c, { min: 0 }));
    if (miles !== undefined) fields.distanceMiles = miles;
    for (const e of multi.get('customer.notes') ?? []) {
      const t = cellText(e.cell);
      notes.push(/^(notes?|comments?|remarks)$/i.test(e.header.trim()) ? t : `${e.header}: ${t}`);
    }

    const given = take('customer.name', cleanText);
    const fullName = [take('customer.firstName', cleanText), take('customer.lastName', cleanText)].filter(Boolean).join(' ');
    const company = take('customer.company', cleanText);
    let name = given || fullName || company || '';
    if (company && name !== company) notes.push(`Company: ${company}`);
    if (!name && phones[0]) name = prettyPhone(phones[0].number);
    if (!name && fields.address) name = addressText(fields.address);
    if (!name) {
      skipped++;
      warnings.push({ row, message: 'No name, phone or address: row skipped' });
      continue;
    }

    // Pool (only if the row says something about one)
    let pool: PoolDraft | null = null;
    const hasPool = [...single.keys(), ...multi.keys()].some((k) => k.startsWith('pool.') || k.startsWith('equipment.'));
    if (hasPool) {
      const pf: Doc = {};
      const pAddress: Address = { ...(take('pool.address', cleanAddress) ?? {}) };
      for (const part of ['line1', 'line2', 'city', 'state', 'zip'] as const) {
        const v = take(`pool.${part}` as ImportFieldKey, cleanText);
        if (v) pAddress[part] = v;
      }
      if (!isBlank(pAddress)) pf.address = pAddress;
      const type = take('pool.type', cleanPoolType);
      if (type) pf.type = type;
      const surface = take('pool.surface', cleanText);
      if (surface) pf.surface = surface;
      const gal = take('pool.volumeGal', (c) => cleanNumber(c, { positive: true }));
      if (gal !== undefined) pf.volumeGal = gal;
      const dayE = single.get('pool.serviceDay');
      if (dayE) {
        const r = cleanDay(dayE.cell);
        if (r && 'ok' in r) {
          pf.serviceDay = r.ok;
          if (r.extra) {
            notes.push(`${dayE.header}: ${cellText(dayE.cell)}`);
            warnings.push({ row, message: `Several service days (“${cellText(dayE.cell)}”): used the first; the rest is in the notes` });
          }
        } else if (r) keep(dayE.header, r.bad);
      }
      const once = take('pool.oneTimeDate', cleanDate);
      if (once) pf.oneTimeDate = once;
      const order = take('pool.routeOrder', (c) => cleanNumber(c, { min: 0 }));
      if (order !== undefined) pf.routeOrder = order;
      const active = take('pool.active', cleanYesNo);
      if (active !== undefined) pf.active = active;
      const accessNotes = (multi.get('pool.accessNotes') ?? []).map((e) => {
        const t = cellText(e.cell);
        return /^(access ?notes?|access)$/i.test(e.header.trim()) ? t : `${e.header}: ${t}`;
      });
      const equipment: NewEquipment[] = [];
      for (const [key, kind] of Object.entries(EQUIPMENT_FROM_FIELD)) {
        const model = take(key as ImportFieldKey, cleanText);
        if (model) equipment.push({ kind, model });
      }
      const listE = single.get('pool.equipmentList');
      if (listE) {
        try {
          for (const e of JSON.parse(cellText(listE.cell)) as Doc[]) {
            const item: NewEquipment = { kind: e.kind };
            for (const f of ['name', 'model', 'serial', 'notes'] as const) if (e[f]) item[f] = String(e[f]);
            if (e.installedOn) {
              const d = cleanDate(String(e.installedOn));
              if (d && 'ok' in d) item.installedOn = d.ok;
            }
            equipment.push(item);
          }
        } catch {
          keep(listE.header, cellText(listE.cell));
        }
      }
      const poolName = take('pool.name', cleanText) || 'Pool';
      pool = { key: `${norm(poolName)}|${norm(pAddress.line1)}`, name: poolName, fields: pf, accessNotes, equipment };
    }

    // Group rows of one customer
    const keyCell = take('customer.key', cleanText);
    const key = keyCell ? `k:${norm(keyCell)}` : `n:${norm(name)}|${norm(fields.address?.line1)}`;
    const existing = drafts.get(key);
    if (!existing) {
      drafts.set(key, { key, rows: [row], name, fields, phones, notes: [...new Set(notes)], pools: pool ? [pool] : [] });
      continue;
    }
    existing.rows.push(row);
    for (const [f, v] of Object.entries(fields)) {
      if (existing.fields[f] === undefined) existing.fields[f] = v;
      else if (!same(existing.fields[f], v)) warnings.push({ row, message: `${LABEL[f] ?? f} differs from row ${existing.rows[0]} for ${existing.name}; kept row ${existing.rows[0]}’s` });
    }
    for (const p of phones) if (!existing.phones.some((x) => x.number === p.number)) existing.phones.push(p);
    for (const n of notes) if (!existing.notes.includes(n)) existing.notes.push(n);
    if (pool) {
      const twin = existing.pools.find((p) => p.key === pool.key);
      if (!twin) existing.pools.push(pool);
      else {
        for (const [f, v] of Object.entries(pool.fields)) if (twin.fields[f] === undefined) twin.fields[f] = v;
        for (const n of pool.accessNotes) if (!twin.accessNotes.includes(n)) twin.accessNotes.push(n);
        for (const e of pool.equipment) if (!twin.equipment.some((x) => same(x, e))) twin.equipment.push(e);
      }
    }
  }
  return { drafts: [...drafts.values()], warnings, rows: table.rows.length, skipped };
}

// ---------------------------------------------------------------- matching stored customers
interface Stored {
  customers: Doc[];
  poolsByCustomer: Map<string, Doc[]>;
}
async function loadStored(session?: ClientSession): Promise<Stored> {
  const customers = await Customer.find({ deletedAt: null }).session(session ?? null).lean<Doc[]>();
  const pools = await Pool.find({ deletedAt: null }).session(session ?? null).lean<Doc[]>();
  const poolsByCustomer = new Map<string, Doc[]>();
  for (const p of pools) poolsByCustomer.set(p.customerId, [...(poolsByCustomer.get(p.customerId) ?? []), p]);
  return { customers, poolsByCustomer };
}

function matchCustomer(d: CustomerDraft, stored: Stored): { doc: Doc; by: ImportPlanCustomer['matchedBy'] } | null {
  const name = norm(d.name);
  const street = norm(d.fields.address?.line1);
  const byName = stored.customers.filter((c) => norm(c.name) === name);
  const exact = byName.find((c) => norm(c.address?.line1) === street);
  if (exact) return { doc: exact, by: 'name and street' };
  const emails = [d.fields.email, d.fields.billingEmail].filter(Boolean).map((e: string) => e.toLowerCase());
  const byEmail = emails.length ? stored.customers.find((c) => [c.email, c.billingEmail].some((e) => e && emails.includes(String(e).toLowerCase()))) : undefined;
  if (byEmail) return { doc: byEmail, by: 'email' };
  const numbers = d.phones.map((p) => p.number);
  const byPhone = numbers.length ? stored.customers.find((c) => (c.phones ?? []).some((p: Doc) => numbers.includes(p.number))) : undefined;
  if (byPhone) return { doc: byPhone, by: 'phone' };
  // Same name where one side has no street: the same person.
  const loose = byName.filter((c) => !street || !norm(c.address?.line1));
  if (loose.length === 1) return { doc: loose[0]!, by: 'name' };
  return null;
}

function matchPool(p: PoolDraft, pools: Doc[], draftPools: number): Doc | undefined {
  const street = norm(p.fields.address?.line1);
  const byName = pools.filter((x) => norm(x.name) === norm(p.name));
  const hit = byName.find((x) => norm(x.address?.line1) === street) ?? byName.find((x) => !street || !norm(x.address?.line1));
  if (hit) return hit;
  // One pool on each side: the same pool, whatever its name.
  return pools.length === 1 && draftPools === 1 ? pools[0] : undefined;
}

// ---------------------------------------------------------------- merge plan
interface DocOps {
  set: Doc;
  changes: ImportFieldChange[];
  conflicts: ImportConflict[];
}
/** Blank stored field → filled. Same → nothing. Different → a conflict (stored value kept unless taken). */
function mergeFields(prefix: string, existing: Doc, incoming: Doc, take: Set<string>, ops: DocOps) {
  for (const [f, to] of Object.entries(incoming)) {
    let from = existing[f];
    if (f === 'status') from = customerStatus(existing); // no class stored = current
    if (f === 'name' && norm(from) === norm(to)) continue; // "john smith" = "John Smith"
    if (f === 'routeOrder') {
      if (!from) ops.set[f] = to; // fill a default 0 only; never a conflict
      continue;
    }
    if (f === 'active' && from === undefined) from = true;
    if (same(from, to)) continue;
    const label = LABEL[f] ?? f;
    if (isBlank(from)) {
      ops.set[f] = to;
      ops.changes.push({ path: f, label, from: from ?? null, to });
    } else {
      const id = `${prefix}:${existing._id}:${f}`;
      ops.conflicts.push({ id, path: f, label, from, to });
      if (take.has(id)) ops.set[f] = to;
    }
  }
}
function appendText(existing: string | undefined, lines: string[]): string | undefined {
  const have = (existing ?? '').toLowerCase();
  const add = lines.filter((l) => !have.includes(l.toLowerCase()));
  if (!add.length) return undefined;
  return [existing?.trim(), ...add].filter(Boolean).join('\n');
}

interface Plan {
  preview: ImportPreview;
  creates: { customer: Doc | null; customerId: string; pools: Doc[] }[];
  updates: { collection: 'customers' | 'pools'; doc: Doc; set: Doc }[];
}

async function plan(file: ReadFile, opts: ImportOptions, session?: ClientSession): Promise<Plan> {
  const { drafts, warnings, rows, skipped } = buildDrafts(file, opts);
  const stored = await loadStored(session);
  const take = new Set(opts.take);
  const out: ImportPlanCustomer[] = [];
  const creates: Plan['creates'] = [];
  const updates: Plan['updates'] = [];
  const summary: ImportSummary = { rows, skippedRows: skipped, customersNew: 0, customersMerged: 0, poolsNew: 0, poolsMerged: 0, conflicts: 0, warnings: 0 };
  const claimedPools = new Set<string>();

  for (const d of drafts) {
    const m = matchCustomer(d, stored);
    const poolsOut: ImportPlanPool[] = [];
    if (!m) {
      const customer: Doc = { name: d.name, phones: d.phones, ...d.fields };
      if (d.notes.length) customer.notes = d.notes.join('\n');
      const pools = d.pools.map((p) => poolDoc(p));
      creates.push({ customer, customerId: '', pools });
      for (const p of d.pools) poolsOut.push({ action: 'new', name: p.name, changes: [], conflicts: [] });
      summary.customersNew++;
      summary.poolsNew += pools.length;
      out.push({ action: 'new', name: d.name, rows: d.rows, changes: [], conflicts: [], pools: poolsOut });
      continue;
    }

    const c = m.doc;
    const ops: DocOps = { set: {}, changes: [], conflicts: [] };
    mergeFields('c', c, { name: d.name, ...d.fields }, take, ops);
    const newPhones = d.phones.filter((p) => !(c.phones ?? []).some((x: Doc) => x.number === p.number));
    if (newPhones.length) {
      ops.set.phones = [...(c.phones ?? []), ...newPhones];
      ops.changes.push({ path: 'phones', label: 'Phones', from: c.phones ?? [], to: ops.set.phones });
    }
    const notes = appendText(c.notes, d.notes);
    if (notes !== undefined) {
      ops.set.notes = notes;
      ops.changes.push({ path: 'notes', label: 'Notes', from: c.notes ?? '', to: notes });
    }
    if (Object.keys(ops.set).length) updates.push({ collection: 'customers', doc: c, set: ops.set });

    const storedPools = (stored.poolsByCustomer.get(c._id) ?? []).filter((p) => !claimedPools.has(p._id));
    const newPools: Doc[] = [];
    for (const p of d.pools) {
      const sp = matchPool(p, storedPools, d.pools.length);
      if (!sp) {
        newPools.push(poolDoc(p));
        poolsOut.push({ action: 'new', name: p.name, changes: [], conflicts: [] });
        continue;
      }
      claimedPools.add(sp._id);
      const pops: DocOps = { set: {}, changes: [], conflicts: [] };
      mergeFields('p', sp, p.fields, take, pops);
      const access = appendText(sp.accessNotes, p.accessNotes);
      if (access !== undefined) {
        pops.set.accessNotes = access;
        pops.changes.push({ path: 'accessNotes', label: 'Access notes', from: sp.accessNotes ?? '', to: access });
      }
      const eqNew = p.equipment.filter((e) => !(sp.equipment ?? []).some((x: Doc) => x.kind === e.kind && norm(x.model) === norm(e.model) && norm(x.serial) === norm(e.serial) && norm(x.name) === norm(e.name)));
      if (eqNew.length) {
        pops.set.equipment = [...(sp.equipment ?? []), ...eqNew.map((e) => ({ _id: newId(), ...e }))];
        pops.changes.push({ path: 'equipment', label: 'Equipment', from: (sp.equipment ?? []).length + ' items', to: `+${eqNew.length}: ${eqNew.map((e) => [e.kind, e.model].filter(Boolean).join(' ')).join(', ')}` });
      }
      if (Object.keys(pops.set).length) updates.push({ collection: 'pools', doc: sp, set: pops.set });
      const changed = pops.changes.length || pops.conflicts.length;
      poolsOut.push({ action: changed ? 'merge' : 'same', name: sp.name, changes: pops.changes, conflicts: pops.conflicts });
      if (changed) summary.poolsMerged++;
      summary.conflicts += pops.conflicts.length;
    }
    if (newPools.length) creates.push({ customer: null, customerId: c._id, pools: newPools });
    summary.poolsNew += newPools.length;
    summary.conflicts += ops.conflicts.length;
    const changed = ops.changes.length || ops.conflicts.length || poolsOut.some((p) => p.action !== 'same');
    if (changed) summary.customersMerged++;
    out.push({ action: changed ? 'merge' : 'same', name: c.name, matchedBy: m.by, rows: d.rows, changes: ops.changes, conflicts: ops.conflicts, pools: poolsOut });
  }
  summary.warnings = warnings.length;
  return { preview: { summary, customers: out, warnings }, creates, updates };
}

function poolDoc(p: PoolDraft): Doc {
  const doc: Doc = { name: p.name, ...p.fields, accessNotes: p.accessNotes.join('\n') };
  if (p.equipment.length) doc.equipment = p.equipment.map((e) => ({ _id: newId(), ...e }));
  return doc;
}

export async function previewImport(file: ReadFile, opts: ImportOptions): Promise<ImportPreview> {
  return (await plan(file, opts)).preview;
}

// ---------------------------------------------------------------- apply
/** Everything in one transaction. The import's own record lists what it added and changed, for Undo. */
export async function applyImport(file: ReadFile, opts: ImportOptions, fileName: string): Promise<ImportApplyResult> {
  const importId = newId();
  const now = new Date();
  let summary!: ImportSummary;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const p = await plan(file, opts, session);
      summary = p.preview.summary;
      if (!p.creates.length && !p.updates.length) throw new HttpError(400, 'Nothing to import: everything in the file is already in the app.');
      const created: { kind: string; docId: string }[] = [];
      const updated: { kind: string; docId: string; before: Doc; after: Doc }[] = [];
      const stamp = { createdAt: now, updatedAt: now, syncedAt: now, deletedAt: null };
      const note = `import ${importId} (${fileName})`;

      // New pools go to the end of their day's route, in file order.
      const lastStop = new Map<string, number>();
      for (const row of await Pool.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$serviceDay', max: { $max: '$routeOrder' } } }]).session(session)) {
        lastStop.set(String(row._id), row.max ?? 0);
      }
      for (const c of p.creates) {
        let customerId = c.customerId;
        if (c.customer) {
          customerId = newId();
          await Customer.create([{ _id: customerId, ...c.customer, ...stamp }], { session });
          created.push({ kind: 'customers', docId: customerId });
          await recordAudit({ collectionName: 'customers', docId: customerId, action: 'create', source: 'app', note }, session);
        }
        for (const pool of c.pools) {
          const _id = newId();
          if (pool.routeOrder === undefined) {
            const day = String(pool.serviceDay ?? null);
            const next = (lastStop.get(day) ?? 0) + 1;
            lastStop.set(day, next);
            pool.routeOrder = next;
          }
          await Pool.create([{ _id, customerId, ...pool, ...stamp }], { session });
          created.push({ kind: 'pools', docId: _id });
          await recordAudit({ collectionName: 'pools', docId: _id, action: 'create', source: 'app', note }, session);
        }
      }
      for (const u of p.updates) {
        const model = u.collection === 'customers' ? Customer : Pool;
        const before = Object.fromEntries(Object.keys(u.set).map((k) => [k, u.doc[k] ?? null]));
        await model.updateOne({ _id: u.doc._id }, { $set: { ...u.set, updatedAt: now, syncedAt: now } }, { session, runValidators: true });
        updated.push({ kind: u.collection, docId: u.doc._id, before, after: u.set });
        const changes: Change[] = Object.keys(u.set).map((k) => ({ path: k, from: before[k], to: u.set[k] }));
        await recordAudit({ collectionName: u.collection, docId: u.doc._id, action: 'update', source: 'app', changes, note }, session);
      }
      await ImportLog.create([{ _id: importId, at: now, fileName, summary, created, updated, undoneAt: null }], { session });
    });
  } finally {
    await session.endSession();
  }
  return { importId, summary };
}

// ---------------------------------------------------------------- undo
/**
 * Hides what the import added and puts back what it changed. Anything used or edited since is
 * kept as it is: a pool with visits, issues, notes or photos; a customer with such a pool, an
 * invoice or a ledger entry; a field someone changed after the import.
 */
export async function undoImport(importId: string): Promise<{ hidden: number; restored: number; kept: number }> {
  const now = new Date();
  const result = { hidden: 0, restored: 0, kept: 0 };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      Object.assign(result, { hidden: 0, restored: 0, kept: 0 });
      const log = await ImportLog.findById(importId).session(session).lean<Doc>();
      if (!log) throw new HttpError(404, 'No such import');
      if (log.undoneAt) throw new HttpError(409, 'This import was already undone');
      const note = `undo import ${importId}`;
      const hide = { $set: { deletedAt: now, updatedAt: now, syncedAt: now } };
      const live = { deletedAt: null };

      const keptCustomers = new Set<string>();
      for (const c of log.created.filter((x: Doc) => x.kind === 'pools')) {
        const id = c.docId;
        const used =
          (await Visit.exists({ poolId: id, ...live }).session(session)) ||
          (await Issue.exists({ poolId: id, ...live }).session(session)) ||
          (await Photo.exists({ poolId: id, ...live }).session(session)) ||
          (await Note.exists({ parentType: 'pool', parentId: id, ...live }).session(session));
        const pool = await Pool.findById(id).session(session).lean<Doc>();
        if (!pool || pool.deletedAt) continue;
        if (used) {
          result.kept++;
          keptCustomers.add(pool.customerId);
          continue;
        }
        await Pool.updateOne({ _id: id }, hide, { session });
        await recordAudit({ collectionName: 'pools', docId: id, action: 'delete', source: 'app', note }, session);
        result.hidden++;
      }
      for (const c of log.created.filter((x: Doc) => x.kind === 'customers')) {
        const id = c.docId;
        const customer = await Customer.findById(id).session(session).lean<Doc>();
        if (!customer || customer.deletedAt) continue;
        const used =
          keptCustomers.has(id) ||
          (await Pool.exists({ customerId: id, ...live }).session(session)) ||
          (await Invoice.exists({ customerId: id, ...live }).session(session)) ||
          (await Ledger.exists({ customerId: id, ...live }).session(session));
        if (used) {
          result.kept++;
          continue;
        }
        await Customer.updateOne({ _id: id }, hide, { session });
        await recordAudit({ collectionName: 'customers', docId: id, action: 'delete', source: 'app', note }, session);
        result.hidden++;
      }
      for (const u of log.updated) {
        const model = u.kind === 'customers' ? Customer : Pool;
        const doc = await model.findById(u.docId).session(session).lean<Doc>();
        if (!doc || doc.deletedAt) continue;
        const $set: Doc = {};
        const $unset: Doc = {};
        const changes: Change[] = [];
        for (const [k, after] of Object.entries(u.after as Doc)) {
          if (!same(doc[k], after)) {
            result.kept++;
            continue;
          }
          const before = (u.before as Doc)[k];
          if (before === null || before === undefined) $unset[k] = '';
          else $set[k] = before;
          changes.push({ path: k, from: doc[k], to: before ?? null });
          result.restored++;
        }
        if (!changes.length) continue;
        await model.updateOne({ _id: u.docId }, { $set: { ...$set, updatedAt: now, syncedAt: now }, ...(Object.keys($unset).length ? { $unset } : {}) }, { session });
        await recordAudit({ collectionName: u.kind, docId: u.docId, action: 'update', source: 'app', changes, note }, session);
      }
      await ImportLog.updateOne({ _id: importId }, { $set: { undoneAt: now, undo: { ...result } } }, { session });
    });
  } finally {
    await session.endSession();
  }
  return result;
}

export async function listImports() {
  return ImportLog.find({}, { created: 0, updated: 0 }).sort({ at: -1 }).limit(100).lean();
}
