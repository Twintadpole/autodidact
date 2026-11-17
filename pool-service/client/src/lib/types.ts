/**
 * Documents as they arrive over JSON (dates are ISO strings).
 * The Zod schemas in @pool/shared are the source of truth for what the server accepts.
 */
import type { CustomerStatus, EquipmentKind, IssueStatus, PaymentMethod, ServiceDay, Unit } from '@pool/shared';

/** Every part optional. */
export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
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
  address?: Address;
  notes?: string;
  /** Missing = current (use customerStatus()). Null = cleared in the app. */
  status?: CustomerStatus | null;
  monthlyRate?: number | null;
  billingEmail?: string | null;
  paymentMethod?: PaymentMethod | null;
  startDate?: string | null;
  endDate?: string | null;
  distanceMiles?: number | null;
}

export interface Equipment {
  _id: string;
  kind: EquipmentKind;
  name?: string;
  model?: string;
  serial?: string;
  installedOn?: string | null;
  notes?: string;
}

export interface Pool extends Base {
  customerId: string;
  name: string;
  address?: Address;
  type?: 'chlorine' | 'salt' | null;
  surface?: string;
  volumeGal?: number | null;
  /** No day: "Not scheduled" on the Route. */
  serviceDay?: ServiceDay | null;
  routeOrder: number;
  accessNotes: string;
  active: boolean;
  week: { done: boolean; doneAt: string | null; changedAt: string | null };
  equipment?: Equipment[];
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
  skimmerBaskets: boolean;
  pumpBasket: boolean;
  filterCleaned: boolean;
  /** Old combined task (visits before Nov 2026). */
  basketsEmptied: boolean;
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
  /** A photo of one piece of the pool's equipment. */
  equipmentId?: string | null;
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
