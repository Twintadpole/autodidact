/**
 * Documents as they arrive over JSON (dates are ISO strings).
 * The Zod schemas in @pool/shared are the source of truth for what the server accepts.
 */
import type { BillingTiming, CustomerStatus, EquipmentKind, InvoiceStatus, InvoiceTerms, IssueStatus, LedgerKind, PaymentMethod, ServiceDay, Unit } from '@pool/shared';

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
  /** Who added it (set by the server). */
  createdBy?: string | null;
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
  /** Weekly day. No day and no one-time date: "Not scheduled" on the Route. */
  serviceDay?: ServiceDay | null;
  /** A one-time job instead of a weekly day. */
  oneTimeDate?: string | null;
  routeOrder: number;
  accessNotes: string;
  active: boolean;
  week: { done: boolean; doneAt: string | null; changedAt: string | null };
  equipment?: Equipment[];
  /** Whose route it is (GPF item 3): a user id, or null = nobody's. */
  techId?: string | null;
}

export interface Dose {
  chemicalId: string;
  amount: number;
  unit: Unit;
  /** Owner-only cost when the visit was saved. Never on invoices or recaps. */
  cost?: number | null;
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
  /** Written for the customer's recap (notes stay private). */
  customerNote?: string;
  recapSentAt?: string | null;
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
  /** Owner-only price per priceUnit. */
  price?: number | null;
  priceUnit?: Unit | null;
}

export interface Settings extends Base {
  businessName?: string;
  address?: Address;
  phone?: string;
  email?: string;
  logoDataUrl?: string;
  paymentInstructions?: string;
  terms?: InvoiceTerms | null;
  billingTiming?: BillingTiming | null;
  firstInvoiceNumber?: number | null;
  mileageRate?: number | null;
  /** Only on the dashboard record. */
  dashboard?: import('@pool/shared').DashboardLayout;
}

/** An expense, other income, or a day's mileage (Phase 7C). */
export interface Ledger extends Base {
  kind: LedgerKind;
  date: string;
  amount?: number | null;
  category?: string | null;
  vendor?: string;
  note?: string;
  customerId?: string | null;
  receiptDataUrl?: string;
  billToCustomer?: boolean;
  billedAmount?: number | null;
  invoiceId?: string | null;
  invoiceLineId?: string | null;
  miles?: number | null;
  odometerStart?: number | null;
  odometerEnd?: number | null;
}

export interface InvoiceLine {
  _id: string;
  description: string;
  amount: number;
}
export interface Payment {
  _id: string;
  date: string;
  amount: number;
  method?: PaymentMethod | null;
  reference?: string;
}
export interface Invoice extends Base {
  customerId: string;
  number: number;
  period?: string | null;
  issueDate: string;
  dueDate?: string | null;
  lines: InvoiceLine[];
  notes?: string;
  status: InvoiceStatus;
  sentAt?: string | null;
  payments: Payment[];
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
