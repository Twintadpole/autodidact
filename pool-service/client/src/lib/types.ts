/**
 * Documents as they arrive over JSON (dates are ISO strings).
 * The Zod schemas in @pool/shared are the source of truth for what the server accepts.
 */
import type { IssueStatus, ServiceDay, Unit } from '@pool/shared';

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

interface Base {
  _id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Phone {
  label: string;
  number: string;
}

export interface Customer extends Base {
  name: string;
  phones: Phone[];
  email?: string;
  address: Address;
  notes?: string;
}

export interface Pool extends Base {
  customerId: string;
  name: string;
  address?: Address;
  type: 'chlorine' | 'salt';
  surface?: string;
  volumeGal: number;
  serviceDay: ServiceDay;
  routeOrder: number;
  accessNotes: string;
  active: boolean;
  week: { done: boolean; doneAt: string | null; changedAt: string | null };
}

export interface Dose {
  chemicalId: string;
  amount: number;
  unit: Unit;
}

export interface Tasks {
  brushed: boolean;
  skimmed: boolean;
  vacuumed: boolean;
  basketsEmptied: boolean;
  filterCleaned: boolean;
}

export type Readings = Partial<Record<string, number | null>>;

export interface TimeSegment {
  start: string;
  end: string | null;
}

export interface TimeLog {
  segments: TimeSegment[];
  finished: boolean;
}

export interface Visit extends Base {
  poolId: string;
  visitedAt: string;
  readings: Readings;
  doses: Dose[];
  tasks: Tasks;
  notes?: string;
  timeLog?: TimeLog;
}

export interface Photo extends Base {
  poolId: string;
  issueId: string | null;
  savedToPool: boolean;
  width: number;
  height: number;
  bytes: number;
  takenAt: string;
  caption?: string;
}

export interface AuditEntry {
  _id: string;
  at: string;
  collectionName: string;
  docId: string;
  action: 'create' | 'update' | 'delete' | 'bulk';
  source: 'app' | 'sync' | 'system';
  changes: { path: string; from: unknown; to: unknown }[];
  note?: string;
}

export interface Chemical extends Base {
  name: string;
  defaultUnit: Unit;
  active: boolean;
}

export interface Issue extends Base {
  poolId: string;
  title: string;
  description?: string;
  urgent: boolean;
  important: boolean;
  status: IssueStatus;
  resolvedAt: string | null;
  postponedAt: string | null;
  photoIds: string[];
}

export interface Note extends Base {
  parentType: 'customer' | 'pool' | 'visit';
  parentId: string;
  body: string;
  pinned: boolean;
}
