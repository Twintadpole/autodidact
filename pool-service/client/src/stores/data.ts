import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { IssueStatus } from '@pool/shared';
import { api } from './api';
import { useSyncStore } from './sync';
import { clone, newId } from '@/lib/format';
import { db } from '@/offline/db';
import { enqueue } from '@/offline/engine';
import type { AuditEntry, Chemical, Customer, Issue, Note, Photo, Pool, Visit } from '@/lib/types';

/** The database drops empty objects/arrays, so fill in what a visit always has. */
export function normalizeVisit(v: Visit): Visit {
  v.readings ??= {};
  v.doses ??= [];
  const t: Partial<Visit['tasks']> = v.tasks ?? {};
  v.tasks = { brushed: !!t.brushed, skimmed: !!t.skimmed, vacuumed: !!t.vacuumed, basketsEmptied: !!t.basketsEmptied, filterCleaned: !!t.filterCleaned };
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
  const loaded = ref(false);
  const loading = ref(false);
  /** Bumped whenever the phone's copy changes (sync or local edit); screens that read it once watch this. */
  const version = ref(0);

  const customerById = computed(() => new Map(customers.value.map((c) => [c._id, c])));
  const poolById = computed(() => new Map(pools.value.map((p) => [p._id, p])));
  const chemicalById = computed(() => new Map(chemicals.value.map((c) => [c._id, c])));
  const activeChemicals = computed(() => chemicals.value.filter((c) => c.active));

  /** Open = anything not completed (open, in progress, postponed). */
  const openIssues = computed(() => issues.value.filter((i) => i.status !== 'resolved'));
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
    const [c, p, ch, i, running] = await Promise.all([
      db.customers.toArray(),
      db.pools.toArray(),
      db.chemicals.toArray(),
      db.issues.toArray(),
      db.visits.filter((v) => !v.deletedAt && isRunning(v)).toArray(),
    ]);
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
    await enqueue({ packageId: newId(), createdAt: nowIso(), ...pkg }, summary, photoIds);
    const sync = useSyncStore();
    await sync.refreshCounts(); // the header chip shows "1 waiting" right away
    await refreshFromDb();
    void sync.kick();
  }

  const customerName = (poolId: string) => {
    const p = poolById.value.get(poolId);
    return p ? `${customerById.value.get(p.customerId)?.name ?? 'Customer'} · ${p.name}` : 'Pool';
  };

  // ------------------------------------------------------------ customers / pools
  async function saveCustomer(id: string | null, body: Partial<Customer>): Promise<Customer> {
    const now = nowIso();
    const existing = id ? await db.customers.get(id) : undefined;
    const doc: Customer = existing
      ? { ...existing, ...body, updatedAt: now }
      : ({ phones: [], ...body, _id: body._id ?? newId(), createdAt: now, updatedAt: now, deletedAt: null } as Customer);
    // Optional fields cleared in the form must disappear, not linger from the old copy.
    for (const k of ['email', 'notes'] as const) if (existing && !(k in body)) delete doc[k];
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

  /** Saves the visit on the phone and queues it (the same package the server already understands). */
  async function saveVisit(visit: Visit) {
    const doc = clone(visit);
    await db.visits.put(doc);
    await db.drafts.delete(doc.poolId);
    await commit({ poolId: doc.poolId, visit: doc }, `Visit · ${customerName(doc.poolId)}`);
  }

  const refreshTimers = refreshFromDb;

  // ------------------------------------------------------------ photos
  /** Keeps the (already compressed) image on the phone and queues it with its metadata. */
  async function uploadPhoto(blob: Blob, meta: { poolId: string; issueId: string | null; width: number; height: number }): Promise<Photo> {
    const now = nowIso();
    const photo: Photo = {
      _id: newId(),
      poolId: meta.poolId,
      issueId: meta.issueId,
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

  async function deletePhoto(id: string) {
    const existing = await db.photos.get(id);
    if (!existing) return;
    const now = nowIso();
    const doc = { ...existing, deletedAt: now, updatedAt: now };
    await db.photos.put(doc);
    await commit({ poolId: doc.poolId, photos: [doc] }, `Delete photo · ${customerName(doc.poolId)}`);
  }

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
    openIssues,
    openIssueCount,
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
    saveVisit,
    refreshTimers,
    uploadPhoto,
    listPhotos,
    photosByIssue,
    patchPhoto,
    deletePhoto,
    history,
    notesFor,
    saveNote,
    deleteNote,
  };
});
