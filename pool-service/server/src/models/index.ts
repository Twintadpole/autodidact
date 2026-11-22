import mongoose, { Schema, type Model } from 'mongoose';
import { ROLES, BILLING_TIMINGS, CUSTOMER_STATUSES, EQUIPMENT_KINDS, INVOICE_STATUSES, INVOICE_TERMS, ISSUE_STATUSES, LEDGER_KINDS, NOTE_PARENT_TYPES, PAYMENT_METHODS, POOL_TYPES, SERVICE_DAYS, UNITS, READING_KEYS } from '@pool/shared';

/**
 * Every document:
 *  - `_id`: UUID string generated on the phone (or by the server for online edits)
 *  - `createdAt` / `updatedAt`: set by whoever made the change (the phone's clock
 *    for synced records); `updatedAt` drives last-write-wins.
 *  - `deletedAt`: soft delete, so deletions sync down to the phone.
 *  - `syncedAt`: server clock time of the last write. `/sync/pull` filters on
 *    this, so a phone with a slow clock never misses changes.
 *
 * Mongoose's automatic `timestamps` are deliberately off.
 */
const baseFields = {
  _id: { type: String, required: true },
  createdAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true },
  deletedAt: { type: Date, default: null },
  syncedAt: { type: Date, required: true },
} as const;

const schemaOptions = { versionKey: false, strict: true, timestamps: false } as const;

function makeSchema(fields: Record<string, unknown>) {
  const schema = new Schema({ ...baseFields, ...fields }, schemaOptions);
  schema.index({ syncedAt: 1 });
  return schema;
}

/** Every part optional (Phase 7: no forced fields). */
const addressSchema = new Schema({ line1: String, line2: String, city: String, state: String, zip: String }, { _id: false });

// ---------------------------------------------------------------- customers
const customerSchema = makeSchema({
  name: { type: String, required: true },
  phones: [new Schema({ label: String, number: { type: String, required: true } }, { _id: false })],
  email: String,
  address: { type: addressSchema, default: undefined },
  notes: String,
  // Phase 7. No defaults: a missing status means "current", and a sender that leaves these out keeps them.
  status: { type: String, enum: [...CUSTOMER_STATUSES, null] },
  monthlyRate: Number,
  billingEmail: String,
  paymentMethod: { type: String, enum: [...PAYMENT_METHODS, null] },
  startDate: Date,
  endDate: Date,
  distanceMiles: Number,
  /** User who added it (GPF item 3). */
  createdBy: String,
});
customerSchema.index({ name: 1 });

// ---------------------------------------------------------------- pools
const poolSchema = makeSchema({
  customerId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  address: { type: addressSchema, default: undefined },
  type: { type: String, enum: [...POOL_TYPES, null] },
  surface: String,
  volumeGal: Number,
  serviceDay: { type: String, enum: [...SERVICE_DAYS, null] },
  /** A one-time job instead of a weekly day (Phase 7B). */
  oneTimeDate: Date,
  routeOrder: { type: Number, default: 0 },
  accessNotes: { type: String, default: '' },
  active: { type: Boolean, default: true },
  /** The tech whose route it is (GPF item 3); null = nobody's (the owner's). */
  techId: { type: String, default: null, index: true },
  week: {
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
    /** When the checkmark last changed; a stale offline toggle loses to a later reset. */
    changedAt: { type: Date, default: null },
  },
  equipment: {
    type: [
      new Schema(
        {
          _id: { type: String, required: true },
          kind: { type: String, enum: EQUIPMENT_KINDS, required: true },
          name: String,
          model: String,
          serial: String,
          installedOn: Date,
          notes: String,
        },
        { _id: false },
      ),
    ],
    // No default: an older app that leaves it out keeps the stored list (see upsertLww preserve).
    default: undefined,
  },
});
poolSchema.index({ serviceDay: 1, routeOrder: 1 });

// ---------------------------------------------------------------- visits
const readingsSchema = new Schema(
  Object.fromEntries(READING_KEYS.map((k) => [k, { type: Number, default: undefined }])),
  { _id: false },
);

const visitSchema = makeSchema({
  poolId: { type: String, required: true },
  visitedAt: { type: Date, required: true },
  readings: { type: readingsSchema, default: {} },
  doses: [
    new Schema(
      {
        chemicalId: { type: String, required: true },
        amount: { type: Number, required: true },
        unit: { type: String, enum: UNITS, required: true },
        /** Owner-only cost when saved (Phase 7B). */
        cost: Number,
      },
      { _id: false },
    ),
  ],
  tasks: {
    brushed: { type: Boolean, default: false },
    skimmed: { type: Boolean, default: false },
    vacuumed: { type: Boolean, default: false },
    skimmerBaskets: { type: Boolean, default: false },
    pumpBasket: { type: Boolean, default: false },
    filterCleaned: { type: Boolean, default: false },
    /** Old combined task, kept for older visits. */
    basketsEmptied: { type: Boolean, default: false },
  },
  notes: String,
  timeLog: {
    segments: [new Schema({ start: { type: Date, required: true }, end: { type: Date, default: null } }, { _id: false })],
    finished: { type: Boolean, default: false },
  },
  // Phase 7B: written for the customer's recap; when one was sent.
  customerNote: String,
  recapSentAt: Date,
});
visitSchema.index({ poolId: 1, visitedAt: -1 });
// Finds running timers quickly (Route list chip, one-timer-at-a-time rule).
visitSchema.index({ 'timeLog.segments.end': 1 });

// ---------------------------------------------------------------- chemicals
const chemicalSchema = makeSchema({
  name: { type: String, required: true },
  defaultUnit: { type: String, enum: UNITS, required: true },
  active: { type: Boolean, default: true },
  // Phase 7B, owner-only.
  price: Number,
  priceUnit: { type: String, enum: [...UNITS, null] },
});

// ---------------------------------------------------------------- business settings (one record, Phase 7B)
const settingsSchema = makeSchema({
  businessName: String,
  address: { type: addressSchema, default: undefined },
  phone: String,
  email: String,
  logoDataUrl: String,
  paymentInstructions: String,
  terms: { type: String, enum: [...INVOICE_TERMS, null] },
  billingTiming: { type: String, enum: [...BILLING_TIMINGS, null] },
  firstInvoiceNumber: Number,
  mileageRate: Number,
  /** Desktop dashboard layout (the dashboard record only); checked by the shared Zod schema. */
  dashboard: { type: Schema.Types.Mixed, default: undefined },
});

// ---------------------------------------------------------------- ledger: expenses, other income, mileage (Phase 7C)
const ledgerSchema = makeSchema({
  kind: { type: String, enum: LEDGER_KINDS, required: true },
  date: { type: String, required: true, index: true },
  amount: Number,
  category: String,
  vendor: String,
  note: String,
  customerId: { type: String, index: true },
  receiptDataUrl: String,
  billToCustomer: Boolean,
  billedAmount: Number,
  invoiceId: String,
  invoiceLineId: String,
  miles: Number,
  odometerStart: Number,
  odometerEnd: Number,
});

// ---------------------------------------------------------------- invoices (Phase 7B)
const invoiceSchema = makeSchema({
  customerId: { type: String, required: true, index: true },
  // Not unique: two offline devices could pick the same number; the app warns instead of failing a sync.
  number: { type: Number, required: true, index: true },
  period: String,
  issueDate: { type: Date, required: true },
  dueDate: Date,
  lines: [new Schema({ _id: { type: String, required: true }, description: { type: String, default: '' }, amount: { type: Number, required: true } }, { _id: false })],
  notes: String,
  status: { type: String, enum: INVOICE_STATUSES, default: 'draft' },
  sentAt: Date,
  payments: [
    new Schema(
      {
        _id: { type: String, required: true },
        date: { type: Date, required: true },
        amount: { type: Number, required: true },
        method: { type: String, enum: [...PAYMENT_METHODS, null] },
        reference: String,
      },
      { _id: false },
    ),
  ],
});

// ---------------------------------------------------------------- issues
const issueSchema = makeSchema({
  poolId: { type: String, required: true },
  title: { type: String, required: true },
  description: String,
  urgent: { type: Boolean, default: false },
  important: { type: Boolean, default: false },
  status: { type: String, enum: ISSUE_STATUSES, default: 'open' },
  resolvedAt: { type: Date, default: null },
  postponedAt: { type: Date, default: null },
  photoIds: { type: [String], default: [] },
});
issueSchema.index({ poolId: 1, status: 1 });

// ---------------------------------------------------------------- notes
const noteSchema = makeSchema({
  parentType: { type: String, enum: NOTE_PARENT_TYPES, required: true },
  parentId: { type: String, required: true },
  body: { type: String, required: true },
  pinned: { type: Boolean, default: false },
});
noteSchema.index({ parentType: 1, parentId: 1 });

// ---------------------------------------------------------------- photos
const photoSchema = makeSchema({
  poolId: { type: String, required: true },
  issueId: { type: String, default: null },
  /** A photo of one piece of the pool's equipment (Phase 7). */
  equipmentId: { type: String, default: null },
  savedToPool: { type: Boolean, default: false },
  /** Path relative to PHOTO_DIR, e.g. "2026/10/<id>.jpg". */
  file: { type: String, required: true },
  width: Number,
  height: Number,
  bytes: Number,
  takenAt: { type: Date, required: true },
  caption: String,
});
photoSchema.index({ poolId: 1, savedToPool: 1 });

// ---------------------------------------------------------------- sync log
/** One row per applied package; the `_id` is the packageId (idempotency key). */
const syncLogSchema = new Schema(
  {
    _id: { type: String, required: true },
    poolId: String,
    appliedAt: { type: Date, required: true },
    summary: Schema.Types.Mixed,
  },
  { versionKey: false },
);

// ---------------------------------------------------------------- audit log
/**
 * Append-only record of every change: who changed what, when, from what to what.
 * Never updated or deleted by the app.
 */
const auditLogSchema = new Schema(
  {
    _id: { type: String, required: true },
    at: { type: Date, required: true },
    collectionName: { type: String, required: true },
    docId: { type: String, required: true },
    action: { type: String, enum: ['create', 'update', 'delete', 'bulk'], required: true },
    /** 'app' = online edit through the API, 'sync' = a field package from the phone. */
    source: { type: String, enum: ['app', 'sync', 'system'], required: true },
    changes: [new Schema({ path: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed }, { _id: false })],
    note: String,
    /** Who made the change (GPF item 3); missing on older entries and system jobs. */
    userId: String,
  },
  { versionKey: false },
);
auditLogSchema.index({ collectionName: 1, docId: 1, at: -1 });
auditLogSchema.index({ at: -1 });

// ---------------------------------------------------------------- imports
/**
 * One customer & pool import: what it added and what it changed (old and new values), so it can
 * be undone. Not synced to phones.
 */
const importLogSchema = new Schema(
  {
    _id: { type: String, required: true },
    at: { type: Date, required: true },
    fileName: { type: String, default: '' },
    summary: Schema.Types.Mixed,
    created: [new Schema({ kind: String, docId: String }, { _id: false })],
    updated: [new Schema({ kind: String, docId: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed }, { _id: false, minimize: false })],
    undoneAt: { type: Date, default: null },
    undo: Schema.Types.Mixed,
  },
  { versionKey: false },
);
importLogSchema.index({ at: -1 });

// ---------------------------------------------------------------- users
/** Logins (GPF item 3). Not synced; phones get names only (the "team" in each pull). */
const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    passwordHash: { type: String, required: true },
    active: { type: Boolean, default: true },
    /** Set by an owner's password reset: the app asks for a new password. */
    mustChangePassword: { type: Boolean, default: false },
    /** The app's language (GPF item 5); null = the device's. */
    language: { type: String, default: null },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    /** "2026-11": months with any activity (a tech counts toward billing in those months). */
    activeMonths: { type: [String], default: [] },
    /** When this user's set of visible pools last changed: their next pull is a full one. */
    accessChangedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
);

// ---------------------------------------------------------------- beta feedback and app errors
/** "Send feedback" (beta): what a user wrote, from which screen and app version. Not synced. */
const feedbackSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    userName: String,
    role: String,
    kind: { type: String, enum: ['problem', 'idea', 'question', 'other'], default: 'other' },
    text: { type: String, required: true },
    screen: String,
    appVersion: String,
    language: String,
    userAgent: String,
    createdAt: { type: Date, required: true },
    /** The owner marked it done on the Feedback screen. */
    doneAt: { type: Date, default: null },
  },
  { versionKey: false },
);
feedbackSchema.index({ createdAt: -1 });

/**
 * Problems the app ran into on a phone (errors, photos that wouldn't load), one record per kind of
 * problem per app version, counted. Kept 60 days after it was last seen. Not synced.
 */
const clientErrorSchema = new Schema(
  {
    _id: { type: String, required: true },
    where: String,
    message: String,
    stack: String,
    screen: String,
    appVersion: String,
    userId: String,
    userAgent: String,
    count: { type: Number, default: 1 },
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
  },
  { versionKey: false },
);
clientErrorSchema.index({ lastAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600 });

// ---------------------------------------------------------------- email (password reset)
/**
 * Emails waiting to go out. The app never sends mail itself (a business's app has no internet): the
 * server's sender (deploy/mail.sh, tenant.sh mail) picks these up every minute, adds From and sends
 * them through the configured mailbox. `raw` is the message without From. Kept 14 days.
 */
const mailOutboxSchema = new Schema(
  {
    _id: { type: String, required: true },
    to: { type: [String], required: true },
    subject: String,
    raw: { type: String, required: true },
    kind: String,
    createdAt: { type: Date, required: true },
    sentAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null },
  },
  { versionKey: false },
);
mailOutboxSchema.index({ sentAt: 1, createdAt: 1 });
mailOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });

/** "Forgot password" links: only a hash of the token is stored; one use; gone after 30 minutes. */
const passwordResetSchema = new Schema(
  {
    _id: { type: String, required: true }, // sha256 of the token
    userId: { type: String, required: true, index: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { versionKey: false },
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 });

// ---------------------------------------------------------------- sessions
const sessionSchema = new Schema(
  {
    _id: { type: String, required: true },
    session: { type: Schema.Types.Mixed, required: true },
    generation: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ 'session.userId': 1 });

function model(name: string, schema: Schema, collection: string): Model<any> {
  return (mongoose.models[name] as Model<any>) ?? mongoose.model(name, schema, collection);
}

export const Customer = model('Customer', customerSchema, 'customers');
export const Pool = model('Pool', poolSchema, 'pools');
export const Visit = model('Visit', visitSchema, 'visits');
export const Chemical = model('Chemical', chemicalSchema, 'chemicals');
export const Issue = model('Issue', issueSchema, 'issues');
export const Note = model('Note', noteSchema, 'notes');
export const Photo = model('Photo', photoSchema, 'photos');
export const Settings = model('Settings', settingsSchema, 'settings');
export const Invoice = model('Invoice', invoiceSchema, 'invoices');
export const Ledger = model('Ledger', ledgerSchema, 'ledger');
export const SyncLog = model('SyncLog', syncLogSchema, 'syncLog');
export const SessionDoc = model('Session', sessionSchema, 'sessions');
export const AuditLog = model('AuditLog', auditLogSchema, 'auditLog');
export const ImportLog = model('ImportLog', importLogSchema, 'imports');
export const User = model('User', userSchema, 'users');
export const Feedback = model('Feedback', feedbackSchema, 'feedback');
export const ClientError = model('ClientError', clientErrorSchema, 'clientErrors');
export const MailOutbox = model('MailOutbox', mailOutboxSchema, 'mailOutbox');
export const PasswordReset = model('PasswordReset', passwordResetSchema, 'passwordResets');

/** Models exposed through `/sync/pull`, keyed by collection name. */
export const SYNC_MODELS = {
  customers: Customer,
  pools: Pool,
  visits: Visit,
  chemicals: Chemical,
  issues: Issue,
  notes: Note,
  photos: Photo,
  settings: Settings,
  invoices: Invoice,
  ledger: Ledger,
} as const;

/** Create collections and indexes up front (transactions can't create collections implicitly on older servers). */
export async function ensureCollections(): Promise<void> {
  const models = [...Object.values(SYNC_MODELS), SyncLog, SessionDoc, AuditLog, ImportLog, User];
  for (const m of models) {
    await m.createCollection().catch((err: { codeName?: string }) => {
      if (err?.codeName !== 'NamespaceExists') throw err;
    });
    await m.syncIndexes();
  }
}
