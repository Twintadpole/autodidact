import { Issue, Note, Photo, Pool, Visit } from '../models/index.js';
import { recordAudit } from './audit.js';

/**
 * Soft-deleting a pool or customer also hides what belongs to it, so it doesn't
 * linger in lists and reports. Nothing is erased: every record keeps its data
 * (and is in the backups), just with deletedAt set, and the cascade is logged.
 */

const stamp = (now: Date) => ({ $set: { deletedAt: now, updatedAt: now, syncedAt: now } });

export async function cascadePoolDelete(poolId: string, now: Date, reason: string): Promise<Record<string, number>> {
  const liveVisitIds = (await Visit.find({ poolId, deletedAt: null }, { _id: 1 }).lean<{ _id: string }[]>()).map((v) => v._id);
  const counts = {
    visits: (await Visit.updateMany({ poolId, deletedAt: null }, stamp(now))).modifiedCount,
    issues: (await Issue.updateMany({ poolId, deletedAt: null }, stamp(now))).modifiedCount,
    photos: (await Photo.updateMany({ poolId, deletedAt: null }, stamp(now))).modifiedCount,
    notes: (
      await Note.updateMany(
        {
          deletedAt: null,
          $or: [
            { parentType: 'pool', parentId: poolId },
            { parentType: 'visit', parentId: { $in: liveVisitIds } },
          ],
        },
        stamp(now),
      )
    ).modifiedCount,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total) {
    await recordAudit({
      collectionName: 'pools',
      docId: poolId,
      action: 'bulk',
      source: 'app',
      note: `${reason}: also hid ${Object.entries(counts)
        .filter(([, n]) => n)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')}`,
    });
  }
  return counts;
}

export async function cascadeCustomerDelete(customerId: string, now: Date): Promise<void> {
  const pools = await Pool.find({ customerId, deletedAt: null }, { _id: 1 }).lean<{ _id: string }[]>();
  for (const p of pools) {
    await Pool.updateOne({ _id: p._id }, stamp(now));
    await recordAudit({ collectionName: 'pools', docId: p._id, action: 'delete', source: 'app', note: 'Customer deleted' });
    await cascadePoolDelete(p._id, now, 'Customer deleted');
  }
  const notes = await Note.updateMany({ parentType: 'customer', parentId: customerId, deletedAt: null }, stamp(now));
  if (notes.modifiedCount) {
    await recordAudit({ collectionName: 'customers', docId: customerId, action: 'bulk', source: 'app', note: `Customer deleted: also hid ${notes.modifiedCount} notes` });
  }
}
