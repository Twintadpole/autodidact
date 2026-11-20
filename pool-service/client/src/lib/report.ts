import { categoryLabel, invoiceBalance, invoiceState, isCapitalCategory } from '@pool/shared';
import { localDate } from './money';
import type { Invoice, Ledger } from './types';

/** Money report for a period, worked out on the phone (works offline). Phase 7C. */
export type PeriodKey = 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear';
export const PERIOD_LABEL: Record<PeriodKey, string> = { thisMonth: 'This month', lastMonth: 'Last month', thisYear: 'This year', lastYear: 'Last year' };

export function periodRange(key: PeriodKey, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (key) {
    case 'thisMonth':
      return { from: localDate(new Date(y, m, 1)), to: localDate(new Date(y, m + 1, 0)) };
    case 'lastMonth':
      return { from: localDate(new Date(y, m - 1, 1)), to: localDate(new Date(y, m, 0)) };
    case 'thisYear':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const inRange = (d: string, from: string, to: string) => d.slice(0, 10) >= from && d.slice(0, 10) <= to;

export interface MoneySummary {
  income: { payments: number; other: number; total: number };
  /** Running costs by category (capital purchases left out). */
  expenses: { key: string; label: string; amount: number }[];
  runningCosts: number;
  capital: number;
  /** Income minus running costs. */
  profit: number;
  miles: number;
  mileageValue: number | null;
  /** Unpaid now (sent and overdue invoices), whatever the period. */
  owed: number;
}

export function moneySummary(invoices: Invoice[], ledger: Ledger[], from: string, to: string, mileageRate: number | null | undefined): MoneySummary {
  // Income counts when it's received: invoice payments by their date (not void), plus other income.
  const payments = invoices.filter((i) => i.status !== 'void').flatMap((i) => i.payments.filter((p) => inRange(p.date, from, to)));
  const paymentTotal = r2(payments.reduce((t, p) => t + p.amount, 0));
  const entries = ledger.filter((e) => inRange(e.date, from, to));
  const other = r2(entries.filter((e) => e.kind === 'income').reduce((t, e) => t + (e.amount ?? 0), 0));

  const byCat = new Map<string, number>();
  let capital = 0;
  for (const e of entries.filter((x) => x.kind === 'expense')) {
    const amount = e.amount ?? 0;
    if (isCapitalCategory(e.category)) capital += amount;
    else byCat.set(e.category ?? '', (byCat.get(e.category ?? '') ?? 0) + amount);
  }
  const expenses = [...byCat.entries()].map(([key, amount]) => ({ key, label: categoryLabel(key || null), amount: r2(amount) })).sort((a, b) => b.amount - a.amount);
  const runningCosts = r2(expenses.reduce((t, e) => t + e.amount, 0));

  const miles = Math.round(entries.filter((e) => e.kind === 'mileage').reduce((t, e) => t + (e.miles ?? 0), 0) * 10) / 10;
  const owed = r2(invoices.filter((i) => ['sent', 'overdue'].includes(invoiceState(i))).reduce((t, i) => t + invoiceBalance(i), 0));
  const incomeTotal = r2(paymentTotal + other);
  return {
    income: { payments: paymentTotal, other, total: incomeTotal },
    expenses,
    runningCosts,
    capital: r2(capital),
    profit: r2(incomeTotal - runningCosts),
    miles,
    mileageValue: mileageRate != null ? r2(miles * mileageRate) : null,
    owed,
  };
}

/** Miles from odometer readings, when both are there and make sense. */
export function odometerMiles(start: number | null, end: number | null): number | null {
  return start != null && end != null && end >= start ? Math.round((end - start) * 10) / 10 : null;
}
