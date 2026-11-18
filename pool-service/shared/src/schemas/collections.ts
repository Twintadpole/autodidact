import { z } from 'zod';
import { READING_KEYS } from '../readings.js';
import { addressSchema, collectionSchemas, dateSchema, e164Schema, idSchema, SERVICE_DAYS, UNITS } from './common.js';

// ---------------------------------------------------------------- customers
export const phoneSchema = z.object({
  label: z.string().trim().default('mobile'),
  number: e164Schema,
});

export const CUSTOMER_STATUSES = ['current', 'prospect', 'past'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const PAYMENT_METHODS = ['check', 'cash', 'electronic', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Missing status means "current" (customers made before Phase 7). */
export function customerStatus(c: { status?: CustomerStatus | null }): CustomerStatus {
  return c.status ?? 'current';
}

/**
 * Only the name is required. Phase 7 fields are optional and nullable: the app sends null
 * when one is cleared, and the server keeps them when a sender leaves them out (an older
 * app version), so they have no defaults here.
 */
export const customer = collectionSchemas({
  name: z.string().trim().min(1),
  phones: z.array(phoneSchema).default([]),
  email: z.email().optional(),
  address: addressSchema.optional(),
  notes: z.string().optional(),
  status: z.enum(CUSTOMER_STATUSES).nullable().optional(),
  /** Flat monthly rate in dollars (chemicals included). */
  monthlyRate: z.number().nonnegative().nullable().optional(),
  /** Where invoices go; the main email when empty. */
  billingEmail: z.email().nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable().optional(),
  startDate: dateSchema.nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  /** Miles from HQ, one way (for mileage). */
  distanceMiles: z.number().nonnegative().nullable().optional(),
});
/** Customer fields the server keeps when a sender leaves them out. */
export const CUSTOMER_PRESERVED_FIELDS = ['status', 'monthlyRate', 'billingEmail', 'paymentMethod', 'startDate', 'endDate', 'distanceMiles'] as const;
export type Customer = z.infer<typeof customer.doc>;

// ---------------------------------------------------------------- pools
export const POOL_TYPES = ['chlorine', 'salt'] as const;

export const weekSchema = z.object({
  done: z.boolean().default(false),
  doneAt: dateSchema.nullable().default(null),
  /** When the checkmark last changed (toggle or reset week). */
  changedAt: dateSchema.nullable().default(null),
});

export const EQUIPMENT_KINDS = ['pump', 'filter', 'heater', 'saltCell', 'cleaner', 'automation', 'lights', 'timer', 'other'] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

/** One piece of pool equipment. Photos point at it with `equipmentId`. */
export const equipmentSchema = z.object({
  _id: idSchema,
  kind: z.enum(EQUIPMENT_KINDS),
  /** Own name, e.g. "Booster pump" (needed only for "other"). */
  name: z.string().trim().optional(),
  model: z.string().trim().optional(),
  serial: z.string().trim().optional(),
  installedOn: dateSchema.nullable().optional(),
  notes: z.string().optional(),
});
export type Equipment = z.infer<typeof equipmentSchema>;

export const pool = collectionSchemas({
  customerId: idSchema,
  name: z.string().trim().min(1).default('Pool'),
  /** Overrides the customer's address when present. */
  address: addressSchema.optional(),
  type: z.enum(POOL_TYPES).nullable().optional(),
  surface: z.string().optional(),
  volumeGal: z.number().positive().nullable().optional(),
  /** Weekly service day. No day and no one-time date: "Not scheduled" on the Route. */
  serviceDay: z.enum(SERVICE_DAYS).nullable().optional(),
  /** A one-time job instead of a weekly day (see routeSlot). */
  oneTimeDate: dateSchema.nullable().optional(),
  routeOrder: z.number().default(0),
  accessNotes: z.string().default(''),
  active: z.boolean().default(true),
  week: weekSchema.default({ done: false, doneAt: null, changedAt: null }),
  /** No default: an older app that leaves it out must not wipe it (see POOL_PRESERVED_FIELDS). */
  equipment: z.array(equipmentSchema).optional(),
});
export type Pool = z.infer<typeof pool.doc>;
export const POOL_PRESERVED_FIELDS = ['equipment', 'oneTimeDate'] as const;

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
  /** Owner-only: what this dose cost (USD) when the visit was saved. Never on invoices or recaps. */
  cost: z.number().nonnegative().nullable().optional(),
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
  /** Written for the customer (visit recap); `notes` stay private. */
  customerNote: z.string().optional(),
  /** When a recap of this visit was last sent. */
  recapSentAt: dateSchema.nullable().optional(),
});
export type Visit = z.infer<typeof visit.doc>;
export const VISIT_PRESERVED_FIELDS = ['customerNote', 'recapSentAt'] as const;

// ---------------------------------------------------------------- chemicals
export const chemical = collectionSchemas({
  name: z.string().trim().min(1),
  defaultUnit: z.enum(UNITS),
  active: z.boolean().default(true),
  /** Owner-only price, e.g. 4.5 per gal. */
  price: z.number().nonnegative().nullable().optional(),
  priceUnit: z.enum(UNITS).nullable().optional(),
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
  /** A photo of one piece of the pool's equipment. */
  equipmentId: idSchema.nullable().optional(),
  savedToPool: z.boolean().default(false),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  takenAt: dateSchema,
  caption: z.string().optional(),
});
export type Photo = z.infer<typeof photo.doc> & { file?: string };

// ---------------------------------------------------------------- business settings (one record)
/** The single business-settings record's ID. */
export const BUSINESS_SETTINGS_ID = '00000000-0000-4000-8000-000000000001';
export const INVOICE_TERMS = ['receipt', 'net15', 'net30'] as const;
export type InvoiceTerms = (typeof INVOICE_TERMS)[number];
export const BILLING_TIMINGS = ['start', 'end'] as const;
export type BillingTiming = (typeof BILLING_TIMINGS)[number];

/** Everything optional. Missing terms = due on receipt; timing = start of month; first number = 1001. */
export const settings = collectionSchemas({
  businessName: z.string().trim().optional(),
  address: addressSchema.optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  /** Small logo image as a data: URL (shown on invoices). */
  logoDataUrl: z.string().max(600_000).optional(),
  /** Printed on every invoice, e.g. "Checks payable to … · Zelle: …". */
  paymentInstructions: z.string().optional(),
  terms: z.enum(INVOICE_TERMS).nullable().optional(),
  billingTiming: z.enum(BILLING_TIMINGS).nullable().optional(),
  firstInvoiceNumber: z.number().int().positive().nullable().optional(),
});
export type Settings = z.infer<typeof settings.doc>;

// ---------------------------------------------------------------- invoices
export const INVOICE_STATUSES = ['draft', 'sent', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoiceLineSchema = z.object({
  _id: idSchema,
  description: z.string().trim().default(''),
  /** Dollars; negative for a discount. */
  amount: z.number(),
});
export const paymentSchema = z.object({
  _id: idSchema,
  date: dateSchema,
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHODS).nullable().optional(),
  /** Check number or transfer reference. */
  reference: z.string().trim().optional(),
});

/** Payments live on their invoice. Paid and overdue are worked out (see invoiceState). */
export const invoice = collectionSchemas({
  customerId: idSchema,
  number: z.number().int().positive(),
  /** Month billed, "2026-11". */
  period: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
  issueDate: dateSchema,
  dueDate: dateSchema.nullable().optional(),
  lines: z.array(invoiceLineSchema).default([]),
  /** Printed on the invoice for the customer. */
  notes: z.string().optional(),
  status: z.enum(INVOICE_STATUSES).default('draft'),
  sentAt: dateSchema.nullable().optional(),
  payments: z.array(paymentSchema).default([]),
});
export type Invoice = z.infer<typeof invoice.doc>;

const cents = (n: number) => Math.round(n * 100);
type InvoiceLike = { lines: { amount: number }[]; payments: { amount: number }[]; status: InvoiceStatus; dueDate?: Date | string | null };
export const invoiceTotal = (i: InvoiceLike) => i.lines.reduce((s, l) => s + cents(l.amount), 0) / 100;
export const invoicePaid = (i: InvoiceLike) => i.payments.reduce((s, p) => s + cents(p.amount), 0) / 100;
export const invoiceBalance = (i: InvoiceLike) => (cents(invoiceTotal(i)) - cents(invoicePaid(i))) / 100;

/** What the owner sees: draft, sent, paid, overdue or void. */
export function invoiceState(i: InvoiceLike, now: Date = new Date()): 'draft' | 'sent' | 'paid' | 'overdue' | 'void' {
  if (i.status === 'void') return 'void';
  if (invoiceBalance(i) <= 0 && (i.status === 'sent' || i.payments.length)) return 'paid';
  if (i.status === 'draft') return 'draft';
  if (i.dueDate) {
    const due = new Date(new Date(i.dueDate).toISOString().slice(0, 10) + 'T23:59:59');
    if (due < now) return 'overdue';
  }
  return 'sent';
}

export const CHEMICAL_PRESERVED_FIELDS = ['price', 'priceUnit'] as const;
