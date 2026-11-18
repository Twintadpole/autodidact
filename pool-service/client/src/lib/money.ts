import type { InvoiceTerms, Unit } from '@pool/shared';
import type { Chemical, Dose, Visit } from './types';

/**
 * Owner-only money helpers (Phase 7B). Chemical costs are never put on invoices or recaps:
 * those are built in lib/invoicePdf.ts and lib/recap.ts from an allow-list of fields.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Units that can be converted: weight (oz), volume (fl oz); tablets only to tablets. */
const BASE: Record<Unit, [string, number]> = { lb: ['weight', 16], oz: ['weight', 1], gal: ['volume', 128], 'fl oz': ['volume', 1], tabs: ['tabs', 1] };

/** Cost of one dose at the chemical's price, or null (no price, or units that don't convert). */
export function doseCost(amount: number, unit: Unit, chem: Pick<Chemical, 'price' | 'priceUnit'> | undefined): number | null {
  if (!chem || chem.price == null || !chem.priceUnit) return null;
  const [kindA, a] = BASE[unit];
  const [kindB, b] = BASE[chem.priceUnit];
  if (kindA !== kindB) return null;
  return round2(((amount * a) / b) * chem.price);
}

/**
 * Doses keep the cost from when they were first saved; a new or changed dose gets today's price.
 */
export function withDoseCosts(doses: Dose[], previous: Dose[] | undefined, chemicalById: Map<string, Chemical>): Dose[] {
  return doses.map((d, i) => {
    const before = previous?.[i];
    const unchanged = before && before.chemicalId === d.chemicalId && before.amount === d.amount && before.unit === d.unit && before.cost != null;
    return { ...d, cost: unchanged ? (before.cost ?? null) : doseCost(d.amount, d.unit, chemicalById.get(d.chemicalId)) };
  });
}

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
