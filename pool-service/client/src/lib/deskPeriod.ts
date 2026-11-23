import { translatedOptions } from '@/i18n';
import { periodRange, type PeriodKey } from './report';

/** Date filter on the desktop tables: the money report's periods, plus everything. */
export type DeskPeriod = PeriodKey | 'all';
export const PERIOD_OPTIONS: { label: string; value: DeskPeriod }[] = translatedOptions([
  { label: 'This month', value: 'thisMonth' },
  { label: 'Last month', value: 'lastMonth' },
  { label: 'This year', value: 'thisYear' },
  { label: 'Last year', value: 'lastYear' },
  { label: 'All dates', value: 'all' },
]);

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
