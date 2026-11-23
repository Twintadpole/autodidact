import { locale } from '@/i18n';
import { api } from '@/stores/api';
import { localDate, periodOf } from './money';
import type { Visit } from './types';

/** The last n months as "2026-11" periods, oldest first (this month last). */
export function lastMonths(n: number, today = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => periodOf(new Date(today.getFullYear(), today.getMonth() - (n - 1) + i, 1)));
}

/** "2026-11" → "Nov 26". */
export const monthLabel = (p: string) => new Date(Number(p.slice(0, 4)), Number(p.slice(5)) - 1, 1).toLocaleDateString(locale.value, { month: 'short', year: '2-digit' });

const recent = new Map<string, { at: number; p: Promise<Visit[]> }>();
/**
 * Every visit of the last n months from the server. Cards that ask for the same months within a
 * minute share one download.
 */
export function visitsForMonths(n: number): Promise<Visit[]> {
  const now = new Date();
  const from = `${lastMonths(n, now)[0]}-01`;
  const to = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const key = `${from}|${to}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = api<Visit[]>(`/reports/visits?from=${from}&to=${to}&tzOffsetMin=${now.getTimezoneOffset()}&limit=5000`);
  recent.set(key, { at: Date.now(), p });
  p.catch(() => recent.delete(key));
  return p;
}
