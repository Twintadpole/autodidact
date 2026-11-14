import { z } from 'zod';
import { READING_KEYS } from '../readings.js';
import { addressSchema, collectionSchemas, dateSchema, e164Schema, idSchema, SERVICE_DAYS, UNITS } from './common.js';

// ---------------------------------------------------------------- customers
export const phoneSchema = z.object({
  label: z.string().trim().default('mobile'),
  number: e164Schema,
});

export const customer = collectionSchemas({
  name: z.string().trim().min(1),
  phones: z.array(phoneSchema).default([]),
  email: z.email().optional(),
  address: addressSchema,
  notes: z.string().optional(),
});
export type Customer = z.infer<typeof customer.doc>;

// ---------------------------------------------------------------- pools
export const POOL_TYPES = ['chlorine', 'salt'] as const;

export const weekSchema = z.object({
  done: z.boolean().default(false),
  doneAt: dateSchema.nullable().default(null),
  /** When the checkmark last changed (toggle or reset week). */
  changedAt: dateSchema.nullable().default(null),
});

export const pool = collectionSchemas({
  customerId: idSchema,
  name: z.string().trim().min(1).default('Pool'),
  /** Overrides the customer's address when present. */
  address: addressSchema.optional(),
  type: z.enum(POOL_TYPES),
  surface: z.string().optional(),
  volumeGal: z.number().positive(),
  serviceDay: z.enum(SERVICE_DAYS),
  routeOrder: z.number().default(0),
  accessNotes: z.string().default(''),
  active: z.boolean().default(true),
  week: weekSchema.default({ done: false, doneAt: null, changedAt: null }),
});
export type Pool = z.infer<typeof pool.doc>;

// ---------------------------------------------------------------- visits
const readingShape = Object.fromEntries(READING_KEYS.map((k) => [k, z.number().nullable().optional()])) as Record<
  (typeof READING_KEYS)[number],
  z.ZodOptional<z.ZodNullable<z.ZodNumber>>
>;
export const readingsSchema = z.object(readingShape);
export type Readings = z.infer<typeof readingsSchema>;

export const doseSchema = z.object({
  chemicalId: idSchema,
  amount: z.number().positive(),
  unit: z.enum(UNITS),
});
export type Dose = z.infer<typeof doseSchema>;

/** `basketsEmptied` is the old combined task: kept so older visits still show it; new visits use the two basket tasks. */
export const TASK_KEYS = ['brushed', 'skimmed', 'vacuumed', 'skimmerBaskets', 'pumpBasket', 'filterCleaned', 'basketsEmptied'] as const;
export const tasksSchema = z.object({
  brushed: z.boolean().default(false),
  skimmed: z.boolean().default(false),
  vacuumed: z.boolean().default(false),
  skimmerBaskets: z.boolean().default(false),
  pumpBasket: z.boolean().default(false),
  filterCleaned: z.boolean().default(false),
  basketsEmptied: z.boolean().default(false),
});
export const EMPTY_TASKS = Object.fromEntries(TASK_KEYS.map((k) => [k, false])) as Record<(typeof TASK_KEYS)[number], boolean>;

/**
 * Time on site. Each Start/Resume opens a segment and each Pause/Stop closes it,
 * so pauses are the gaps between segments. `finished` is set by Stop.
 * At most one segment may be open (end = null), and it must be the last one.
 */
export const timeSegmentSchema = z.object({
  start: dateSchema,
  end: dateSchema.nullable().default(null),
});
export const timeLogSchema = z
  .object({
    segments: z.array(timeSegmentSchema).default([]),
    finished: z.boolean().default(false),
  })
  .superRefine((log, ctx) => {
    log.segments.forEach((s, i) => {
      if (s.end && s.end < s.start) {
        ctx.addIssue({ code: 'custom', path: ['segments', i, 'end'], message: 'End must be after start' });
      }
      if (!s.end && i !== log.segments.length - 1) {
        ctx.addIssue({ code: 'custom', path: ['segments', i, 'end'], message: 'Only the last segment can be running' });
      }
      const prev = log.segments[i - 1];
      if (prev?.end && s.start < prev.end) {
        ctx.addIssue({ code: 'custom', path: ['segments', i, 'start'], message: 'Segments overlap' });
      }
    });
    if (log.finished && log.segments.some((s) => !s.end)) {
      ctx.addIssue({ code: 'custom', path: ['finished'], message: 'A stopped timer cannot have a running segment' });
    }
  });
export type TimeLog = z.infer<typeof timeLogSchema>;

/** Seconds on site; a running segment counts up to `now`. */
export function timeLogSeconds(
  log: { segments: { start: Date | string; end: Date | string | null }[] } | undefined | null,
  now: Date = new Date(),
): number {
  if (!log) return 0;
  let ms = 0;
  for (const s of log.segments) {
    const start = new Date(s.start).getTime();
    const end = s.end ? new Date(s.end).getTime() : now.getTime();
    if (end > start) ms += end - start;
  }
  return Math.round(ms / 1000);
}

export function timeLogState(log: { segments: { end: unknown }[]; finished: boolean } | undefined | null): 'idle' | 'running' | 'paused' | 'stopped' {
  if (!log || !log.segments.length) return 'idle';
  if (log.finished) return 'stopped';
  return log.segments[log.segments.length - 1]!.end ? 'paused' : 'running';
}

export const visit = collectionSchemas({
  poolId: idSchema,
  visitedAt: dateSchema,
  readings: readingsSchema.default({}),
  doses: z.array(doseSchema).default([]),
  tasks: tasksSchema.default({ ...EMPTY_TASKS }),
  notes: z.string().optional(),
  timeLog: timeLogSchema.default({ segments: [], finished: false }),
});
export type Visit = z.infer<typeof visit.doc>;

// ---------------------------------------------------------------- chemicals
export const chemical = collectionSchemas({
  name: z.string().trim().min(1),
  defaultUnit: z.enum(UNITS),
  active: z.boolean().default(true),
});
export type Chemical = z.infer<typeof chemical.doc>;

// ---------------------------------------------------------------- issues
/** `resolved` is shown as "Completed" in the UI; `postponed` parks an issue. */
export const ISSUE_STATUSES = ['open', 'in_progress', 'postponed', 'resolved'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const issue = collectionSchemas({
  poolId: idSchema,
  title: z.string().trim().min(1),
  description: z.string().optional(),
  urgent: z.boolean().default(false),
  important: z.boolean().default(false),
  status: z.enum(ISSUE_STATUSES).default('open'),
  resolvedAt: dateSchema.nullable().default(null),
  postponedAt: dateSchema.nullable().default(null),
  photoIds: z.array(idSchema).default([]),
});
export type Issue = z.infer<typeof issue.doc>;

/**
 * Status transition rules, used by both the phone and the server:
 *  - resolved (Completed) stamps `resolvedAt`
 *  - postponed stamps `postponedAt`
 *  - open / in_progress (reopen) clears both
 * Only stamps when the status actually changes, so re-saving keeps the original time.
 */
export function applyIssueStatus<T extends { status?: IssueStatus; resolvedAt?: Date | null; postponedAt?: Date | null }>(
  next: T,
  previousStatus: IssueStatus | undefined,
  now: Date = new Date(),
): T {
  if (!next.status || next.status === previousStatus) return next;
  const out = { ...next };
  out.resolvedAt = next.status === 'resolved' ? (next.resolvedAt ?? now) : null;
  out.postponedAt = next.status === 'postponed' ? (next.postponedAt ?? now) : null;
  return out;
}

// ---------------------------------------------------------------- notes
export const NOTE_PARENT_TYPES = ['customer', 'pool', 'visit'] as const;

export const note = collectionSchemas({
  parentType: z.enum(NOTE_PARENT_TYPES),
  parentId: idSchema,
  body: z.string().trim().min(1),
  pinned: z.boolean().default(false),
});
export type Note = z.infer<typeof note.doc>;

// ---------------------------------------------------------------- photos
/** Photo metadata as sent by the phone. `file` (path on disk) is server-only. */
export const photo = collectionSchemas({
  poolId: idSchema,
  issueId: idSchema.nullable().default(null),
  savedToPool: z.boolean().default(false),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  takenAt: dateSchema,
  caption: z.string().optional(),
});
export type Photo = z.infer<typeof photo.doc> & { file?: string };
