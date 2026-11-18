import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { BUSINESS_SETTINGS_ID, DASHBOARD_SETTINGS_ID, customerStatus, type DashboardLayout, invoiceBalance, invoiceState, TASK_KEYS, type IssueStatus } from '@pool/shared';
import { api } from './api';
import { useSyncStore } from './sync';
import { clone, newId } from '@/lib/format';
import { db } from '@/offline/db';
import { enqueue } from '@/offline/engine';
import type { AuditEntry, Chemical, Customer, Equipment, Invoice, InvoiceLine, Issue, Ledger, Note, Payment, Photo, Pool, Settings, Visit } from '@/lib/types';
import { addDays, localDate, periodLabel, periodOf, TERMS_DAYS, withDoseCosts } from '@/lib/money';

/** The database drops empty objects/arrays, so fill in what a visit always has. */
export function normalizeVisit(v: Visit): Visit {
  v.readings ??= {};
  v.doses ??= [];
  const t: Partial<Visit['tasks']> = v.tasks ?? {};
  v.tasks = Object.fromEntries(TASK_KEYS.map((k) => [k, !!t[k]])) as Record<(typeof TASK_KEYS)[number], boolean>;
  v.timeLog = { finished: false, ...(v.timeLog ?? {}), segments: v.timeLog?.segments ?? [] };
  return v;
}

const live = <T extends { deletedAt: string | null }>(list: T[]) => list.filter((d) => !d.deletedAt);
const isRunning = (v: Visit) => !!v.timeLog && !v.timeLog.finished && v.timeLog.segments.some((s) => !s.end);
const nowIso = () => new Date().toISOString();

/**
 * The data the screens use. Reads come from the phone's local database
 * (IndexedDB), so everything works with no signal. Every change is written
 * locally first and queued as a package in the outbox; the sync engine sends it
 * when there is signal and pulls down changes from the server.
 */
export const useDataStore = defineStore('data', () => {
  const customers = ref<Customer[]>([]);
  const pools = ref<Pool[]>([]);
  const chemicals = ref<Chemical[]>([]);
  const issues = ref<Issue[]>([]);
  const activeTimers = ref<Visit[]>([]);
  /** Business details (Phase 7B); null until set. */
  const settings = ref<Settings | null>(null);
  /** The desktop dashboard's card layout (Phase 7D); null = the default layout. Follows the owner to any device. */
  const dashboard = ref<DashboardLayout | null>(null);
  const invoices = ref<Invoice[]>([]);
  /** Expenses, other income and mileage (Phase 7C). */
  const ledger = ref<Ledger[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  /** Bumped whenever the phone's copy changes (sync or local edit); screens that read it once watch this. */
  const version = ref(0);

  const customerById = computed(() => new Map(customers.value.map((c) => [c._id, c])));
  const poolById = computed(() => new Map(pools.value.map((p) => [p._id, p])));
  const chemicalById = computed(() => new Map(chemicals.value.map((c) => [c._id, c])));
  const activeChemicals = computed(() => chemicals.value.filter((c) => c.active));

  /** Prospects and past customers stay off the Route, the Issues tab and the weekly count. */
  const currentCustomerIds = computed(() => new Set(customers.value.filter((c) => customerStatus(c) === 'current').map((c) => c._id)));
  /** Active pools of current customers: the Route. */
  const routePools = computed(() => pools.value.filter((p) => p.active && currentCustomerIds.value.has(p.customerId)));
  const isCurrentPool = (poolId: string) => {
    const p = poolById.value.get(poolId);
    return !!p && currentCustomerIds.value.has(p.customerId);
  };

  /** Open = anything not completed (open, in progress, postponed), any customer. A pool's own screens use this. */
  const openIssuesAll = computed(() => issues.value.filter((i) => i.status !== 'resolved'));
  /** Open issues of current customers: the Issues tab and its badge. */
  const openIssues = computed(() => openIssuesAll.value.filter((i) => isCurrentPool(i.poolId)));
  const openIssueCount = computed(() => {
    const counts = new Map<string, number>();
    for (const i of openIssues.value) {
      if (i.status === 'postponed') continue;
      counts.set(i.poolId, (counts.get(i.poolId) ?? 0) + 1);
    }
    return counts;
  });

  /** Re-reads the local database into memory (after a sync or a local change). */
  async function refreshFromDb() {
    const [c, p, ch, i, running, st, inv, led, dash] = await Promise.all([
      db.customers.toArray(),
      db.pools.toArray(),
      db.chemicals.toArray(),
      db.issues.toArray(),
      db.visits.filter((v) => !v.deletedAt && isRunning(v)).toArray(),
      db.settings.get(BUSINESS_SETTINGS_ID),
      db.invoices.toArray(),
      db.ledger.toArray(),
      db.settings.get(DASHBOARD_SETTINGS_ID),
    ]);
    dashboard.value = dash && !dash.deletedAt && dash.dashboard ? dash.dashboard : null;
    ledger.value = live(led).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    settings.value = st && !st.deletedAt ? st : null;
    invoices.value = live(inv).map((x) => ({ ...x, lines: x.lines ?? [], payments: x.payments ?? [] })).sort((a, b) => b.number - a.number);
    const livePools = new Set(live(p).map((x) => x._id));
    customers.value = live(c).sort((a, b) => a.name.localeCompare(b.name));
    pools.value = live(p);
    chemicals.value = live(ch).sort((a, b) => a.name.localeCompare(b.name));
    issues.value = live(i).filter((x) => livePools.has(x.poolId));
    activeTimers.value = running.filter((v) => livePools.has(v.poolId)).map(normalizeVisit);
    version.value++;
  }

  /** First load: show what's on the phone right away, then sync in the background. */
  async function loadAll(force = false) {
    if ((loaded.value && !force) || loading.value) return;
    loading.value = true;
    try {
      await refreshFromDb();
      loaded.value = true;
    } finally {
      loading.value = false;
    }
    void useSyncStore().kick({ force });
  }

  /** Save locally, queue for the server, update the screens, nudge the sync. */
  async function commit(pkg: Record<string, unknown>, summary: string, photoIds: string[] = []) {
    // Plain copy: live screen objects can't be stored in the outbox (IndexedDB).
    await enqueue({ packageId: newId(), createdAt: nowIso(), ...clone(pkg) }, summary, photoIds);
    const sync = useSyncStore();
    await sync.refreshCounts(); // the header chip shows "1 waiting" right away
    await refreshFromDb();
    void sync.kick();
  }

  /**
   * The pool's own name, or '' when it is just the default "Pool" and the customer
   * has only one pool (then the customer's name says it all).
   */
  function poolName(pool: Pool | undefined): string {
    if (!pool) return '';
    const generic = !pool.name?.trim() || pool.name.trim().toLowerCase() === 'pool';
    const siblings = pools.value.filter((p) => p.customerId === pool.customerId).length;
    return generic && siblings <= 1 ? '' : pool.name;
  }

  /** "Customer" or "Customer · Backyard". */
  function poolLabel(poolId: string): string {
    const p = poolById.value.get(poolId);
    if (!p) return 'Pool';
    const name = poolName(p);
    const customer = customerById.value.get(p.customerId)?.name ?? 'Customer';
    return name ? `${customer} · ${name}` : customer;
  }
  const customerName = poolLabel;

  // ------------------------------------------------------------ customers / pools
  async function saveCustomer(id: string | null, body: Partial<Customer>): Promise<Customer> {
    const now = nowIso();
    const existing = id ? await db.customers.get(id) : undefined;
    const doc: Customer = existing
      ? { ...existing, ...body, updatedAt: now }
      : ({ phones: [], ...body, _id: body._id ?? newId(), createdAt: now, updatedAt: now, deletedAt: null } as Customer);
    // Optional fields cleared in the form must disappear, not linger from the old copy.
    for (const k of ['email', 'notes', 'address'] as const) if (existing && !(k in body)) delete doc[k];
    await db.customers.put(clone(doc));
    await commit({ customers: [doc] }, `${existing ? 'Edit' : 'New'} customer · ${doc.name}`);
    return doc;
  }

  /** Also hides the customer's pools and everything under them (the server does the same). */
  async function deleteCustomer(id: string) {
    const existing = await db.customers.get(id);
    if (!existing) return;
    const now = nowIso();
    const doc = { ...existing, deletedAt: now, updatedAt: now };
    await db.customers.put(doc);
    for (const p of await db.pools.where('customerId').equals(id).toArray()) await hidePoolLocally(p._id, now);
    await commit({ customers: [doc] }, `Delete customer · ${existing.name}`);
  }

  async function savePool(id: string | null, body: Partial<Pool>): Promise<Pool> {
    const now = nowIso();
    const existing = id ? await db.pools.get(id) : undefined;
    const doc: Pool = existing
      ? { ...existing, ...body, updatedAt: now }
      : ({
          name: 'Pool',
          routeOrder: 0,
          accessNotes: '',
          active: true,
          week: { done: false, doneAt: null, changedAt: null },
          ...body,
          _id: body._id ?? newId(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        } as Pool);
    for (const k of ['surface', 'address'] as const) if (existing && !(k in body)) delete doc[k];
    await db.pools.put(clone(doc));
    await commit({ pools: [doc] }, `${existing ? 'Edit' : 'New'} pool · ${customerById.value.get(doc.customerId)?.name ?? ''} · ${doc.name}`);
    return doc;
  }

  async function hidePoolLocally(poolId: string, now: string) {
    const p = await db.pools.get(poolId);
    if (p && !p.deletedAt) await db.pools.put({ ...p, deletedAt: now, updatedAt: now });
    const hide = async <T extends { deletedAt: string | null }>(table: import('dexie').Table<T, string>, rows: T[]) => {
      for (const r of rows) if (!r.deletedAt) await table.put({ ...r, deletedAt: now });
    };
    await hide(db.visits, await db.visits.where('poolId').equals(poolId).toArray());
    await hide(db.issues, await db.issues.where('poolId').equals(poolId).toArray());
    await hide(db.photos, await db.photos.where('poolId').equals(poolId).toArray());
    await hide(db.notes, await db.notes.where('parentId').equals(poolId).toArray());
  }

  /** Also hides the pool's visits, issues, notes and photos (the server does the same). */
  async function deletePool(id: string) {
    const existing = await db.pools.get(id);
    if (!existing) return;
    const now = nowIso();
    const label = customerName(id);
    await hidePoolLocally(id, now);
    await commit({ pools: [{ ...existing, deletedAt: now, updatedAt: now }] }, `Delete pool · ${label}`);
  }

  /** The weekly checkmark; the Route checkbox and the visit-screen toggle both use this. */
  async function setDone(poolId: string, done: boolean) {
    const at = nowIso();
    const p = await db.pools.get(poolId);
    if (p) await db.pools.put({ ...p, week: { done, doneAt: done ? at : null, changedAt: at } });
    const inMemory = poolById.value.get(poolId);
    if (inMemory) inMemory.week = { done, doneAt: done ? at : null, changedAt: at }; // instant checkbox
    await commit({ poolId, weekToggle: { done, at } }, `${done ? 'Checked off' : 'Unchecked'} · ${customerName(poolId)}`);
  }

  async function resetWeek() {
    const at = nowIso();
    for (const p of await db.pools.toArray()) {
      if (!p.week.changedAt || p.week.changedAt < at) await db.pools.put({ ...p, week: { done: false, doneAt: null, changedAt: at } });
    }
    await commit({ resetWeek: { at } }, 'Reset week');
  }

  // ------------------------------------------------------------ chemicals
  async function saveChemical(id: string | null, body: Partial<Chemical>): Promise<Chemical> {
    const now = nowIso();
    const existing = id ? await db.chemicals.get(id) : undefined;
    const doc: Chemical = existing
      ? { ...existing, ...body, updatedAt: now }
      : ({ active: true, ...body, _id: newId(), createdAt: now, updatedAt: now, deletedAt: null } as Chemical);
    await db.chemicals.put(clone(doc));
    await commit({ chemicals: [doc] }, `${existing ? 'Edit' : 'New'} chemical · ${doc.name}`);
    return doc;
  }

  // ------------------------------------------------------------ issues
  async function saveIssue(id: string | null, body: Partial<Issue>): Promise<Issue> {
    const now = nowIso();
    const existing = id ? await db.issues.get(id) : undefined;
    let doc: Issue = existing
      ? { ...existing, ...body, updatedAt: now }
      : ({
          urgent: false,
          important: false,
          status: 'open',
          resolvedAt: null,
          postponedAt: null,
          photoIds: [],
          ...body,
          _id: body._id ?? newId(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        } as Issue);
    // Same rule as the server's applyIssueStatus: stamp Completed/Postponed, clear on reopen.
    const previous = existing ? existing.status : 'open';
    if (doc.status !== previous) {
      doc.resolvedAt = doc.status === 'resolved' ? (doc.resolvedAt ?? now) : null;
      doc.postponedAt = doc.status === 'postponed' ? (doc.postponedAt ?? now) : null;
    }
    await db.issues.put(clone(doc));
    await commit({ poolId: doc.poolId, issues: [doc] }, `${existing ? 'Issue update' : 'New issue'} · ${doc.title}`);
    return doc;
  }

  const setIssueStatus = (id: string, status: IssueStatus) => saveIssue(id, { status });

  async function deleteIssue(id: string) {
    const existing = await db.issues.get(id);
    if (!existing) return;
    const now = nowIso();
    const doc = { ...existing, deletedAt: now, updatedAt: now };
    await db.issues.put(doc);
    await commit({ poolId: doc.poolId, issues: [doc] }, `Delete issue · ${doc.title}`);
  }

  /** All issues for one pool, including completed ones the phone has (last 30 days). */
  const poolIssues = async (poolId: string) => live(await db.issues.where('poolId').equals(poolId).toArray());

  // ------------------------------------------------------------ visits
  /**
   * Newest first. The phone keeps recent visits; for longer history (Overview)
   * it also asks the server when there is signal and remembers the answer.
   */
  async function recentVisits(poolId: string, limit = 2): Promise<Visit[]> {
    const local = async () =>
      live(await db.visits.where('poolId').equals(poolId).toArray())
        .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
        .slice(0, limit)
        .map(normalizeVisit);
    if (limit > 2 && navigator.onLine) {
      try {
        const remote = await api<Visit[]>(`/pools/${poolId}/visits?limit=${limit}`);
        const existing = await db.visits.bulkGet(remote.map((v) => v._id));
        await db.visits.bulkPut(remote.filter((v, i) => !existing[i] || existing[i]!.updatedAt <= v.updatedAt));
      } catch {
        // offline or server trouble: local history is fine
      }
    }
    return local();
  }

  /** One visit: from the phone if it has it, otherwise from the server (and remembered). */
  async function getVisit(id: string): Promise<Visit | undefined> {
    const local = await db.visits.get(id);
    if (local && !local.deletedAt) return normalizeVisit(local);
    try {
      const remote = await api<Visit>(`/visits/${id}`);
      await db.visits.put(remote);
      return normalizeVisit(remote);
    } catch {
      return undefined;
    }
  }

  /** Saves the visit on the phone and queues it (the same package the server already understands). */
  async function saveVisit(visit: Visit) {
    const doc = clone(visit);
    // Owner-only: each dose keeps its cost from when it was first saved.
    const before = await db.visits.get(doc._id);
    doc.doses = withDoseCosts(doc.doses, before?.doses, chemicalById.value);
    // Recap fields are set on the recap screen; keep them when the visit screen saves.
    if (before?.customerNote !== undefined && doc.customerNote === undefined) doc.customerNote = before.customerNote;
    if (before?.recapSentAt !== undefined && doc.recapSentAt === undefined) doc.recapSentAt = before.recapSentAt;
    await db.visits.put(doc);
    await db.drafts.delete(doc.poolId);
    await commit({ poolId: doc.poolId, visit: doc }, `Visit · ${customerName(doc.poolId)}`);
  }

  const refreshTimers = refreshFromDb;

  // ------------------------------------------------------------ photos
  /** Keeps the (already compressed) image on the phone and queues it with its metadata. */
  async function uploadPhoto(blob: Blob, meta: { poolId: string; issueId: string | null; equipmentId?: string | null; width: number; height: number }): Promise<Photo> {
    const now = nowIso();
    const photo: Photo = {
      _id: newId(),
      poolId: meta.poolId,
      issueId: meta.issueId,
      equipmentId: meta.equipmentId ?? null,
      savedToPool: false,
      width: meta.width,
      height: meta.height,
      bytes: blob.size,
      takenAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await db.transaction('rw', db.photos, db.photoBlobs, async () => {
      await db.photoBlobs.put({ id: photo._id, blob });
      await db.photos.put(photo);
    });
    await commit({ poolId: photo.poolId, photos: [photo] }, `Photo · ${customerName(photo.poolId)}`, [photo._id]);
    return photo;
  }

  async function listPhotos(q: { poolId?: string; issueId?: string; savedToPool?: boolean }): Promise<Photo[]> {
    let rows = q.issueId ? await db.photos.where('issueId').equals(q.issueId).toArray() : q.poolId ? await db.photos.where('poolId').equals(q.poolId).toArray() : [];
    rows = live(rows);
    if (q.poolId) rows = rows.filter((p) => p.poolId === q.poolId);
    if (q.savedToPool !== undefined) rows = rows.filter((p) => p.savedToPool === q.savedToPool);
    return rows.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  }

  /** Photos for several issues at once (issue lists show a small strip). */
  async function photosByIssue(issueIds: string[]): Promise<Map<string, Photo[]>> {
    const rows = live(await db.photos.where('issueId').anyOf(issueIds).toArray()).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    const map = new Map<string, Photo[]>();
    for (const p of rows) map.set(p.issueId!, [...(map.get(p.issueId!) ?? []), p]);
    return map;
  }

  async function patchPhoto(id: string, body: { savedToPool?: boolean; caption?: string }): Promise<Photo> {
    const existing = await db.photos.get(id);
    if (!existing) throw new Error('Photo not found on this phone');
    const doc = { ...existing, ...body, updatedAt: nowIso() };
    await db.photos.put(doc);
    await commit({ poolId: doc.poolId, photos: [doc] }, `Photo ${body.savedToPool ? 'saved to pool' : 'updated'} · ${customerName(doc.poolId)}`);
    return doc;
  }

  /** Equipment photos of a pool, by equipment item. */
  async function equipmentPhotos(poolId: string): Promise<Map<string, Photo[]>> {
    const rows = live(await db.photos.where('poolId').equals(poolId).toArray())
      .filter((p) => p.equipmentId)
      .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    const map = new Map<string, Photo[]>();
    for (const r of rows) map.set(r.equipmentId!, [...(map.get(r.equipmentId!) ?? []), r]);
    return map;
  }

  /**
   * Saves the pool's equipment list. Photos of items no longer in the list are hidden too,
   * in the same package.
   */
  async function saveEquipment(poolId: string, equipment: Equipment[], summary: string) {
    const existing = await db.pools.get(poolId);
    if (!existing) throw new Error('Pool not found');
    const now = nowIso();
    const doc: Pool = { ...existing, equipment: clone(equipment), updatedAt: now };
    const keep = new Set(equipment.map((e) => e._id));
    const orphaned = live(await db.photos.where('poolId').equals(poolId).toArray())
      .filter((p) => p.equipmentId && !keep.has(p.equipmentId))
      .map((p) => ({ ...p, deletedAt: now, updatedAt: now }));
    await db.pools.put(clone(doc));
    for (const p of orphaned) await db.photos.put(p);
    await commit({ poolId, pools: [doc], ...(orphaned.length && { photos: orphaned }) }, `${summary} · ${customerName(poolId)}`);
  }

  async function deletePhoto(id: string) {
    const existing = await db.photos.get(id);
    if (!existing) return;
    const now = nowIso();
    const doc = { ...existing, deletedAt: now, updatedAt: now };
    await db.photos.put(doc);
    await commit({ poolId: doc.poolId, photos: [doc] }, `Delete photo · ${customerName(doc.poolId)}`);
  }

  // ------------------------------------------------------------ business settings (Phase 7B)
  /** Fields passed as undefined or '' are removed. */
  async function saveSettings(body: { [K in keyof Settings]?: Settings[K] | undefined }) {
    const now = nowIso();
    const existing = await db.settings.get(BUSINESS_SETTINGS_ID);
    const doc = { ...(existing ?? { _id: BUSINESS_SETTINGS_ID, createdAt: now, deletedAt: null }), ...body, updatedAt: now } as Settings;
    // Blank text fields are removed rather than stored empty.
    for (const [k, v] of Object.entries(doc)) if (v === '' || v === undefined) delete (doc as unknown as Record<string, unknown>)[k];
    await db.settings.put(clone(doc));
    await commit({ settings: [doc] }, 'Business details');
  }

  /** Saves the dashboard layout in its own settings record (never mixed with business details). */
  async function saveDashboard(layout: DashboardLayout) {
    const now = nowIso();
    const existing = await db.settings.get(DASHBOARD_SETTINGS_ID);
    const doc = { ...(existing ?? { _id: DASHBOARD_SETTINGS_ID, createdAt: now, deletedAt: null }), dashboard: clone(layout), updatedAt: now, deletedAt: null } as Settings;
    await db.settings.put(clone(doc));
    dashboard.value = clone(layout); // the grid follows at once
    await commit({ settings: [doc] }, 'Dashboard layout');
  }

  // ------------------------------------------------------------ invoices (Phase 7B)
  const invoiceById = computed(() => new Map(invoices.value.map((i) => [i._id, i])));
  /** Next number: one more than the highest so far (void included), or the first number in settings (default 1001). */
  function nextInvoiceNumber(): number {
    const max = Math.max(0, ...invoices.value.map((i) => i.number));
    return max ? max + 1 : (settings.value?.firstInvoiceNumber ?? 1001);
  }
  /** Billing timing: "start" bills the current month, "end" the month just finished. */
  function defaultPeriod(today = new Date()): string {
    if (settings.value?.billingTiming === 'end') return periodOf(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    return periodOf(today);
  }
  const serviceLine = (rate: number, period: string): InvoiceLine => ({ _id: newId(), description: `Monthly pool service · ${periodLabel(period)}`, amount: rate });

  function draftFor(customer: Customer, period: string, number: number, issueDate: string): Invoice {
    const now = nowIso();
    const terms = settings.value?.terms ?? 'receipt';
    return {
      _id: newId(),
      customerId: customer._id,
      number,
      period,
      issueDate,
      dueDate: addDays(issueDate, TERMS_DAYS[terms]),
      lines: customer.monthlyRate ? [serviceLine(customer.monthlyRate, period)] : [],
      status: 'draft',
      sentAt: null,
      payments: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  /** Copies first: screen objects can't be stored in the phone's database or the outbox. */
  async function putInvoices(docs: Invoice[], summary: string) {
    const plain = docs.map((d) => clone(d));
    for (const d of plain) await db.invoices.put(d);
    await commit({ invoices: plain }, summary);
  }

  /** One draft invoice for a customer (their monthly rate, if any). */
  async function createInvoice(customerId: string, period = defaultPeriod()): Promise<Invoice> {
    const c = customerById.value.get(customerId);
    if (!c) throw new Error('Customer not found');
    const doc = draftFor(c, period, nextInvoiceNumber(), localDate(new Date()));
    await putInvoices([doc], `New invoice #${doc.number} · ${c.name}`);
    return doc;
  }

  /** Drafts for every current customer with a monthly rate who has no (non-void) invoice for the month. */
  async function createMonthlyInvoices(period = defaultPeriod()): Promise<Invoice[]> {
    const billed = new Set(invoices.value.filter((i) => i.period === period && i.status !== 'void').map((i) => i.customerId));
    const due = customers.value.filter((c) => customerStatus(c) === 'current' && (c.monthlyRate ?? 0) > 0 && !billed.has(c._id));
    if (!due.length) return [];
    let number = nextInvoiceNumber();
    const today = localDate(new Date());
    const docs = due.map((c) => draftFor(c, period, number++, today));
    await putInvoices(docs, `${docs.length} invoice${docs.length === 1 ? '' : 's'} · ${periodLabel(period)}`);
    return docs;
  }

  async function saveInvoice(doc: Invoice, summary: string) {
    await putInvoices([{ ...clone(doc), updatedAt: nowIso() }], summary);
  }
  async function markInvoiceSent(id: string) {
    const i = invoiceById.value.get(id);
    if (!i || i.status === 'void') return;
    await saveInvoice({ ...i, status: 'sent', sentAt: i.sentAt ?? nowIso() }, `Invoice #${i.number} sent`);
  }
  async function recordPayment(id: string, p: Omit<Payment, '_id'>) {
    const i = invoiceById.value.get(id);
    if (!i) return;
    await saveInvoice({ ...i, payments: [...i.payments, { ...p, _id: newId() }] }, `Payment · invoice #${i.number}`);
  }
  async function removePayment(id: string, paymentId: string) {
    const i = invoiceById.value.get(id);
    if (!i) return;
    await saveInvoice({ ...i, payments: i.payments.filter((p) => p._id !== paymentId) }, `Payment removed · invoice #${i.number}`);
  }
  async function voidInvoice(id: string) {
    const i = invoiceById.value.get(id);
    if (!i) return;
    await saveInvoice({ ...i, status: 'void' }, `Invoice #${i.number} void`);
  }
  /** Only drafts can be deleted; sent invoices are voided instead (the record stays). */
  async function deleteDraftInvoice(id: string) {
    const i = invoiceById.value.get(id);
    if (!i || i.status !== 'draft') return;
    const now = nowIso();
    await putInvoices([{ ...i, deletedAt: now, updatedAt: now }], `Draft invoice #${i.number} deleted`);
  }
  // ------------------------------------------------------------ ledger (Phase 7C)
  const suppliesLine = (e: Ledger, amount: number): InvoiceLine => ({
    _id: e.invoiceLineId ?? newId(),
    description: `Supplies · ${e.note?.trim() || e.vendor?.trim() || 'materials'}`,
    amount,
  });

  /**
   * Saves an expense, income or mileage entry. A Supplies expense marked "Add to their invoice"
   * puts a line on the customer's draft invoice (a new draft if they have none); changing or
   * unticking it updates or removes that line while the invoice is still a draft. Lines on
   * invoices already sent are left alone.
   */
  async function saveLedger(input: Ledger): Promise<Ledger> {
    const now = nowIso();
    const before = await db.ledger.get(input._id);
    const doc: Ledger = { ...clone(input), createdAt: before?.createdAt ?? now, updatedAt: now, deletedAt: null };
    const changed: Invoice[] = [];
    const linked = doc.invoiceId ? invoiceById.value.get(doc.invoiceId) : undefined;
    const removeLine = (inv: Invoice) => changed.push({ ...clone(inv), lines: inv.lines.filter((l) => l._id !== doc.invoiceLineId), updatedAt: now });
    const amount = doc.billedAmount ?? doc.amount ?? null;
    const wantsBill = doc.kind === 'expense' && !!doc.billToCustomer && !!doc.customerId && amount != null && amount > 0;

    if (wantsBill && linked?.status === 'draft' && linked.customerId === doc.customerId) {
      const line = suppliesLine(doc, amount!);
      const has = linked.lines.some((l) => l._id === line._id);
      changed.push({ ...clone(linked), lines: has ? linked.lines.map((l) => (l._id === line._id ? line : l)) : [...linked.lines, line], updatedAt: now });
      doc.invoiceLineId = line._id;
    } else if (wantsBill && (!linked || linked.status === 'void' || linked.customerId !== doc.customerId)) {
      if (linked?.status === 'draft') removeLine(linked);
      const customer = customerById.value.get(doc.customerId!)!;
      const draft = invoices.value.find((i) => i.customerId === doc.customerId && i.status === 'draft');
      const target = draft ? clone(draft) : draftFor(customer, defaultPeriod(), nextInvoiceNumber(), localDate(new Date()));
      const line = suppliesLine({ ...doc, invoiceLineId: null }, amount!);
      changed.push({ ...target, lines: [...target.lines, line], updatedAt: now });
      doc.invoiceId = target._id;
      doc.invoiceLineId = line._id;
    } else if (!wantsBill && linked?.status === 'draft') {
      removeLine(linked);
      doc.invoiceId = null;
      doc.invoiceLineId = null;
    }

    await db.ledger.put(clone(doc));
    for (const inv of changed) await db.invoices.put(clone(inv));
    const what = doc.kind === 'mileage' ? `Miles · ${doc.miles ?? 0}` : `${doc.kind === 'income' ? 'Income' : 'Expense'} · $${(doc.amount ?? 0).toFixed(2)}`;
    await commit({ ledger: [doc], ...(changed.length && { invoices: changed }) }, `${before ? 'Edit' : 'New'} ${what.toLowerCase()}`);
    return doc;
  }

  async function deleteLedger(id: string) {
    const e = await db.ledger.get(id);
    if (!e) return;
    const now = nowIso();
    const linked = e.invoiceId ? invoiceById.value.get(e.invoiceId) : undefined;
    // Plain copies: live screen objects can't be stored in the phone's database.
    const changed = linked?.status === 'draft' ? [clone({ ...linked, lines: linked.lines.filter((l) => l._id !== e.invoiceLineId), updatedAt: now })] : [];
    const doc = { ...e, deletedAt: now, updatedAt: now };
    await db.ledger.put(doc);
    for (const inv of changed) await db.invoices.put(inv);
    await commit({ ledger: [doc], ...(changed.length && { invoices: changed }) }, `Delete ${e.kind}`);
  }

  /** Unpaid balance per customer (sent and overdue invoices). */
  const balanceByCustomer = computed(() => {
    const m = new Map<string, number>();
    for (const i of invoices.value) {
      const st = invoiceState(i);
      if (st === 'sent' || st === 'overdue') m.set(i.customerId, Math.round(((m.get(i.customerId) ?? 0) + invoiceBalance(i)) * 100) / 100);
    }
    return m;
  });

  // ------------------------------------------------------------ edit history (server only)
  const history = (collection: string, docId: string) => api<AuditEntry[]>(`/audit?collection=${collection}&docId=${docId}`);

  // ------------------------------------------------------------ notes
  const notesFor = async (parentType: Note['parentType'], parentId: string) =>
    live(await db.notes.where('parentId').equals(parentId).toArray())
      .filter((n) => n.parentType === parentType)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));

  async function saveNote(id: string | null, body: Partial<Note>): Promise<Note> {
    const now = nowIso();
    const existing = id ? await db.notes.get(id) : undefined;
    const doc: Note = existing
      ? { ...existing, ...body, updatedAt: now }
      : ({ pinned: false, ...body, _id: newId(), createdAt: now, updatedAt: now, deletedAt: null } as Note);
    await db.notes.put(doc);
    await commit({ notes: [doc] }, `${existing ? 'Edit' : 'New'} note`);
    return doc;
  }

  async function deleteNote(id: string) {
    const existing = await db.notes.get(id);
    if (!existing) return;
    const now = nowIso();
    const doc = { ...existing, deletedAt: now, updatedAt: now };
    await db.notes.put(doc);
    await commit({ notes: [doc] }, 'Delete note');
  }

  return {
    customers,
    pools,
    chemicals,
    issues,
    activeTimers,
    loaded,
    loading,
    version,
    customerById,
    poolById,
    chemicalById,
    activeChemicals,
    settings,
    invoices,
    ledger,
    saveLedger,
    deleteLedger,
    invoiceById,
    balanceByCustomer,
    saveSettings,
    dashboard,
    saveDashboard,
    nextInvoiceNumber,
    defaultPeriod,
    createInvoice,
    createMonthlyInvoices,
    saveInvoice,
    markInvoiceSent,
    recordPayment,
    removePayment,
    voidInvoice,
    deleteDraftInvoice,
    openIssues,
    openIssuesAll,
    openIssueCount,
    currentCustomerIds,
    routePools,
    poolName,
    poolLabel,
    loadAll,
    refreshFromDb,
    saveCustomer,
    deleteCustomer,
    savePool,
    deletePool,
    setDone,
    resetWeek,
    saveChemical,
    saveIssue,
    setIssueStatus,
    deleteIssue,
    poolIssues,
    recentVisits,
    getVisit,
    saveVisit,
    refreshTimers,
    uploadPhoto,
    listPhotos,
    photosByIssue,
    patchPhoto,
    deletePhoto,
    equipmentPhotos,
    saveEquipment,
    history,
    notesFor,
    saveNote,
    deleteNote,
  };
});
