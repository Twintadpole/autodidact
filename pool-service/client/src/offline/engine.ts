/**
 * Outbox + pull engine, shared by the app and the service worker (which runs it
 * in the background after the app is closed, via Background Sync).
 *
 * - Every change becomes a package in the outbox (IndexedDB), sent oldest first.
 * - The server ignores a repeated packageId, so retrying after a lost reply is safe.
 * - Network trouble → back off (5 s doubling to 5 min). A 4xx → marked failed
 *   and shown on the Sync screen with the error. 401 → stop until logged in again.
 * - When the outbox is empty, pull what changed on the server (newer updatedAt wins).
 * - Cloudflare Access login expired → stop and keep everything waiting (needsAccess).
 * - Nothing can hang forever: each request has a time limit, and a sync lock held
 *   too long by another tab (e.g. one Chrome paused mid-upload) is taken over.
 */
import { db, getMeta, setMeta, type OutboxRow } from './db';
import { API_REDIRECT, isAccessBlocked } from './access';

export const SYNC_TAG = 'pool-outbox';
const MIN_BACKOFF = 5_000;
const MAX_BACKOFF = 5 * 60_000;
/** Time limits: a plain change, a change with photos, and how long to wait for another tab's sync. */
const SEND_TIMEOUT = 60_000;
const PHOTO_SEND_TIMEOUT = 3 * 60_000;
const PULL_TIMEOUT = 60_000;
const LOCK_WAIT = 90_000;

export class NeedsLoginError extends Error {}
export class NeedsAccessError extends Error {}

export interface SyncResult {
  sent: number;
  failed: number;
  remaining: number;
  pulled: boolean;
  offline: boolean;
  needsLogin: boolean;
  /** Cloudflare Access wants its emailed-code login again. */
  needsAccess: boolean;
}

type LockOptions = { signal?: AbortSignal; steal?: boolean };
type Locks = { request<T>(name: string, opts: LockOptions, cb: () => Promise<T>): Promise<T> };

/**
 * Runs `fn` with a lock shared by every tab and the service worker, so normally only one
 * sync runs at a time. If another holder keeps it longer than LOCK_WAIT (usually a tab that
 * Chrome paused mid-sync), take it over: the server ignores packages it has already
 * applied, so an overlap is harmless.
 */
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  // Works in a page and in the service worker (both have navigator.locks in Chrome).
  const locks = (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks;
  if (!locks?.request) return fn();
  let started = false;
  const run = () => {
    started = true;
    return fn();
  };
  try {
    return await locks.request('pool-sync', { signal: AbortSignal.timeout(LOCK_WAIT) }, run);
  } catch (err) {
    if (started) throw err; // fn itself failed; not a lock timeout
    return locks.request('pool-sync', { steal: true }, run);
  }
}

export async function enqueue(pkg: Record<string, unknown>, summary: string, photoIds: string[] = []): Promise<void> {
  const row: OutboxRow = {
    id: String(pkg.packageId),
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    summary,
    pkg,
    photoIds,
  };
  await db.outbox.add(row);
  await registerBackgroundSync();
}

/** Lets Chrome send the outbox later even if the app is closed (Android). */
export async function registerBackgroundSync(): Promise<void> {
  try {
    const sw = (globalThis as { navigator?: { serviceWorker?: { ready: Promise<unknown> } } }).navigator?.serviceWorker;
    const reg = (await sw?.ready) as { sync?: { register(tag: string): Promise<void> } } | undefined;
    await reg?.sync?.register(SYNC_TAG);
  } catch {
    // Not supported (desktop Safari/Firefox): the app syncs while it is open instead.
  }
}

async function send(row: OutboxRow): Promise<Response> {
  if (!row.photoIds.length) {
    return fetch('/api/sync/package', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: API_REDIRECT,
      signal: AbortSignal.timeout(SEND_TIMEOUT),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(row.pkg),
    });
  }
  const form = new FormData();
  form.append('package', JSON.stringify(row.pkg));
  for (const id of row.photoIds) {
    const b = await db.photoBlobs.get(id);
    if (b) form.append(id, b.blob, `${id}.jpg`);
  }
  return fetch('/api/sync/package', { method: 'POST', credentials: 'same-origin', body: form, redirect: API_REDIRECT, signal: AbortSignal.timeout(PHOTO_SEND_TIMEOUT) });
}

async function processOutboxUnlocked(force: boolean): Promise<Omit<SyncResult, 'pulled'>> {
  let sent = 0;
  for (;;) {
    const row = await db.outbox.where('status').equals('pending').sortBy('createdAt').then((rows) => rows[0]);
    if (!row) break;
    if (!force && row.nextAttemptAt > Date.now()) break;

    let res: Response;
    try {
      res = await send(row);
    } catch (err) {
      await backoff(row, (err as { name?: string } | null)?.name === 'TimeoutError' ? 'Timed out' : 'No connection');
      return { sent, failed: await failedCount(), remaining: await pendingCount(), offline: true, needsLogin: false, needsAccess: false };
    }
    if (isAccessBlocked(res)) {
      return { sent, failed: await failedCount(), remaining: await pendingCount(), offline: false, needsLogin: false, needsAccess: true };
    }
    if (res.ok) {
      await db.transaction('rw', db.outbox, db.photoBlobs, async () => {
        await db.outbox.delete(row.id);
        if (row.photoIds.length) await db.photoBlobs.bulkDelete(row.photoIds);
      });
      sent++;
      continue;
    }
    if (res.status === 401) {
      return { sent, failed: await failedCount(), remaining: await pendingCount(), offline: false, needsLogin: true, needsAccess: false };
    }
    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      await backoff(row, `Server error ${res.status}`);
      return { sent, failed: await failedCount(), remaining: await pendingCount(), offline: false, needsLogin: false, needsAccess: false };
    }
    // 4xx: the server will never accept this package as it is. Park it for the Sync screen.
    let message = `${res.status}`;
    try {
      message = ((await res.json()) as { message?: string }).message ?? message;
    } catch {
      // keep status
    }
    await db.outbox.update(row.id, { status: 'failed', lastError: message, attempts: row.attempts + 1 });
  }
  return { sent, failed: await failedCount(), remaining: await pendingCount(), offline: false, needsLogin: false, needsAccess: false };
}

async function backoff(row: OutboxRow, error: string) {
  const attempts = row.attempts + 1;
  const delay = Math.min(MIN_BACKOFF * 2 ** (attempts - 1), MAX_BACKOFF);
  await db.outbox.update(row.id, { attempts, lastError: error, nextAttemptAt: Date.now() + delay });
}

export const pendingCount = () => db.outbox.where('status').equals('pending').count();
export const failedCount = () => db.outbox.where('status').equals('failed').count();

const PULL_TABLES = ['customers', 'pools', 'visits', 'chemicals', 'issues', 'notes', 'photos', 'settings', 'invoices'] as const;

/** Brings down everything changed on the server since the last pull. */
async function pullUnlocked(): Promise<boolean> {
  const since = await getMeta<string>('lastPull');
  let res: Response;
  try {
    res = await fetch(`/api/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`, { credentials: 'same-origin', redirect: API_REDIRECT, signal: AbortSignal.timeout(PULL_TIMEOUT) });
  } catch {
    return false;
  }
  if (isAccessBlocked(res)) throw new NeedsAccessError();
  if (res.status === 401) throw new NeedsLoginError();
  if (!res.ok) return false;
  const data = (await res.json()) as Record<string, { _id: string; updatedAt: string }[]> & { serverTime: string };
  await db.transaction('rw', PULL_TABLES.map((t) => db[t]), async () => {
    for (const t of PULL_TABLES) {
      const incoming = data[t] ?? [];
      if (!incoming.length) continue;
      const table = db[t] as unknown as import('dexie').Table<{ _id: string; updatedAt: string }, string>;
      const existing = await table.bulkGet(incoming.map((d) => d._id));
      // Newer wins; a local edit that hasn't reached the server yet is newer, so it is kept.
      const newer = incoming.filter((d, i) => !existing[i] || existing[i]!.updatedAt <= d.updatedAt);
      if (newer.length) await table.bulkPut(newer);
    }
  });
  await setMeta('lastPull', data.serverTime);
  await setMeta('lastPullAt', new Date().toISOString());
  return true;
}

/** Send the outbox, then (if it's empty) pull. Safe to call often; runs one at a time. */
export async function syncNow(opts: { force?: boolean; pull?: boolean } = {}): Promise<SyncResult> {
  return exclusive(async () => {
    const out = await processOutboxUnlocked(!!opts.force);
    let pulled = false;
    let needsLogin = out.needsLogin;
    let needsAccess = out.needsAccess;
    if (!out.offline && !needsLogin && !needsAccess && out.remaining === 0 && opts.pull !== false) {
      try {
        pulled = await pullUnlocked();
      } catch (err) {
        if (err instanceof NeedsLoginError) needsLogin = true;
        if (err instanceof NeedsAccessError) needsAccess = true;
      }
    }
    return { ...out, pulled, needsLogin, needsAccess };
  });
}
