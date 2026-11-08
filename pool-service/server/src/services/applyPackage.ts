import mongoose, { type ClientSession, type Model } from 'mongoose';
import { applyIssueStatus, type SyncPackage, type SyncPackageResponse } from '@pool/shared';
import { Chemical, Customer, Issue, Note, Photo, Pool, SyncLog, Visit } from '../models/index.js';
import { cascadeCustomerDelete, cascadePoolDelete } from './cascade.js';
import { HttpError } from '../util.js';
import { diff, recordAudit } from './audit.js';

export type UpsertResult = 'inserted' | 'updated' | 'stale';

/**
 * Last-write-wins upsert: insert if new, replace if the incoming `updatedAt`
 * is at least as new as the stored one, otherwise keep the stored document.
 * `preserve` lists server-owned fields that the phone never sends (e.g. photo `file`).
 */
export async function upsertLww(
  model: Model<any>,
  doc: Record<string, any>,
  session: ClientSession,
  now: Date,
  preserve: string[] = [],
): Promise<UpsertResult> {
  const existing = await model.findById(doc._id).session(session).lean<Record<string, any>>();
  const collectionName = model.collection.name;
  if (!existing) {
    await model.create([{ ...doc, syncedAt: now }], { session });
    await recordAudit({ collectionName, docId: doc._id, action: 'create', source: 'sync' }, session);
    return 'inserted';
  }
  if (new Date(existing.updatedAt) > new Date(doc.updatedAt)) return 'stale';
  const replacement: Record<string, any> = { ...doc, syncedAt: now };
  for (const key of preserve) {
    if (replacement[key] === undefined && existing[key] !== undefined) replacement[key] = existing[key];
  }
  await model.replaceOne({ _id: doc._id }, replacement, { session, runValidators: true });
  const changes = diff(existing, replacement);
  // A soft delete arriving from the phone reads better as "delete" than as a deletedAt change.
  const deleted = !existing.deletedAt && !!replacement.deletedAt;
  await recordAudit({ collectionName, docId: doc._id, action: deleted ? 'delete' : 'update', source: 'sync', changes }, session);
  return 'updated';
}

export interface ApplyOptions {
  /** Relative file path (under PHOTO_DIR) for each photo in the package. */
  photoFiles: Map<string, string>;
  now?: Date;
}

export interface ApplyResult extends SyncPackageResponse {}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Applies one field package atomically. Safe to call repeatedly with the same
 * package: the `syncLog` entry (keyed by packageId) is written in the same
 * transaction, so a retry finds it and returns `duplicate: true`.
 */
const EMPTY_APPLIED = (): ApplyResult['applied'] => ({
  customers: 0,
  pools: 0,
  chemicals: 0,
  visit: 0,
  issues: 0,
  notes: 0,
  photos: 0,
  weekToggle: false,
  resetWeek: 0,
});

/** A phone whose clock runs fast must not "win" every future edit: cap times at server now + 5 min. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
function clampClock<T extends { updatedAt: Date; createdAt: Date }>(doc: T, now: Date): T {
  const limit = now.getTime() + CLOCK_SKEW_MS;
  const out = { ...doc };
  if (out.updatedAt.getTime() > limit) out.updatedAt = now;
  if (out.createdAt.getTime() > limit) out.createdAt = now;
  return out;
}

/**
 * Applies one package atomically. Safe to call repeatedly with the same
 * package: the `syncLog` entry (keyed by packageId) is written in the same
 * transaction, so a retry finds it and returns `duplicate: true`.
 */
export async function applyPackage(pkg: SyncPackage, opts: ApplyOptions): Promise<ApplyResult> {
  const now = opts.now ?? new Date();
  const applied = EMPTY_APPLIED();
  let duplicate = false;
  let deletedPools: string[] = [];
  let deletedCustomers: string[] = [];

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // withTransaction may retry this callback on transient errors: reset state.
      duplicate = false;
      Object.assign(applied, EMPTY_APPLIED());
      deletedPools = [];
      deletedCustomers = [];

      if (await SyncLog.exists({ _id: pkg.packageId }).session(session)) {
        duplicate = true;
        return;
      }

      // Customers, pools and chemicals first: a pool created offline can be used later in the same package.
      for (const raw of pkg.customers) {
        const doc = clampClock(raw, now);
        const before = await Customer.findById(doc._id).session(session).lean<{ deletedAt?: Date | null }>();
        if ((await upsertLww(Customer, doc, session, now)) !== 'stale') {
          applied.customers++;
          if (doc.deletedAt && !before?.deletedAt) deletedCustomers.push(doc._id);
        }
      }
      for (const raw of pkg.pools) {
        const doc = clampClock(raw, now);
        const before = await Pool.findById(doc._id).session(session).lean<Record<string, any>>();
        // The weekly checkmark has its own clock (week.changedAt): keep whichever is newer, so
        // editing a pool's name on a phone that missed a Reset week doesn't undo the reset.
        const serverWeekAt = before?.week?.changedAt ? new Date(before.week.changedAt).getTime() : -1;
        const incomingWeekAt = doc.week?.changedAt ? new Date(doc.week.changedAt).getTime() : -1;
        const merged = before && serverWeekAt > incomingWeekAt ? { ...doc, week: before.week } : doc;
        if ((await upsertLww(Pool, merged, session, now)) !== 'stale') {
          applied.pools++;
          if (doc.deletedAt && !before?.deletedAt) deletedPools.push(doc._id);
        }
      }
      for (const raw of pkg.chemicals) {
        if ((await upsertLww(Chemical, clampClock(raw, now), session, now)) !== 'stale') applied.chemicals++;
      }

      const pool = pkg.poolId ? await Pool.findById(pkg.poolId).session(session).lean<Record<string, any>>() : null;
      if (pkg.poolId && !pool) throw new HttpError(422, `Unknown pool ${pkg.poolId}`);

      if (pkg.visit) {
        const chemicalIds = [...new Set(pkg.visit.doses.map((d) => d.chemicalId))];
        if (chemicalIds.length) {
          const found = await Chemical.countDocuments({ _id: { $in: chemicalIds } }).session(session);
          if (found !== chemicalIds.length) throw new HttpError(422, 'Visit references an unknown chemical');
        }
        if ((await upsertLww(Visit, clampClock(pkg.visit, now), session, now)) !== 'stale') applied.visit = 1;
      }

      for (const incoming of pkg.issues) {
        const existing = await Issue.findById(incoming._id).session(session).lean<{ status?: any }>();
        const issue = applyIssueStatus(clampClock(incoming, now), existing?.status, incoming.updatedAt);
        if ((await upsertLww(Issue, issue, session, now)) !== 'stale') applied.issues++;
      }

      for (const note of pkg.notes) {
        if ((await upsertLww(Note, clampClock(note, now), session, now)) !== 'stale') applied.notes++;
      }

      for (const raw of pkg.photos) {
        const photo = clampClock(raw, now);
        const file = opts.photoFiles.get(photo._id);
        const doc = file ? { ...photo, file } : photo;
        if (!file && !(await Photo.exists({ _id: photo._id }).session(session))) {
          throw new HttpError(400, `Missing image file for photo ${photo._id}`);
        }
        if ((await upsertLww(Photo, doc, session, now, ['file'])) !== 'stale') applied.photos++;
      }

      if (pkg.weekToggle && pool) {
        const changedAt = pool.week?.changedAt ? new Date(pool.week.changedAt) : null;
        // A later change (e.g. Reset week on the server) beats an older offline toggle.
        if (!changedAt || pkg.weekToggle.at >= changedAt) {
          await Pool.updateOne(
            { _id: pkg.poolId },
            {
              $set: {
                'week.done': pkg.weekToggle.done,
                'week.doneAt': pkg.weekToggle.done ? pkg.weekToggle.at : null,
                'week.changedAt': pkg.weekToggle.at,
                updatedAt: pkg.weekToggle.at > new Date(pool.updatedAt) ? pkg.weekToggle.at : pool.updatedAt,
                syncedAt: now,
              },
            },
            { session },
          );
          applied.weekToggle = true;
          await recordAudit(
            {
              collectionName: 'pools',
              docId: pkg.poolId!,
              action: 'update',
              source: 'sync',
              changes: [{ path: 'week.done', from: !!pool.week?.done, to: pkg.weekToggle.done }],
            },
            session,
          );
        }
      }

      if (pkg.resetWeek) {
        // Clears only checkmarks set before the reset was pressed; a pool checked off later stays checked.
        const at = pkg.resetWeek.at;
        const res = await Pool.updateMany(
          { deletedAt: null, $or: [{ 'week.changedAt': null }, { 'week.changedAt': { $lt: at } }] },
          { $set: { 'week.done': false, 'week.doneAt': null, 'week.changedAt': at, syncedAt: now } },
          { session },
        );
        applied.resetWeek = res.modifiedCount;
        await recordAudit(
          { collectionName: 'pools', docId: '*', action: 'bulk', source: 'sync', note: `Reset week (offline, ${at.toISOString()}): cleared ${res.modifiedCount} checkmark(s)` },
          session,
        );
      }

      await SyncLog.create([{ _id: pkg.packageId, poolId: pkg.poolId ?? null, appliedAt: now, summary: applied }], { session });
    });
  } catch (err) {
    // Two copies of the same package raced; the other one won and applied it.
    if (isDuplicateKey(err)) {
      return { packageId: pkg.packageId, duplicate: true, applied: EMPTY_APPLIED() };
    }
    throw err;
  } finally {
    await session.endSession();
  }

  // Deletions that arrived from the phone hide what belongs to the pool/customer too.
  for (const id of deletedCustomers) await cascadeCustomerDelete(id, now);
  for (const id of deletedPools) await cascadePoolDelete(id, now, 'Pool deleted');

  return { packageId: pkg.packageId, duplicate, applied };
}
