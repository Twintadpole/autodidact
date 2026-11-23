import type { Unit } from './schemas/common.js';

/**
 * Chemical cost of a dose (Phase 7B; shared since GPF item 3 so the server can price a tech's
 * doses: a tech's phone never has the prices). Owner-only figures: never on invoices or recaps.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Units that can be converted: weight (oz), volume (fl oz); tablets only to tablets. */
const BASE: Record<Unit, [string, number]> = { lb: ['weight', 16], oz: ['weight', 1], gal: ['volume', 128], 'fl oz': ['volume', 1], tabs: ['tabs', 1] };

interface Priced {
  price?: number | null;
  priceUnit?: Unit | null;
}
interface DoseLike {
  chemicalId: string;
  amount: number;
  unit: Unit;
  cost?: number | null;
}

/** Cost of one dose at the chemical's price, or null (no price, or units that don't convert). */
export function doseCost(amount: number, unit: Unit, chem: Priced | undefined): number | null {
  if (!chem || chem.price == null || !chem.priceUnit) return null;
  const [kindA, a] = BASE[unit];
  const [kindB, b] = BASE[chem.priceUnit];
  if (kindA !== kindB) return null;
  return round2(((amount * a) / b) * chem.price);
}

/** Doses keep the cost from when they were first saved; a new or changed dose gets today's price. */
export function withDoseCosts<D extends DoseLike>(doses: D[], previous: DoseLike[] | undefined, chemicalById: Map<string, Priced>): D[] {
  return doses.map((d, i) => {
    const before = previous?.[i];
    const unchanged = before && before.chemicalId === d.chemicalId && before.amount === d.amount && before.unit === d.unit && before.cost != null;
    return { ...d, cost: unchanged ? (before.cost ?? null) : doseCost(d.amount, d.unit, chemicalById.get(d.chemicalId)) };
  });
}
