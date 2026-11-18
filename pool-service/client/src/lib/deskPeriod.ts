import { periodRange, PERIOD_LABEL, type PeriodKey } from './report';

/** Date filter on the desktop tables: the money report's periods, plus everything. */
export type DeskPeriod = PeriodKey | 'all';
export const PERIOD_OPTIONS: { label: string; value: DeskPeriod }[] = [
  ...(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => ({ label: PERIOD_LABEL[k], value: k })),
  { label: 'All dates', value: 'all' },
];

/** From/to local dates for a period; null for all dates. */
export function deskRange(p: DeskPeriod, today = new Date()): { from: string; to: string } | null {
  return p === 'all' ? null : periodRange(p, today);
}

/** True when a "2026-11-18" date (or ISO time's date) falls in the period. */
export function inPeriod(date: string | null | undefined, p: DeskPeriod, today = new Date()): boolean {
  const r = deskRange(p, today);
  if (!r) return true;
  if (!date) return false;
  const d = date.slice(0, 10);
  return d >= r.from && d <= r.to;
}
