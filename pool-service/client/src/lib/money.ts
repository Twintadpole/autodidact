import type { InvoiceTerms } from '@pool/shared';
import type { Visit } from './types';

/**
 * Owner-only money helpers (Phase 7B). Chemical costs are never put on invoices or recaps:
 * those are built in lib/invoicePdf.ts and lib/recap.ts from an allow-list of fields.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

// Dose pricing lives in @pool/shared (the server prices a tech's doses too).
export { doseCost, withDoseCosts } from '@pool/shared';

/** Total chemical cost of a visit; null when no dose has a cost. */
export function visitChemicalCost(v: Pick<Visit, 'doses'>): number | null {
  const costs = v.doses.map((d) => d.cost).filter((c): c is number => c != null);
  return costs.length ? round2(costs.reduce((s, c) => s + c, 0)) : null;
}

export const TERMS_LABEL: Record<InvoiceTerms, string> = { receipt: 'Due on receipt', net15: 'Net 15', net30: 'Net 30' };
export const TERMS_DAYS: Record<InvoiceTerms, number> = { receipt: 0, net15: 15, net30: 30 };

/** "2026-11" → "November 2026". */
export function periodLabel(period: string | null | undefined): string {
  if (!period) return '';
  const [y, m] = period.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** "2026-11" for a date (local). */
export const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** "2026-11-18" (local date). */
export const localDate = (d: Date) => `${periodOf(d)}-${String(d.getDate()).padStart(2, '0')}`;

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return localDate(new Date(y!, m! - 1, d! + days));
}
