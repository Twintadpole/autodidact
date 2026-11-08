import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db, getMeta, type OutboxRow } from '@/offline/db';
import { failedCount, pendingCount, syncNow } from '@/offline/engine';
import { useAuthStore } from './auth';
import { useDataStore } from './data';

/**
 * Drives the sync engine from the app: on start, when signal returns, every
 * 60 s while open, when the app comes back to the screen, and after each change.
 * Exposes counts for the header chip and the Sync screen.
 */
export const useSyncStore = defineStore('sync', () => {
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);
  const reachable = ref(true);
  const pending = ref(0);
  const failed = ref(0);
  const syncing = ref(false);
  const lastPullAt = ref<string | null>(null);
  const lastError = ref('');
  let again = false;
  let started = false;

  const state = computed<'offline' | 'waiting' | 'failed' | 'syncing' | 'synced'>(() => {
    if (failed.value) return 'failed';
    if (!online.value || !reachable.value) return 'offline';
    if (syncing.value && pending.value) return 'syncing';
    if (pending.value) return 'waiting';
    return 'synced';
  });

  async function refreshCounts() {
    pending.value = await pendingCount();
    failed.value = await failedCount();
    lastPullAt.value = (await getMeta<string>('lastPullAt')) ?? null;
  }

  /** Run a sync now (coalesces overlapping calls). */
  async function kick(opts: { force?: boolean } = {}) {
    if (syncing.value) {
      again = true;
      return;
    }
    syncing.value = true;
    try {
      do {
        again = false;
        // Respect the backoff after a failure; "force" (signal just came back, Sync now) skips it.
        const r = await syncNow({ force: !!opts.force });
        reachable.value = !r.offline;
        lastError.value = '';
        if (r.needsLogin) {
          useAuthStore().expired();
          break;
        }
        if (r.sent || r.pulled) await useDataStore().refreshFromDb();
      } while (again);
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
    } finally {
      syncing.value = false;
      await refreshCounts();
      await scheduleRetry();
    }
  }

  /** After a dropped connection, try again as soon as the backoff ends (not just on the 60 s tick). */
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  async function scheduleRetry() {
    clearTimeout(retryTimer);
    if (!pending.value) return;
    const next = (await db.outbox.where('status').equals('pending').toArray()).reduce((m, r) => Math.min(m, r.nextAttemptAt), Infinity);
    if (!Number.isFinite(next)) return;
    const wait = Math.min(Math.max(next - Date.now(), 1000), 60_000);
    retryTimer = setTimeout(() => void kick(), wait);
  }

  /** Start the timers and listeners once, after login. */
  function start() {
    if (started) return;
    started = true;
    window.addEventListener('online', () => {
      online.value = true;
      void kick({ force: true });
    });
    window.addEventListener('offline', () => {
      online.value = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void kick();
    });
    setInterval(() => void kick(), 60_000);
    void refreshCounts();
  }

  // ---- Sync screen
  const outbox = ref<OutboxRow[]>([]);
  async function loadOutbox() {
    outbox.value = await db.outbox.orderBy('createdAt').toArray();
    await refreshCounts();
  }

  async function retry(id: string) {
    await db.outbox.update(id, { status: 'pending', nextAttemptAt: 0, lastError: '' });
    await kick({ force: true });
    await loadOutbox();
  }

  async function discard(id: string) {
    const row = await db.outbox.get(id);
    if (!row) return;
    await db.transaction('rw', db.outbox, db.photoBlobs, async () => {
      await db.outbox.delete(id);
      if (row.photoIds.length) await db.photoBlobs.bulkDelete(row.photoIds);
    });
    await loadOutbox();
  }

  /**
   * Replace the phone's copy with the server's (only when nothing is waiting to
   * upload). Useful after discarding a change.
   */
  async function reloadFromServer() {
    if ((await db.outbox.count()) > 0) throw new Error('Send or discard the waiting changes first.');
    await db.transaction('rw', [db.customers, db.pools, db.visits, db.chemicals, db.issues, db.notes, db.photos, db.meta], async () => {
      await Promise.all([db.customers.clear(), db.pools.clear(), db.visits.clear(), db.chemicals.clear(), db.issues.clear(), db.notes.clear(), db.photos.clear()]);
      await db.meta.delete('lastPull');
    });
    await kick({ force: true });
    await useDataStore().refreshFromDb();
  }

  return { online, reachable, pending, failed, syncing, lastPullAt, lastError, state, kick, start, refreshCounts, outbox, loadOutbox, retry, discard, reloadFromServer };
});
