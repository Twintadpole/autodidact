import { BUSINESS_SETTINGS_ID, invoiceTotal, timeLogSeconds } from '@pool/shared';
import { Customer, Invoice, Ledger, Pool, Settings, Visit } from '../models/index.js';

/**
 * What the owner earns per hour from each customer, month by month (Phase 7C, as the owner asked):
 *
 *   month profit = billed − that month's chemicals (all of them) − mileage − expenses for them
 *   average $/h  = month profit ÷ the month's hours on site
 *   a visit's $/h = (month profit ÷ visits that month) ÷ that visit's time
 *
 * - Billed: invoices (not void) for that service month; with visits but no invoice, the monthly rate.
 * - Mileage: 2 × distance from HQ × rate per mile, per visit (an estimate).
 * - Time: the visit timer; without one, that pool's average timed visit, else the all-pools average.
 * - A month is "complete" once it has ended (the current month is in progress).
 * Dates are the owner's local dates; `tzOffsetMin` is the phone's getTimezoneOffset().
 */
export interface VisitRow {
  visitId: string;
  date: string;
  minutes: number | null;
  /** 'timer', 'pool' (that pool's average) or 'all' (all-pools average); null when no time at all. */
  timeFrom: 'timer' | 'pool' | 'all' | null;
  perHour: number | null;
}
export interface MonthRow {
  month: string;
  complete: boolean;
  billed: number;
  /** Billed at the monthly rate because there was no invoice. */
  billedFromRate: boolean;
  chemicalCost: number;
  unpricedDoses: number;
  mileageCost: number;
  missingMileage: boolean;
  expenses: number;
  profit: number;
  hours: number;
  perHour: number | null;
  visits: VisitRow[];
}
export interface CustomerRow {
  customerId: string;
  name: string;
  months: MonthRow[];
  /** Over the whole period: total profit ÷ total hours. */
  profit: number;
  hours: number;
  perHour: number | null;
  visitCount: number;
  estimatedVisits: number;
  inProgress: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const localDate = (at: Date, tzOffsetMin: number) => new Date(at.getTime() - tzOffsetMin * 60_000).toISOString().slice(0, 10);

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number) as [number, number];
  const [ty, tm] = to.slice(0, 7).split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export async function customerHours(q: { from: string; to: string; tzOffsetMin: number; now?: Date }) {
  const [customers, pools, visits, invoices, ledger, settings] = await Promise.all([
    Customer.find({ deletedAt: null }).lean<Record<string, any>[]>(),
    Pool.find({ deletedAt: null }).lean<Record<string, any>[]>(),
    Visit.find({ deletedAt: null }).lean<Record<string, any>[]>(),
    Invoice.find({ deletedAt: null, status: { $ne: 'void' } }).lean<Record<string, any>[]>(),
    Ledger.find({ deletedAt: null, kind: 'expense', customerId: { $ne: null }, date: { $gte: q.from, $lte: q.to } }).lean<Record<string, any>[]>(),
    Settings.findById(BUSINESS_SETTINGS_ID).lean<Record<string, any>>(),
  ]);
  const rate: number | null = settings?.deletedAt ? null : (settings?.mileageRate ?? null);
  const poolCustomer = new Map(pools.map((p) => [p._id as string, p.customerId as string]));
  const thisMonth = localDate(q.now ?? new Date(), q.tzOffsetMin).slice(0, 7);

  // Average timed visit per pool, and over all pools (all time), for visits without a timer.
  const timed = new Map<string, number[]>();
  for (const v of visits) {
    const s = timeLogSeconds(v.timeLog);
    if (s > 0) timed.set(v.poolId, [...(timed.get(v.poolId) ?? []), s]);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const allTimed = [...timed.values()].flat();
  const overallAvg = allTimed.length ? avg(allTimed) : null;

  const months = monthsBetween(q.from, q.to);
  const rows: CustomerRow[] = [];
  for (const c of customers) {
    const distance = typeof c.distanceMiles === 'number' ? c.distanceMiles : null;
    const perVisitMileage = distance != null && rate != null ? 2 * distance * rate : 0;
    const mine = visits
      .filter((v) => poolCustomer.get(v.poolId) === c._id)
      .map((v) => ({ v, date: localDate(new Date(v.visitedAt), q.tzOffsetMin) }))
      .filter(({ date }) => date >= q.from && date <= q.to)
      .sort((a, b) => a.date.localeCompare(b.date));

    const monthRows: MonthRow[] = [];
    for (const m of months) {
      const mv = mine.filter((x) => x.date.startsWith(m));
      const inv = invoices.filter((i) => i.customerId === c._id && i.period === m);
      let billed = inv.reduce((t, i) => t + invoiceTotal({ lines: i.lines ?? [], payments: [], status: i.status }), 0);
      const billedFromRate = !inv.length && mv.length > 0 && (c.monthlyRate ?? 0) > 0;
      if (billedFromRate) billed = c.monthlyRate;
      const expenses = ledger.filter((e) => e.customerId === c._id && e.date.startsWith(m)).reduce((t, e) => t + (e.amount ?? 0), 0);
      if (!mv.length && !billed && !expenses) continue;

      let chemicalCost = 0;
      let unpricedDoses = 0;
      const timesSec: (number | null)[] = [];
      const sources: VisitRow['timeFrom'][] = [];
      for (const { v } of mv) {
        for (const d of v.doses ?? []) {
          if (typeof d.cost === 'number') chemicalCost += d.cost;
          else unpricedDoses++;
        }
        const s = timeLogSeconds(v.timeLog);
        const poolTimes = timed.get(v.poolId);
        if (s > 0) {
          timesSec.push(s);
          sources.push('timer');
        } else if (poolTimes?.length) {
          timesSec.push(avg(poolTimes));
          sources.push('pool');
        } else if (overallAvg) {
          timesSec.push(overallAvg);
          sources.push('all');
        } else {
          timesSec.push(null);
          sources.push(null);
        }
      }
      const mileageCost = mv.length * perVisitMileage;
      const profit = billed - chemicalCost - mileageCost - expenses;
      const seconds = timesSec.reduce<number>((t, x) => t + (x ?? 0), 0);
      const share = mv.length ? profit / mv.length : 0;
      monthRows.push({
        month: m,
        complete: m < thisMonth,
        billed: r2(billed),
        billedFromRate,
        chemicalCost: r2(chemicalCost),
        unpricedDoses,
        mileageCost: r2(mileageCost),
        missingMileage: mv.length > 0 && (distance == null || rate == null),
        expenses: r2(expenses),
        profit: r2(profit),
        hours: r2(seconds / 3600),
        perHour: seconds > 0 ? r2(profit / (seconds / 3600)) : null,
        visits: mv.map(({ v, date }, i) => ({
          visitId: v._id,
          date,
          minutes: timesSec[i] != null ? Math.round(timesSec[i]! / 60) : null,
          timeFrom: sources[i] ?? null,
          perHour: timesSec[i] ? r2(share / (timesSec[i]! / 3600)) : null,
        })),
      });
    }
    if (!monthRows.length) continue;
    const profit = monthRows.reduce((t, m) => t + m.profit, 0);
    const seconds = monthRows.reduce((t, m) => t + m.hours * 3600, 0);
    const allVisits = monthRows.flatMap((m) => m.visits);
    rows.push({
      customerId: c._id,
      name: c.name,
      months: monthRows,
      profit: r2(profit),
      hours: r2(seconds / 3600),
      perHour: seconds > 0 ? r2(profit / (seconds / 3600)) : null,
      visitCount: allVisits.length,
      estimatedVisits: allVisits.filter((v) => v.timeFrom !== 'timer').length,
      inProgress: monthRows.some((m) => !m.complete),
    });
  }
  // Lowest hourly first: the customers worth repricing are at the top.
  rows.sort((a, b) => (a.perHour ?? Infinity) - (b.perHour ?? Infinity));
  return { from: q.from, to: q.to, thisMonth, mileageRate: rate, overallAvgMinutes: overallAvg ? Math.round(overallAvg / 60) : null, rows };
}
