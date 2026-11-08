import { z } from 'zod';
import { dateSchema, idSchema } from './common.js';
import { chemical, customer, issue, note, photo, pool, visit } from './collections.js';

/**
 * One "package": a batch of changes made on the phone, queued in its outbox and
 * sent when there is signal. Usually everything entered on one pool screen, but
 * also customer/pool/chemical edits and an offline Reset week.
 *
 * The server applies the whole package in a single transaction and records
 * `packageId`, so a retried package is never applied twice. Each document is
 * last-write-wins on `updatedAt`.
 */
export const syncPackageSchema = z
  .object({
    packageId: idSchema,
    /** Required when the package carries a visit, issues, photos or a weekToggle. */
    poolId: idSchema.optional(),
    createdAt: dateSchema,
    customers: z.array(customer.doc).default([]),
    pools: z.array(pool.doc).default([]),
    chemicals: z.array(chemical.doc).default([]),
    visit: visit.doc.optional(),
    issues: z.array(issue.doc).default([]),
    notes: z.array(note.doc).default([]),
    /** Metadata only; the image bytes travel as multipart files named by photo `_id`. */
    photos: z.array(photo.doc).default([]),
    weekToggle: z.object({ done: z.boolean(), at: dateSchema }).optional(),
    /** Reset week pressed offline: clears checkmarks set before `at`. */
    resetWeek: z.object({ at: dateSchema }).optional(),
  })
  .superRefine((pkg, ctx) => {
    const poolScoped = !!pkg.visit || pkg.issues.length > 0 || pkg.photos.length > 0 || !!pkg.weekToggle;
    if (poolScoped && !pkg.poolId) {
      ctx.addIssue({ code: 'custom', path: ['poolId'], message: 'poolId is required with a visit, issues, photos or weekToggle' });
      return;
    }
    if (pkg.visit && pkg.visit.poolId !== pkg.poolId) {
      ctx.addIssue({ code: 'custom', path: ['visit', 'poolId'], message: 'visit.poolId must match package poolId' });
    }
    pkg.issues.forEach((i, idx) => {
      if (i.poolId !== pkg.poolId) {
        ctx.addIssue({ code: 'custom', path: ['issues', idx, 'poolId'], message: 'issue.poolId must match package poolId' });
      }
    });
    pkg.photos.forEach((p, idx) => {
      if (p.poolId !== pkg.poolId) {
        ctx.addIssue({ code: 'custom', path: ['photos', idx, 'poolId'], message: 'photo.poolId must match package poolId' });
      }
    });
  });

export type SyncPackage = z.infer<typeof syncPackageSchema>;
export type SyncPackageInput = z.input<typeof syncPackageSchema>;

export const syncPullQuerySchema = z.object({
  since: dateSchema.optional(),
});

export const SYNC_COLLECTIONS = ['customers', 'pools', 'visits', 'chemicals', 'issues', 'notes', 'photos'] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export interface SyncPullResponse {
  serverTime: string;
  customers: z.infer<typeof customer.doc>[];
  pools: z.infer<typeof pool.doc>[];
  visits: z.infer<typeof visit.doc>[];
  chemicals: z.infer<typeof chemical.doc>[];
  issues: z.infer<typeof issue.doc>[];
  notes: z.infer<typeof note.doc>[];
  photos: z.infer<typeof photo.doc>[];
}

export interface SyncPackageResponse {
  packageId: string;
  duplicate: boolean;
  applied: {
    customers: number;
    pools: number;
    chemicals: number;
    visit: number;
    issues: number;
    notes: number;
    photos: number;
    weekToggle: boolean;
    resetWeek: number;
  };
}
