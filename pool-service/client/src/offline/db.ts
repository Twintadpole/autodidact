/**
 * The phone's local copy of the data (IndexedDB via Dexie), shared by the app
 * and the service worker. Screens read from here, so they work with no signal.
 */
import Dexie, { type Table } from 'dexie';
import type { Chemical, Customer, Issue, Note, Photo, Pool, Visit } from '../lib/types';

/** One queued package waiting to be sent to the server. */
export interface OutboxRow {
  /** = packageId (the server's idempotency key). */
  id: string;
  createdAt: string;
  status: 'pending' | 'failed';
  attempts: number;
  /** Epoch ms; backoff after a network error. */
  nextAttemptAt: number;
  lastError?: string;
  /** Human description for the Sync screen, e.g. "Visit · Smith · Backyard". */
  summary: string;
  pkg: Record<string, unknown>;
  /** Photos whose image bytes (in photoBlobs) go with this package. */
  photoIds: string[];
}

export interface Draft {
  poolId: string;
  visit: Visit;
  savedAt: string;
}

export class PoolDB extends Dexie {
  customers!: Table<Customer, string>;
  pools!: Table<Pool, string>;
  visits!: Table<Visit, string>;
  chemicals!: Table<Chemical, string>;
  issues!: Table<Issue, string>;
  notes!: Table<Note, string>;
  photos!: Table<Photo, string>;
  photoBlobs!: Table<{ id: string; blob: Blob }, string>;
  outbox!: Table<OutboxRow, string>;
  drafts!: Table<Draft, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('pool-service');
    this.version(1).stores({
      customers: '_id',
      pools: '_id, customerId',
      visits: '_id, poolId, visitedAt',
      chemicals: '_id',
      issues: '_id, poolId',
      notes: '_id, parentId',
      photos: '_id, poolId, issueId',
      photoBlobs: 'id',
      outbox: 'id, createdAt, status',
      drafts: 'poolId',
      meta: 'key',
    });
  }
}

export const db = new PoolDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Ask the browser not to evict our data when the phone is low on space. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = (globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean> } } }).navigator?.storage;
    return (await storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
