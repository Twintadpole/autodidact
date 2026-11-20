import { db, getMeta, setMeta } from '@/offline/db';

/**
 * The phone's copy of the data belongs to one person (GPF item 3). Before someone else's
 * login is used on this device, the copy is cleared, so a tech never sees what the owner's
 * phone had cached. Unsent changes are never thrown away silently: the login screen asks.
 */
const OWNER_KEY = 'dataOwner';
const DATA_TABLES = ['customers', 'pools', 'visits', 'chemicals', 'issues', 'notes', 'photos', 'settings', 'invoices', 'ledger', 'drafts', 'photoBlobs'] as const;

/** Whose data is on this device (user id), or null if nobody's yet / from before accounts. */
export const dataOwner = () => getMeta<string>(OWNER_KEY);

/** Unsent changes on this device. */
export const unsentCount = () => db.outbox.count();

/** Empties every local table (and the outbox) and forgets the last pull: the next pull is a full one. */
export async function clearLocalData(): Promise<void> {
  const tables = DATA_TABLES.filter((t) => t in db).map((t) => (db as unknown as Record<string, import('dexie').Table>)[t]!);
  await db.transaction('rw', [...tables, db.outbox, db.meta], async () => {
    for (const t of tables) await t.clear();
    await db.outbox.clear();
    await db.meta.delete('lastPull');
    await db.meta.delete('lastPullAt');
  });
}

/**
 * After a login: must the device's copy be cleared before this person uses it? Yes if it is
 * someone else's; for a device from before accounts (no owner noted), only if a tech signs in
 * (that data is the owner's).
 */
export async function mustClearFor(userId: string, role: 'owner' | 'tech'): Promise<boolean> {
  const owner = await dataOwner();
  if (owner) return owner !== userId;
  const hasData = (await db.customers.count()) > 0 || (await db.pools.count()) > 0 || (await db.outbox.count()) > 0;
  return hasData && role !== 'owner';
}
export const setDataOwner = (userId: string) => setMeta(OWNER_KEY, userId);
