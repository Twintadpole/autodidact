/**
 * The single source of truth for water-chemistry readings.
 *
 * This constant drives the visit card form, the previous-visit card and
 * out-of-range highlighting. Adding a reading later is a one-line change here
 * (plus nothing else: the Zod visit schema is derived from these keys).
 *
 * Ranges:
 *  - `ideal`: inside this range the value is shown normally.
 *  - `acceptable`: outside `ideal` but inside this range → amber.
 *  - outside `acceptable` → red.
 * Either bound may be omitted (open-ended).
 */

export interface Range {
  min?: number;
  max?: number;
}

export interface ReadingDef {
  key: string;
  label: string;
  /** Short label for compact cards. */
  short: string;
  unit: string;
  step: number;
  ideal?: Range;
  acceptable?: Range;
}

export const READINGS = [
  { key: 'fc', label: 'Free chlorine', short: 'FC', unit: 'ppm', step: 0.1, ideal: { min: 2, max: 5 }, acceptable: { min: 1, max: 10 } },
  { key: 'cc', label: 'Combined chlorine', short: 'CC', unit: 'ppm', step: 0.1, ideal: { max: 0.2 }, acceptable: { max: 0.5 } },
  { key: 'ph', label: 'pH', short: 'pH', unit: '', step: 0.1, ideal: { min: 7.4, max: 7.6 }, acceptable: { min: 7.2, max: 7.8 } },
  { key: 'ta', label: 'Total alkalinity', short: 'TA', unit: 'ppm', step: 10, ideal: { min: 80, max: 100 }, acceptable: { min: 60, max: 120 } },
  { key: 'ch', label: 'Calcium hardness', short: 'CH', unit: 'ppm', step: 25, ideal: { min: 250, max: 350 }, acceptable: { min: 200, max: 450 } },
  { key: 'cya', label: 'Cyanuric acid', short: 'CYA', unit: 'ppm', step: 10, ideal: { min: 30, max: 50 }, acceptable: { min: 20, max: 90 } },
  { key: 'salt', label: 'Salt', short: 'Salt', unit: 'ppm', step: 100, ideal: { min: 3000, max: 3500 }, acceptable: { min: 2700, max: 4000 } },
  { key: 'phosphate', label: 'Phosphate', short: 'PO₄', unit: 'ppb', step: 50, ideal: { max: 100 }, acceptable: { max: 500 } },
  { key: 'tempF', label: 'Water temp', short: 'Temp', unit: '°F', step: 1 },
] as const satisfies readonly ReadingDef[];

export type ReadingKey = (typeof READINGS)[number]['key'];

export const READING_KEYS = READINGS.map((r) => r.key) as [ReadingKey, ...ReadingKey[]];

export type ReadingStatus = 'ok' | 'warn' | 'bad' | 'none';

function inRange(value: number, range: Range | undefined): boolean {
  if (!range) return true;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

/** Classify a reading for highlighting: ok (normal), warn (amber), bad (red). */
export function rateReading(key: ReadingKey, value: number | null | undefined): ReadingStatus {
  if (value === null || value === undefined || Number.isNaN(value)) return 'none';
  const def: ReadingDef | undefined = READINGS.find((r) => r.key === key);
  if (!def) return 'none';
  if (inRange(value, def.ideal)) return 'ok';
  if (inRange(value, def.acceptable)) return 'warn';
  return 'bad';
}
