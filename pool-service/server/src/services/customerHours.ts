import { invoiceTotal, timeLogSeconds } from '@pool/shared';
import { BUSINESS_SETTINGS_ID } from '@pool/shared';
import { Customer, Invoice, Ledger, Pool, Settings, Visit } from '../models/index.js';

/**
 * What the owner earned per hour from each customer over a period (Phase 7C):
 *
 *   (billed − chemical costs − mileage cost estimate − expenses linked to them) ÷ hours on site
 *
 * - Billed: invoices (not void) for the service months in the period; a month with visits but no
 *   invoice counts the customer's monthly rate instead.
 * - Chemical costs: each dose's cost as saved with the visit (doses without a price count 0 and
 *   are reported).
 * - Mileage estimate: 2 × the customer's distance from HQ × the mileage rate, per visit.
 * - Hours: the visit timer; a visit without one uses that pool's average timed visit, else the
 *   average over all pools (reported as estimated).
 * Dates are the owner's local dates; `tzOffsetMin` is the phone's getTimezoneOffset().
 */
export interface CustomerHoursRow {
  customerId: string;
  name: string;
  visits: number;
  timedVisits: number;
  /** Visits whose time is the pool's (or overall) average. */
  estimatedVisits: number;
  hours: number;
  billed: number;
  chemicalCost: number;
  mileageCost: number;
  expenses: number;
  profit: number;
  /** null when there are no hours to divide by. */
  perHour: number | null;
  /** Doses without a cost (chemical had no price). */
  unpricedDoses: number;
  /** Visits but no distance from HQ or no mileage rate, so mileage counted as 0. */
  missingMileage: boolean;
  /** Months billed at the monthly rate because there was no invoice. */
  rateMonths: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function localDate(at: Date, tzOffsetMin: number): string {
  return new Date(at.getTime() - tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

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

export async function customerHours(q: { from: string; to: string; tzOffsetMin: number }) {
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

  // Average timed visit per pool, and overall (all time), for visits without a timer.
  const timed = new Map<string, number[]>();
  for (const v of visits) {
    const s = timeLogSeconds(v.timeLog);
    if (s > 0) timed.set(v.poolId, [...(timed.get(v.poolId) ?? []), s]);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const allTimed = [...timed.values()].flat();
  const overallAvg = allTimed.length ? avg(allTimed) : null;

  const months = monthsBetween(q.from, q.to);
  const rows: CustomerHoursRow[] = [];
  for (const c of customers) {
    const mine = visits.filter((v) => {
      if (poolCustomer.get(v.poolId) !== c._id) return false;
      const d = localDate(new Date(v.visitedAt), q.tzOffsetMin);
      return d >= q.from && d <= q.to;
    });
    let seconds = 0;
    let timedVisits = 0;
    let estimatedVisits = 0;
    let chemicalCost = 0;
    let unpricedDoses = 0;
    const visitedMonths = new Set<string>();
    for (const v of mine) {
      visitedMonths.add(localDate(new Date(v.visitedAt), q.tzOffsetMin).slice(0, 7));
      const s = timeLogSeconds(v.timeLog);
      if (s > 0) {
        seconds += s;
        timedVisits++;
      } else {
        const poolAvg = timed.get(v.poolId);
        const fallback = poolAvg?.length ? avg(poolAvg) : overallAvg;
        if (fallback) {
          seconds += fallback;
          estimatedVisits++;
        }
      }
      for (const d of v.doses ?? []) {
        if (typeof d.cost === 'number') chemicalCost += d.cost;
        else unpricedDoses++;
      }
    }

    let billed = 0;
    const rateMonths: string[] = [];
    for (const m of months) {
      const inv = invoices.filter((i) => i.customerId === c._id && i.period === m);
      if (inv.length) billed += inv.reduce((t, i) => t + invoiceTotal({ lines: i.lines ?? [], payments: [], status: i.status }), 0);
      else if (visitedMonths.has(m) && (c.monthlyRate ?? 0) > 0) {
        billed += c.monthlyRate;
        rateMonths.push(m);
      }
    }

    const expenses = ledger.filter((e) => e.customerId === c._id).reduce((t, e) => t + (e.amount ?? 0), 0);
    const distance = typeof c.distanceMiles === 'number' ? c.distanceMiles : null;
    const mileageCost = distance != null && rate != null ? mine.length * 2 * distance * rate : 0;
    if (!mine.length && !billed && !expenses) continue;

    const hours = seconds / 3600;
    const profit = billed - chemicalCost - mileageCost - expenses;
    rows.push({
      customerId: c._id,
      name: c.name,
      visits: mine.length,
      timedVisits,
      estimatedVisits,
      hours: Math.round(hours * 100) / 100,
      billed: round2(billed),
      chemicalCost: round2(chemicalCost),
      mileageCost: round2(mileageCost),
      expenses: round2(expenses),
      profit: round2(profit),
      perHour: hours > 0 ? round2(profit / hours) : null,
      unpricedDoses,
      missingMileage: mine.length > 0 && (distance == null || rate == null),
      rateMonths,
    });
  }
  // Lowest hourly first: the customers worth repricing are at the top.
  rows.sort((a, b) => (a.perHour ?? Infinity) - (b.perHour ?? Infinity));
  return { from: q.from, to: q.to, mileageRate: rate, overallAvgMinutes: overallAvg ? Math.round(overallAvg / 60) : null, rows };
}
