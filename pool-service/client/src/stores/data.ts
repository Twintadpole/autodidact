import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { IssueStatus } from '@pool/shared';
import { api, apiForm } from './api';
import { clone, newId } from '@/lib/format';
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

/**
 * In-memory copy of the data the screens share (customers, pools, chemicals,
 * open issues). Phase 3 talks to the API directly; Phase 4 swaps this for the
 * IndexedDB cache + outbox without changing the screens.
 */
export const useDataStore = defineStore('data', () => {
  const customers = ref<Customer[]>([]);
  const pools = ref<Pool[]>([]);
  const chemicals = ref<Chemical[]>([]);
  const issues = ref<Issue[]>([]);
  /** Visits with a running timer (at most one, but the server allows more after offline use). */
  const activeTimers = ref<Visit[]>([]);
  const loaded = ref(false);
  const loading = ref(false);

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

  async function loadAll(force = false) {
    if ((loaded.value && !force) || loading.value) return;
    loading.value = true;
    try {
      const [c, p, ch, i, t] = await Promise.all([
        api<Customer[]>('/customers'),
        api<Pool[]>('/pools'),
        api<Chemical[]>('/chemicals'),
        api<Issue[]>('/issues?status=open,in_progress,postponed'),
        api<Visit[]>('/visits/active').then((list) => list.map(normalizeVisit)),
      ]);
      customers.value = c;
      pools.value = p;
      chemicals.value = ch;
      issues.value = i;
      activeTimers.value = t;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  function upsert<T extends { _id: string }>(list: T[], doc: T) {
    const idx = list.findIndex((d) => d._id === doc._id);
    if (idx >= 0) list.splice(idx, 1, doc);
    else list.push(doc);
  }

  // ------------------------------------------------------------ customers / pools
  async function saveCustomer(id: string | null, body: Partial<Customer>): Promise<Customer> {
    const doc = id
      ? await api<Customer>(`/customers/${id}`, { method: 'PATCH', body })
      : await api<Customer>('/customers', { method: 'POST', body: { _id: newId(), ...body } });
    upsert(customers.value, doc);
    customers.value.sort((a, b) => a.name.localeCompare(b.name));
    return doc;
  }

  async function deleteCustomer(id: string) {
    for (const p of pools.value.filter((x) => x.customerId === id)) await deletePool(p._id);
    await api(`/customers/${id}`, { method: 'DELETE' });
    customers.value = customers.value.filter((c) => c._id !== id);
  }

  async function savePool(id: string | null, body: Partial<Pool>): Promise<Pool> {
    const doc = id
      ? await api<Pool>(`/pools/${id}`, { method: 'PATCH', body })
      : await api<Pool>('/pools', { method: 'POST', body: { _id: newId(), ...body } });
    upsert(pools.value, doc);
    return doc;
  }

  async function deletePool(id: string) {
    await api(`/pools/${id}`, { method: 'DELETE' });
    pools.value = pools.value.filter((p) => p._id !== id);
  }

  /** The weekly checkmark; the Route checkbox and the visit-screen toggle both use this. */
  async function setDone(poolId: string, done: boolean) {
    const now = new Date().toISOString();
    const pool = poolById.value.get(poolId);
    if (pool) pool.week = { done, doneAt: done ? now : null, changedAt: now }; // optimistic
    const doc = await api<Pool>(`/pools/${poolId}`, {
      method: 'PATCH',
      body: { week: { done, doneAt: done ? now : null, changedAt: now } },
    });
    upsert(pools.value, doc);
  }

  async function resetWeek() {
    await api('/route/reset-week', { method: 'POST' });
    pools.value = await api<Pool[]>('/pools');
  }

  // ------------------------------------------------------------ chemicals
  async function saveChemical(id: string | null, body: Partial<Chemical>): Promise<Chemical> {
    const doc = id
      ? await api<Chemical>(`/chemicals/${id}`, { method: 'PATCH', body })
      : await api<Chemical>('/chemicals', { method: 'POST', body: { _id: newId(), active: true, ...body } });
    upsert(chemicals.value, doc);
    chemicals.value.sort((a, b) => a.name.localeCompare(b.name));
    return doc;
  }

  // ------------------------------------------------------------ issues
  async function saveIssue(id: string | null, body: Partial<Issue>): Promise<Issue> {
    const doc = id
      ? await api<Issue>(`/issues/${id}`, { method: 'PATCH', body })
      : await api<Issue>('/issues', { method: 'POST', body: { _id: newId(), ...body } });
    upsert(issues.value, doc);
    return doc;
  }

  const setIssueStatus = (id: string, status: IssueStatus) => saveIssue(id, { status });

  async function deleteIssue(id: string) {
    await api(`/issues/${id}`, { method: 'DELETE' });
    issues.value = issues.value.filter((i) => i._id !== id);
  }

  /** All issues for one pool, including completed ones (for the pool's own list). */
  const poolIssues = (poolId: string) => api<Issue[]>(`/issues?poolId=${poolId}`);

  // ------------------------------------------------------------ visits
  const recentVisits = async (poolId: string, limit = 2) => (await api<Visit[]>(`/pools/${poolId}/visits?limit=${limit}`)).map(normalizeVisit);

  /** Saves a visit through the same package endpoint the offline outbox will use in Phase 4. */
  async function saveVisit(visit: Visit) {
    const res = await api<{ duplicate: boolean }>('/sync/package', {
      method: 'POST',
      body: { packageId: newId(), poolId: visit.poolId, createdAt: new Date().toISOString(), visit },
    });
    const running = !!visit.timeLog && !visit.timeLog.finished && visit.timeLog.segments.some((s) => !s.end);
    activeTimers.value = activeTimers.value.filter((v) => v._id !== visit._id);
    if (running) activeTimers.value.push(clone(visit));
    return res;
  }

  const refreshTimers = async () => {
    activeTimers.value = (await api<Visit[]>('/visits/active')).map(normalizeVisit);
  };

  // ------------------------------------------------------------ photos
  /** Uploads one (already compressed) image with its metadata; returns the photo record. */
  async function uploadPhoto(blob: Blob, meta: { poolId: string; issueId: string | null; width: number; height: number }): Promise<Photo> {
    const now = new Date().toISOString();
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
    const form = new FormData();
    form.append('package', JSON.stringify({ packageId: newId(), poolId: meta.poolId, createdAt: now, photos: [photo] }));
    form.append(photo._id, blob, `${photo._id}.jpg`);
    await apiForm('/sync/package', form);
    return photo;
  }

  const listPhotos = (q: { poolId?: string; issueId?: string; savedToPool?: boolean }) => {
    const params = new URLSearchParams();
    if (q.poolId) params.set('poolId', q.poolId);
    if (q.issueId) params.set('issueId', q.issueId);
    if (q.savedToPool !== undefined) params.set('savedToPool', String(q.savedToPool));
    return api<Photo[]>(`/photos?${params}`);
  };
  const patchPhoto = (id: string, body: { savedToPool?: boolean; caption?: string }) => api<Photo>(`/photos/${id}`, { method: 'PATCH', body });
  const deletePhoto = (id: string) => api(`/photos/${id}`, { method: 'DELETE' });

  // ------------------------------------------------------------ edit history
  const history = (collection: string, docId: string) => api<AuditEntry[]>(`/audit?collection=${collection}&docId=${docId}`);

  // ------------------------------------------------------------ notes
  const notesFor = (parentType: Note['parentType'], parentId: string) =>
    api<Note[]>(`/notes?parentType=${parentType}&parentId=${parentId}`);

  const saveNote = (id: string | null, body: Partial<Note>) =>
    id
      ? api<Note>(`/notes/${id}`, { method: 'PATCH', body })
      : api<Note>('/notes', { method: 'POST', body: { _id: newId(), ...body } });

  const deleteNote = (id: string) => api(`/notes/${id}`, { method: 'DELETE' });

  return {
    customers,
    pools,
    chemicals,
    issues,
    activeTimers,
    loaded,
    loading,
    customerById,
    poolById,
    chemicalById,
    activeChemicals,
    openIssues,
    openIssueCount,
    loadAll,
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
    patchPhoto,
    deletePhoto,
    history,
    notesFor,
    saveNote,
    deleteNote,
  };
});
