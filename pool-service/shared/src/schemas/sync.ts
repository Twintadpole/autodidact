import { z } from 'zod';
import { dateSchema, idSchema } from './common.js';
import { chemical, customer, issue, note, photo, pool, visit } from './collections.js';

/**
 * One "field package": everything entered on a pool screen, sealed when the
 * user leaves the screen and queued in the phone's outbox.
 *
 * The server applies the whole package in a single transaction and records
 * `packageId` so a retried package is never applied twice.
 */
export const syncPackageSchema = z
  .object({
    packageId: idSchema,
    poolId: idSchema,
    createdAt: dateSchema,
    visit: visit.doc.optional(),
    issues: z.array(issue.doc).default([]),
    notes: z.array(note.doc).default([]),
    /** Metadata only; the image bytes travel as multipart files named by photo `_id`. */
    photos: z.array(photo.doc).default([]),
    weekToggle: z.object({ done: z.boolean(), at: dateSchema }).optional(),
  })
  .superRefine((pkg, ctx) => {
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
    visit: number;
    issues: number;
    notes: number;
    photos: number;
    weekToggle: boolean;
  };
}
