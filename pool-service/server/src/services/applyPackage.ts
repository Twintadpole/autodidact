import mongoose, { type ClientSession, type Model } from 'mongoose';
import { applyIssueStatus, CHEMICAL_PRESERVED_FIELDS, CUSTOMER_PRESERVED_FIELDS, OWNER_ONLY_FIELDS, POOL_PRESERVED_FIELDS, VISIT_PRESERVED_FIELDS, withDoseCosts, type SyncPackage, type SyncPackageResponse } from '@pool/shared';
import { Chemical, Customer, Invoice, Issue, Ledger, Note, Photo, Pool, Settings, SyncLog, Visit } from '../models/index.js';
import { cascadeCustomerDelete, cascadePoolDelete } from './cascade.js';
import { HttpError } from '../util.js';
import { diff, recordAudit } from './audit.js';
import { techScope } from './scope.js';
import { bumpAccess, isOwner, type Actor } from './users.js';

export type UpsertResult = 'inserted' | 'updated' | 'stale';

/**
 * Last-write-wins upsert: insert if new, replace if the incoming `updatedAt`
 * is at least as new as the stored one, otherwise keep the stored document.
 * `preserve` lists fields kept from the stored copy when the sender leaves them out: server-owned
 * ones the phone never sends (photo `file`), and Phase 7 fields an older app version doesn't know.
 * A field sent as null is a deliberate clear and is not preserved.
 */
export async function upsertLww(
  model: Model<any>,
  doc: Record<string, any>,
  session: ClientSession,
  now: Date,
  preserve: string[] = [],
  userId?: string,
): Promise<UpsertResult> {
  const existing = await model.findById(doc._id).session(session).lean<Record<string, any>>();
  const collectionName = model.collection.name;
  if (!existing) {
    await model.create([{ ...doc, syncedAt: now }], { session });
    await recordAudit({ collectionName, docId: doc._id, action: 'create', source: 'sync', ...(userId && { userId }) }, session);
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
  await recordAudit({ collectionName, docId: doc._id, action: deleted ? 'delete' : 'update', source: 'sync', changes, ...(userId && { userId }) }, session);
  return 'updated';
}

export interface ApplyOptions {
  /** Relative file path (under PHOTO_DIR) for each photo in the package. */
  photoFiles: Map<string, string>;
  now?: Date;
  /** Who sent it (GPF item 3). Missing = an owner (tests, older callers). */
  actor?: Actor;
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
  settings: 0,
  invoices: 0,
  ledger: 0,
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
  let movedPools: (string | null | undefined)[] = [];
  const actor: Actor = opts.actor ?? { userId: '', role: 'owner', name: '' };
  const tech = !isOwner(actor);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // withTransaction may retry this callback on transient errors: reset state.
      duplicate = false;
      Object.assign(applied, EMPTY_APPLIED());
      deletedPools = [];
      deletedCustomers = [];
      movedPools = [];

      if (await SyncLog.exists({ _id: pkg.packageId }).session(session)) {
        duplicate = true;
        return;
      }

      // GPF item 3: a tech works only on their route, never on money records, and doesn't delete
      // customers or pools. Their phone has no prices, so the server prices their doses.
      if (tech) {
        if (pkg.chemicals.length || pkg.settings.length || pkg.invoices.length || pkg.ledger.length) throw new HttpError(403, 'Only an owner can change chemicals, business details, invoices or the ledger');
      }
      let scope = tech ? await techScope(actor) : null;
      const refreshScope = async () => {
        if (tech) scope = await techScope(actor);
      };
      const assertPoolOk = (poolId: string) => {
        if (scope && !scope.poolIds.includes(poolId)) throw new HttpError(404, `Unknown pool ${poolId}`);
      };

      // Customers, pools and chemicals first: a pool created offline can be used later in the same package.
      for (const raw of pkg.customers) {
        let doc: Record<string, any> = clampClock(raw, now);
        const before = await Customer.findById(doc._id).session(session).lean<{ deletedAt?: Date | null; createdBy?: string }>();
        if (tech) {
          if (before && !scope!.customerIds.includes(doc._id)) throw new HttpError(404, `Unknown customer ${doc._id}`);
          if (doc.deletedAt && !before?.deletedAt) throw new HttpError(403, 'Only an owner can delete a customer');
          doc = Object.fromEntries(Object.entries(doc).filter(([k]) => !(OWNER_ONLY_FIELDS.customers as readonly string[]).includes(k)));
        }
        delete doc.createdBy;
        if (!before && actor.userId) doc.createdBy = actor.userId;
        if ((await upsertLww(Customer, doc, session, now, [...CUSTOMER_PRESERVED_FIELDS], actor.userId)) !== 'stale') {
          applied.customers++;
          if (doc.deletedAt && !before?.deletedAt) deletedCustomers.push(doc._id);
        }
      }
      await refreshScope();
      for (const raw of pkg.pools) {
        const doc: Record<string, any> = clampClock(raw, now);
        const before = await Pool.findById(doc._id).session(session).lean<Record<string, any>>();
        if (tech) {
          if (before && before.techId !== actor.userId) throw new HttpError(404, `Unknown pool ${doc._id}`);
          if (!before && !scope!.customerIds.includes(doc.customerId)) throw new HttpError(404, `Unknown customer ${doc.customerId}`);
          if (doc.deletedAt && !before?.deletedAt) throw new HttpError(403, 'Only an owner can delete a pool');
          doc.techId = actor.userId; // a tech's new pool is on their route; they can't move pools
        } else if (before && (before.techId ?? null) !== (doc.techId === undefined ? (before.techId ?? null) : doc.techId)) {
          movedPools.push(before.techId, doc.techId);
        } else if (!before && doc.techId) {
          movedPools.push(doc.techId);
        }
        // The weekly checkmark has its own clock (week.changedAt): keep whichever is newer, so
        // editing a pool's name on a phone that missed a Reset week doesn't undo the reset.
        const serverWeekAt = before?.week?.changedAt ? new Date(before.week.changedAt).getTime() : -1;
        const incomingWeekAt = doc.week?.changedAt ? new Date(doc.week.changedAt).getTime() : -1;
        const merged = before && serverWeekAt > incomingWeekAt ? { ...doc, week: before.week } : doc;
        if ((await upsertLww(Pool, merged, session, now, [...POOL_PRESERVED_FIELDS], actor.userId)) !== 'stale') {
          applied.pools++;
          if (doc.deletedAt && !before?.deletedAt) deletedPools.push(doc._id);
        }
      }
      for (const raw of pkg.chemicals) {
        if ((await upsertLww(Chemical, clampClock(raw, now), session, now, [...CHEMICAL_PRESERVED_FIELDS], actor.userId)) !== 'stale') applied.chemicals++;
      }
      // Phase 7B: business settings and invoices (payments travel on their invoice).
      for (const raw of pkg.settings) {
        if ((await upsertLww(Settings, clampClock(raw, now), session, now, [], actor.userId)) !== 'stale') applied.settings++;
      }
      for (const raw of pkg.invoices) {
        if ((await upsertLww(Invoice, clampClock(raw, now), session, now, [], actor.userId)) !== 'stale') applied.invoices++;
      }
      for (const raw of pkg.ledger) {
        if ((await upsertLww(Ledger, clampClock(raw, now), session, now, [], actor.userId)) !== 'stale') applied.ledger++;
      }

      const pool = pkg.poolId ? await Pool.findById(pkg.poolId).session(session).lean<Record<string, any>>() : null;
      if (pkg.poolId && !pool) throw new HttpError(422, `Unknown pool ${pkg.poolId}`);
      await refreshScope();
      if (pkg.poolId) assertPoolOk(pkg.poolId);

      if (pkg.visit) {
        const chemicalIds = [...new Set(pkg.visit.doses.map((d) => d.chemicalId))];
        if (chemicalIds.length) {
          const found = await Chemical.countDocuments({ _id: { $in: chemicalIds } }).session(session);
          if (found !== chemicalIds.length) throw new HttpError(422, 'Visit references an unknown chemical');
        }
        let visit: Record<string, any> = clampClock(pkg.visit, now);
        if (tech) {
          assertPoolOk(visit.poolId);
          const stored = await Visit.findById(visit._id).session(session).lean<Record<string, any>>();
          if (stored && !scope!.poolIds.includes(stored.poolId)) throw new HttpError(404, `Unknown visit ${visit._id}`);
          const chems = await Chemical.find({ _id: { $in: chemicalIds } }).session(session).lean<Record<string, any>[]>();
          visit = { ...visit, doses: withDoseCosts(visit.doses ?? [], stored?.doses, new Map(chems.map((c) => [c._id, c]))) };
        }
        if ((await upsertLww(Visit, visit, session, now, [...VISIT_PRESERVED_FIELDS], actor.userId)) !== 'stale') applied.visit = 1;
      }

      for (const incoming of pkg.issues) {
        const existing = await Issue.findById(incoming._id).session(session).lean<{ status?: any }>();
        const issue = applyIssueStatus(clampClock(incoming, now), existing?.status, incoming.updatedAt);
        if (tech) {
          assertPoolOk(issue.poolId);
          if (existing && !scope!.poolIds.includes((existing as any).poolId)) throw new HttpError(404, `Unknown issue ${issue._id}`);
        }
        if ((await upsertLww(Issue, issue, session, now, [], actor.userId)) !== 'stale') applied.issues++;
      }

      for (const note of pkg.notes) {
        if (tech) {
          const ok =
            (note.parentType === 'pool' && scope!.poolIds.includes(note.parentId)) ||
            (note.parentType === 'customer' && scope!.customerIds.includes(note.parentId)) ||
            (note.parentType === 'visit' &&
              (pkg.visit?._id === note.parentId || scope!.poolIds.includes((await Visit.findById(note.parentId, { poolId: 1 }).session(session).lean<{ poolId: string }>())?.poolId ?? '')));
          if (!ok) throw new HttpError(404, `Unknown record for note ${note._id}`);
        }
        if ((await upsertLww(Note, clampClock(note, now), session, now, [], actor.userId)) !== 'stale') applied.notes++;
      }

      for (const raw of pkg.photos) {
        const photo = clampClock(raw, now);
        const file = opts.photoFiles.get(photo._id);
        const doc = file ? { ...photo, file } : photo;
        if (tech) assertPoolOk(photo.poolId);
        if (!file && !(await Photo.exists({ _id: photo._id }).session(session))) {
          throw new HttpError(400, `Missing image file for photo ${photo._id}`);
        }
        if ((await upsertLww(Photo, doc, session, now, ['file', 'equipmentId'], actor.userId)) !== 'stale') applied.photos++;
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
              userId: actor.userId,
            },
            session,
          );
        }
      }

      if (pkg.resetWeek) {
        // Clears only checkmarks set before the reset was pressed; a pool checked off later stays checked.
        const at = pkg.resetWeek.at;
        const res = await Pool.updateMany(
          { deletedAt: null, ...(tech && { techId: actor.userId }), $or: [{ 'week.changedAt': null }, { 'week.changedAt': { $lt: at } }] },
          { $set: { 'week.done': false, 'week.doneAt': null, 'week.changedAt': at, syncedAt: now } },
          { session },
        );
        applied.resetWeek = res.modifiedCount;
        await recordAudit(
          { collectionName: 'pools', docId: '*', action: 'bulk', source: 'sync', note: `Reset week (offline, ${at.toISOString()}): cleared ${res.modifiedCount} checkmark(s)`, userId: actor.userId },
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
  if (movedPools.length) await bumpAccess(movedPools, now);

  return { packageId: pkg.packageId, duplicate, applied };
}
