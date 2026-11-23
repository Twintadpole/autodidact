import ExcelJS from 'exceljs';
import { BUSINESS_SETTINGS_ID, categoryLabel, customerStatus, deriveQuadrant, invoiceBalance, invoicePaid, invoiceState, invoiceTotal, QUADRANTS, READINGS, timeLogSeconds } from '@pool/shared';
import { Chemical, Customer, Invoice, Issue, Ledger, Note, Pool, Settings, Visit } from '../models/index.js';

/**
 * Excel exports (Phase 7E). Everything is the owner's own data, chemical costs included (owner's decision,
 * Nov 18). Images (photos, receipts, logo) are left out; deleted records too.
 */
export type CellType = 'text' | 'number' | 'money' | 'date' | 'datetime' | 'yesno';
export interface Column {
  header: string;
  type?: CellType;
  width?: number;
}
type Value = string | number | boolean | Date | null | undefined;

const MONEY = '$#,##0.00;[Red]-$#,##0.00';

/** "2026-11-18" or a stored calendar date (UTC midnight) → an Excel date. */
function day(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}
/** A moment → the owner's local date and time, as Excel shows it (Excel has no time zones). */
function local(v: unknown, tzOffsetMin: number): Date | null {
  if (v == null || v === '') return null;
  const t = new Date(v as string | Date).getTime();
  return Number.isNaN(t) ? null : new Date(t - tzOffsetMin * 60_000);
}
/** "2026-11-18 14:20" sent by the app (already local) → Excel date-time. */
function naive(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v ?? ''));
  return m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!)) : day(v);
}

/** One sheet: bold frozen header, sensible widths, number formats, a filter on the header row. */
export function addSheet(wb: ExcelJS.Workbook, name: string, columns: Column[], rows: Value[][], opts: { naiveTimes?: boolean } = {}) {
  const ws = wb.addWorksheet(name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.header,
    width: c.width ?? Math.min(40, Math.max(10, c.header.length + 2, c.type === 'datetime' ? 17 : c.type === 'date' ? 12 : 0)),
    style: c.type === 'money' ? { numFmt: MONEY } : c.type === 'date' ? { numFmt: 'yyyy-mm-dd' } : c.type === 'datetime' ? { numFmt: 'yyyy-mm-dd hh:mm' } : {},
  }));
  for (const r of rows) {
    ws.addRow(
      columns.map((c, i) => {
        const v = r[i];
        if (v == null || v === '') return null;
        switch (c.type) {
          case 'date':
            return v instanceof Date ? v : day(v);
          case 'datetime':
            return v instanceof Date ? v : opts.naiveTimes ? naive(v) : null;
          case 'number':
          case 'money':
            return typeof v === 'number' ? v : Number.isFinite(Number(v)) ? Number(v) : String(v);
          case 'yesno':
            return v ? 'Yes' : 'No';
          default:
            return typeof v === 'string' ? v : String(v);
        }
      }),
    );
  }
  ws.getRow(1).font = { bold: true };
  if (columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

export const newWorkbook = () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pool Service';
  wb.created = new Date();
  return wb;
};

const addressText = (a: Record<string, string> | undefined) => (a ? [a.line1, a.line2, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter((x) => x?.trim()).join(', ') : '');
const TASK_LABEL: Record<string, string> = { brushed: 'Brushed', skimmed: 'Skimmed', vacuumed: 'Vacuumed', skimmerBaskets: 'Skimmer baskets', pumpBasket: 'Pump basket', filterCleaned: 'Filter cleaned', basketsEmptied: 'Baskets' };
const EQUIPMENT_LABEL: Record<string, string> = { pump: 'Pump', filter: 'Filter', heater: 'Heater', saltCell: 'Salt cell / chlorinator', cleaner: 'Cleaner', automation: 'Automation', lights: 'Lights', timer: 'Timer', other: 'Other' };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The whole business in one workbook: a sheet per kind of record. Times are the owner's local times. */
export async function everythingWorkbook(tzOffsetMin: number): Promise<ExcelJS.Workbook> {
  const live = { deletedAt: null };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [customers, pools, visits, chemicals, invoices, ledger, issues, notes, settings] = await Promise.all([
    Customer.find(live).sort({ name: 1 }).lean<any[]>(),
    Pool.find(live).lean<any[]>(),
    Visit.find(live).sort({ visitedAt: 1 }).lean<any[]>(),
    Chemical.find(live).sort({ name: 1 }).lean<any[]>(),
    Invoice.find(live).sort({ number: 1 }).lean<any[]>(),
    Ledger.find(live).sort({ date: 1, createdAt: 1 }).lean<any[]>(),
    Issue.find(live).sort({ createdAt: 1 }).lean<any[]>(),
    Note.find(live).sort({ createdAt: 1 }).lean<any[]>(),
    Settings.findById(BUSINESS_SETTINGS_ID).lean<any>(),
  ]);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const customerById = new Map(customers.map((c) => [c._id, c]));
  const livePools = pools.filter((p) => customerById.has(p.customerId));
  const poolById = new Map(livePools.map((p) => [p._id, p]));
  const chemicalById = new Map(chemicals.map((c) => [c._id, c]));
  const customerName = (id: string | null | undefined) => (id ? (customerById.get(id)?.name ?? '') : '');
  const poolCustomer = (poolId: string) => customerName(poolById.get(poolId)?.customerId);
  const poolName = (poolId: string) => poolById.get(poolId)?.name ?? '';
  const visitsLive = visits.filter((v) => poolById.has(v.poolId));
  const rate: number | null = settings?.mileageRate ?? null;
  const wb = newWorkbook();

  addSheet(
    wb,
    'Customers',
    [
      { header: 'Name', width: 26 },
      { header: 'Class' },
      { header: 'Phones', width: 26 },
      { header: 'Email', width: 26 },
      { header: 'Address', width: 36 },
      { header: 'Monthly rate', type: 'money' },
      { header: 'Billing email', width: 24 },
      { header: 'Pays by' },
      { header: 'Service started', type: 'date' },
      { header: 'Service ended', type: 'date' },
      { header: 'Miles from HQ', type: 'number' },
      { header: 'Notes', width: 40 },
      { header: 'Added', type: 'date' },
    ],
    customers.map((c) => [
      c.name,
      { current: 'Current', prospect: 'Prospect', past: 'Past' }[customerStatus(c)],
      (c.phones ?? []).map((p: { label: string; number: string }) => `${p.label}: ${p.number}`).join('; '),
      c.email,
      addressText(c.address),
      c.monthlyRate,
      c.billingEmail,
      c.paymentMethod,
      c.startDate,
      c.endDate,
      c.distanceMiles,
      c.notes,
      local(c.createdAt, tzOffsetMin),
    ]),
  );

  addSheet(
    wb,
    'Pools',
    [
      { header: 'Customer', width: 26 },
      { header: 'Pool', width: 14 },
      { header: 'Address (if not the customer’s)', width: 36 },
      { header: 'Type' },
      { header: 'Surface' },
      { header: 'Gallons', type: 'number' },
      { header: 'Service day' },
      { header: 'One-time date', type: 'date' },
      { header: 'Stop #', type: 'number' },
      { header: 'Active', type: 'yesno' },
      { header: 'Access notes', width: 40 },
    ],
    livePools.map((p) => [customerName(p.customerId), p.name, addressText(p.address), p.type, p.surface, p.volumeGal, p.serviceDay, p.oneTimeDate, p.routeOrder, p.active, p.accessNotes]),
  );

  addSheet(
    wb,
    'Equipment',
    [
      { header: 'Customer', width: 26 },
      { header: 'Pool', width: 14 },
      { header: 'Equipment', width: 20 },
      { header: 'Name', width: 18 },
      { header: 'Model', width: 18 },
      { header: 'Serial', width: 18 },
      { header: 'Installed', type: 'date' },
      { header: 'Notes', width: 36 },
    ],
    livePools.flatMap((p) => (p.equipment ?? []).map((e: Record<string, unknown>) => [customerName(p.customerId), p.name, EQUIPMENT_LABEL[String(e.kind)] ?? e.kind, e.name, e.model, e.serial, e.installedOn, e.notes] as Value[])),
  );

  addSheet(
    wb,
    'Visits',
    [
      { header: 'Date', type: 'datetime' },
      { header: 'Customer', width: 26 },
      { header: 'Pool', width: 14 },
      { header: 'Minutes on site', type: 'number' },
      ...READINGS.map((r): Column => ({ header: r.unit ? `${r.short} (${r.unit})` : r.short, type: 'number' })),
      { header: 'Tasks', width: 36 },
      { header: 'Chemicals added', width: 36 },
      { header: 'Chemical cost', type: 'money' },
      { header: 'Notes (private)', width: 40 },
      { header: 'Note for the customer', width: 40 },
      { header: 'Recap sent', type: 'date' },
    ],
    visitsLive.map((v) => {
      const secs = timeLogSeconds(v.timeLog);
      const costs = (v.doses ?? []).map((d: { cost?: number | null }) => d.cost).filter((c: number | null | undefined): c is number => c != null);
      return [
        local(v.visitedAt, tzOffsetMin),
        poolCustomer(v.poolId),
        poolName(v.poolId),
        secs ? Math.round(secs / 60) : null,
        ...READINGS.map((r) => v.readings?.[r.key] ?? null),
        Object.entries(v.tasks ?? {})
          .filter(([, done]) => done)
          .map(([k]) => TASK_LABEL[k] ?? k)
          .join(', '),
        (v.doses ?? []).map((d: { chemicalId: string; amount: number; unit: string }) => `${chemicalById.get(d.chemicalId)?.name ?? 'Chemical'} ${d.amount} ${d.unit}`).join(', '),
        costs.length ? r2(costs.reduce((t: number, c: number) => t + c, 0)) : null,
        v.notes,
        v.customerNote,
        v.recapSentAt ? local(v.recapSentAt, tzOffsetMin) : null,
      ];
    }),
  );

  addSheet(
    wb,
    'Chemicals added',
    [
      { header: 'Date', type: 'datetime' },
      { header: 'Customer', width: 26 },
      { header: 'Pool', width: 14 },
      { header: 'Chemical', width: 24 },
      { header: 'Amount', type: 'number' },
      { header: 'Unit' },
      { header: 'Cost', type: 'money' },
    ],
    visitsLive.flatMap((v) =>
      (v.doses ?? []).map((d: { chemicalId: string; amount: number; unit: string; cost?: number | null }) => [local(v.visitedAt, tzOffsetMin), poolCustomer(v.poolId), poolName(v.poolId), chemicalById.get(d.chemicalId)?.name ?? 'Chemical', d.amount, d.unit, d.cost ?? null] as Value[]),
    ),
  );

  const STATE = { draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', void: 'Void' } as const;
  addSheet(
    wb,
    'Invoices',
    [
      { header: 'Number', type: 'number' },
      { header: 'Customer', width: 26 },
      { header: 'Month' },
      { header: 'Date', type: 'date' },
      { header: 'Due', type: 'date' },
      { header: 'Total', type: 'money' },
      { header: 'Paid', type: 'money' },
      { header: 'Balance', type: 'money' },
      { header: 'Status' },
      { header: 'Sent', type: 'date' },
      { header: 'Note on the invoice', width: 36 },
    ],
    invoices.map((i) => [i.number, customerName(i.customerId), i.period, i.issueDate, i.dueDate, invoiceTotal(i), invoicePaid(i), i.status === 'void' ? 0 : invoiceBalance(i), STATE[invoiceState(i)], i.sentAt ? local(i.sentAt, tzOffsetMin) : null, i.notes]),
  );
  addSheet(
    wb,
    'Invoice lines',
    [{ header: 'Invoice', type: 'number' }, { header: 'Customer', width: 26 }, { header: 'Description', width: 44 }, { header: 'Amount', type: 'money' }],
    invoices.flatMap((i) => (i.lines ?? []).map((l: { description: string; amount: number }) => [i.number, customerName(i.customerId), l.description, l.amount] as Value[])),
  );
  addSheet(
    wb,
    'Payments',
    [{ header: 'Date', type: 'date' }, { header: 'Invoice', type: 'number' }, { header: 'Customer', width: 26 }, { header: 'Amount', type: 'money' }, { header: 'Method' }, { header: 'Reference', width: 18 }, { header: 'Invoice void', type: 'yesno' }],
    invoices.flatMap((i) => (i.payments ?? []).map((p: { date: Date; amount: number; method?: string | null; reference?: string }) => [p.date, i.number, customerName(i.customerId), p.amount, p.method, p.reference, i.status === 'void'] as Value[])),
  );

  const invoiceNumber = new Map(invoices.map((i) => [i._id, i.number]));
  addSheet(
    wb,
    'Expenses & income',
    [
      { header: 'Date', type: 'date' },
      { header: 'Type' },
      { header: 'Category', width: 22 },
      { header: 'Vendor', width: 20 },
      { header: 'Customer', width: 26 },
      { header: 'Amount', type: 'money' },
      { header: 'Billed to customer', type: 'money' },
      { header: 'On invoice', type: 'number' },
      { header: 'Note', width: 36 },
      { header: 'Receipt photo', type: 'yesno' },
    ],
    ledger
      .filter((e) => e.kind !== 'mileage')
      .map((e) => [
        e.date,
        e.kind === 'income' ? 'Income' : 'Expense',
        e.kind === 'expense' ? categoryLabel(e.category) : '',
        e.vendor,
        customerName(e.customerId),
        e.amount,
        e.billToCustomer ? (e.billedAmount ?? e.amount) : null,
        e.invoiceId ? invoiceNumber.get(e.invoiceId) : null,
        e.note,
        !!e.receiptDataUrl,
      ]),
  );
  addSheet(
    wb,
    'Mileage',
    [{ header: 'Date', type: 'date' }, { header: 'Miles', type: 'number' }, { header: 'Odometer start', type: 'number' }, { header: 'Odometer end', type: 'number' }, { header: rate != null ? `Worth (at $${rate}/mi)` : 'Worth', type: 'money' }, { header: 'Note', width: 36 }],
    ledger.filter((e) => e.kind === 'mileage').map((e) => [e.date, e.miles, e.odometerStart, e.odometerEnd, e.miles != null && rate != null ? r2(e.miles * rate) : null, e.note]),
  );
  addSheet(
    wb,
    'Chemicals',
    [{ header: 'Name', width: 26 }, { header: 'Default unit' }, { header: 'Your cost', type: 'money' }, { header: 'Per' }, { header: 'Active', type: 'yesno' }],
    chemicals.map((c) => [c.name, c.defaultUnit, c.price, c.price != null ? c.priceUnit : null, c.active]),
  );
  const STATUS = { open: 'Open', in_progress: 'In progress', postponed: 'Postponed', resolved: 'Completed' } as Record<string, string>;
  addSheet(
    wb,
    'Issues',
    [
      { header: 'Opened', type: 'datetime' },
      { header: 'Customer', width: 26 },
      { header: 'Pool', width: 14 },
      { header: 'Issue', width: 30 },
      { header: 'Details', width: 40 },
      { header: 'Priority' },
      { header: 'Status' },
      { header: 'Completed', type: 'datetime' },
    ],
    issues
      .filter((i) => poolById.has(i.poolId))
      .map((i) => [local(i.createdAt, tzOffsetMin), poolCustomer(i.poolId), poolName(i.poolId), i.title, i.description, QUADRANTS.find((q) => q.key === deriveQuadrant(i))!.label, STATUS[i.status] ?? i.status, i.resolvedAt ? local(i.resolvedAt, tzOffsetMin) : null]),
  );
  const visitPool = new Map(visitsLive.map((v) => [v._id, v.poolId]));
  addSheet(
    wb,
    'Notes',
    [{ header: 'Written', type: 'datetime' }, { header: 'About' }, { header: 'Customer', width: 26 }, { header: 'Pool', width: 14 }, { header: 'Note', width: 60 }, { header: 'Pinned', type: 'yesno' }],
    notes
      .map((n) => {
        const poolId = n.parentType === 'pool' ? n.parentId : n.parentType === 'visit' ? visitPool.get(n.parentId) : null;
        const customer = n.parentType === 'customer' ? customerName(n.parentId) : poolId ? poolCustomer(poolId) : '';
        return customer ? ([local(n.createdAt, tzOffsetMin), { customer: 'Customer', pool: 'Pool', visit: 'Visit' }[n.parentType as string], customer, poolId ? poolName(poolId) : '', n.body, n.pinned] as Value[]) : null;
      })
      .filter((r): r is Value[] => !!r),
  );
  return wb;
}
