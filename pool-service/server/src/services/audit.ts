import type { ClientSession } from 'mongoose';
import { AuditLog } from '../models/index.js';
import { newId } from '../util.js';

export type AuditSource = 'app' | 'sync' | 'system';
export interface Change {
  path: string;
  from: unknown;
  to: unknown;
}

/** Bookkeeping fields that change on every write and aren't worth logging. */
const IGNORED = new Set(['updatedAt', 'syncedAt', 'createdAt', '_id', 'file']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** JSON-ish normal form so Dates and ISO strings compare equal. */
function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(norm);
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v === undefined ? null : v;
}

/** null, undefined, {} and [] all mean "nothing here" (the database drops empty objects). */
function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.values(v).every(isEmpty);
  return false;
}

/**
 * Field-level differences between two versions of a document. Nested objects are
 * walked (readings.fc, week.done); arrays are compared whole (doses, timeLog.segments).
 */
export function diff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>, prefix = ''): Change[] {
  const changes: Change[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  for (const key of keys) {
    if (!prefix && IGNORED.has(key)) continue;
    const a = norm(before?.[key]);
    const b = norm(after[key]);
    const path = prefix ? `${prefix}.${key}` : key;
    if (isEmpty(a) && isEmpty(b)) continue;
    if (isPlainObject(a) && isPlainObject(b)) {
      changes.push(...diff(a, b, path));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      // A PATCH body only carries the fields it changes: a missing key means "unchanged".
      if (!(key in after)) continue;
      changes.push({ path, from: a, to: b });
    }
  }
  return changes;
}

export async function recordAudit(
  entry: { collectionName: string; docId: string; action: 'create' | 'update' | 'delete' | 'bulk'; source: AuditSource; changes?: Change[]; note?: string },
  session?: ClientSession,
): Promise<void> {
  if (entry.action === 'update' && !entry.changes?.length) return;
  await AuditLog.create([{ _id: newId(), at: new Date(), changes: [], ...entry }], session ? { session } : {});
}
