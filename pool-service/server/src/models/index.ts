import mongoose, { Schema, type Model } from 'mongoose';
import { ISSUE_STATUSES, NOTE_PARENT_TYPES, POOL_TYPES, SERVICE_DAYS, UNITS, READING_KEYS } from '@pool/shared';

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

const addressSchema = new Schema(
  {
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
  },
  { _id: false },
);

// ---------------------------------------------------------------- customers
const customerSchema = makeSchema({
  name: { type: String, required: true },
  phones: [new Schema({ label: String, number: { type: String, required: true } }, { _id: false })],
  email: String,
  address: { type: addressSchema, required: true },
  notes: String,
});
customerSchema.index({ name: 1 });

// ---------------------------------------------------------------- pools
const poolSchema = makeSchema({
  customerId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  address: { type: addressSchema, default: undefined },
  type: { type: String, enum: POOL_TYPES, required: true },
  surface: String,
  volumeGal: { type: Number, required: true },
  serviceDay: { type: String, enum: SERVICE_DAYS, required: true },
  routeOrder: { type: Number, default: 0 },
  accessNotes: { type: String, default: '' },
  active: { type: Boolean, default: true },
  week: {
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
    /** When the checkmark last changed; a stale offline toggle loses to a later reset. */
    changedAt: { type: Date, default: null },
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
      },
      { _id: false },
    ),
  ],
  tasks: {
    brushed: { type: Boolean, default: false },
    skimmed: { type: Boolean, default: false },
    vacuumed: { type: Boolean, default: false },
    basketsEmptied: { type: Boolean, default: false },
    filterCleaned: { type: Boolean, default: false },
  },
  notes: String,
  timeLog: {
    segments: [new Schema({ start: { type: Date, required: true }, end: { type: Date, default: null } }, { _id: false })],
    finished: { type: Boolean, default: false },
  },
});
visitSchema.index({ poolId: 1, visitedAt: -1 });
// Finds running timers quickly (Route list chip, one-timer-at-a-time rule).
visitSchema.index({ 'timeLog.segments.end': 1 });

// ---------------------------------------------------------------- chemicals
const chemicalSchema = makeSchema({
  name: { type: String, required: true },
  defaultUnit: { type: String, enum: UNITS, required: true },
  active: { type: Boolean, default: true },
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
  },
  { versionKey: false },
);
auditLogSchema.index({ collectionName: 1, docId: 1, at: -1 });
auditLogSchema.index({ at: -1 });

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
export const SyncLog = model('SyncLog', syncLogSchema, 'syncLog');
export const SessionDoc = model('Session', sessionSchema, 'sessions');
export const AuditLog = model('AuditLog', auditLogSchema, 'auditLog');

/** Models exposed through `/sync/pull`, keyed by collection name. */
export const SYNC_MODELS = {
  customers: Customer,
  pools: Pool,
  visits: Visit,
  chemicals: Chemical,
  issues: Issue,
  notes: Note,
  photos: Photo,
} as const;

/** Create collections and indexes up front (transactions can't create collections implicitly on older servers). */
export async function ensureCollections(): Promise<void> {
  const models = [...Object.values(SYNC_MODELS), SyncLog, SessionDoc, AuditLog];
  for (const m of models) {
    await m.createCollection().catch((err: { codeName?: string }) => {
      if (err?.codeName !== 'NamespaceExists') throw err;
    });
    await m.syncIndexes();
  }
}
