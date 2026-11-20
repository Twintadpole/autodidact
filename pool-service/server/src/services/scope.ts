import { BUSINESS_SETTINGS_ID, redactForTech } from '@pool/shared';
import { Customer, Pool, Visit } from '../models/index.js';
import { HttpError } from '../util.js';
import { isOwner, type Actor } from './users.js';

/**
 * What a tech may see: pools assigned to them, the customers of those pools (plus customers they
 * added that have no pool yet), and the visits, issues, photos and notes of those. Owners: all.
 * Filters include soft-deleted records on purpose, so a deletion still reaches the tech's phone.
 */
export interface TechScope {
  poolIds: string[];
  customerIds: string[];
}
export async function techScope(actor: Actor): Promise<TechScope> {
  const pools = await Pool.find({ techId: actor.userId }, { _id: 1, customerId: 1 }).lean<{ _id: string; customerId: string }[]>();
  const own = await Customer.find({ createdBy: actor.userId }, { _id: 1 }).lean<{ _id: string }[]>();
  return { poolIds: pools.map((p) => p._id), customerIds: [...new Set([...pools.map((p) => p.customerId), ...own.map((c) => c._id)])] };
}

/** Mongo filter limiting `collection` to what the actor may see; {} for owners; null = none of it. */
export async function scopeFilter(collection: string, actor: Actor, scope?: TechScope): Promise<Record<string, unknown> | null> {
  if (isOwner(actor)) return {};
  const s = scope ?? (await techScope(actor));
  switch (collection) {
    case 'pools':
      return { techId: actor.userId };
    case 'customers':
      return { _id: { $in: s.customerIds } };
    case 'visits':
    case 'issues':
    case 'photos':
      return { poolId: { $in: s.poolIds } };
    case 'notes': {
      const visitIds = (await Visit.find({ poolId: { $in: s.poolIds } }, { _id: 1 }).lean<{ _id: string }[]>()).map((v) => v._id);
      return {
        $or: [
          { parentType: 'pool', parentId: { $in: s.poolIds } },
          { parentType: 'customer', parentId: { $in: s.customerIds } },
          { parentType: 'visit', parentId: { $in: visitIds } },
        ],
      };
    }
    case 'chemicals':
      return {};
    case 'settings':
      return { _id: BUSINESS_SETTINGS_ID };
    default:
      return null;
  }
}

/** The record as this actor may see it (owners: unchanged). */
export function redact<T extends Record<string, any>>(collection: string, doc: T, actor: Actor): T | null {
  return isOwner(actor) ? doc : (redactForTech(collection, doc) as T | null);
}

export async function canSeePool(actor: Actor, poolId: string): Promise<boolean> {
  return isOwner(actor) || !!(await Pool.exists({ _id: poolId, techId: actor.userId }));
}
export async function assertPool(actor: Actor, poolId: string): Promise<void> {
  if (!(await canSeePool(actor, poolId))) throw new HttpError(404, 'No such pool');
}
export function assertOwner(actor: Actor | undefined): void {
  if (!isOwner(actor)) throw new HttpError(403, 'Only an owner can do that');
}
