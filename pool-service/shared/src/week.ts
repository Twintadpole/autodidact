import { endOfISOWeek, format, getISODay, parseISO, startOfISOWeek } from 'date-fns';
import { SERVICE_DAYS, type ServiceDay } from './schemas/common.js';

/** ISO week key, e.g. "2026-W44" (weeks run Monday–Sunday). */
export function isoWeekKey(date: Date): string {
  return format(date, "RRRR-'W'II");
}

export function weekBounds(date: Date): { start: Date; end: Date } {
  return { start: startOfISOWeek(date), end: endOfISOWeek(date) };
}

/** Service day for a date: Monday → "mon" … Sunday → "sun". */
export function serviceDayOf(date: Date): ServiceDay {
  return SERVICE_DAYS[getISODay(date) - 1]!;
}

/**
 * Service days ordered starting from `today`, for the Route list
 * ("today's group first").
 */
export function serviceDaysFrom(today: Date): ServiceDay[] {
  const start = getISODay(today) - 1;
  return [...SERVICE_DAYS.slice(start), ...SERVICE_DAYS.slice(0, start)];
}

/** "2026-11-19" from a stored date (Date or ISO string), without a time-zone shift. */
export function dateOnly(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

/**
 * Where a pool goes on the Route in the week of `today`:
 *  - weekly: its service day
 *  - once: a one-time date in this week, under that day (counted like a weekly stop)
 *  - upcoming: a one-time date after this week ("Coming up", not counted)
 *  - pastOnce: a one-time date before this week ("Past one-time", until rescheduled)
 *  - none: no day and no date ("Not scheduled")
 */
export type RouteSlot =
  | { kind: 'weekly'; day: ServiceDay }
  | { kind: 'once'; day: ServiceDay; date: string }
  | { kind: 'upcoming'; date: string }
  | { kind: 'pastOnce'; date: string }
  | { kind: 'none' };

export function routeSlot(pool: { serviceDay?: ServiceDay | null; oneTimeDate?: Date | string | null }, today: Date): RouteSlot {
  if (pool.serviceDay) return { kind: 'weekly', day: pool.serviceDay };
  if (!pool.oneTimeDate) return { kind: 'none' };
  const date = dateOnly(pool.oneTimeDate);
  const local = parseISO(date);
  const { start, end } = weekBounds(today);
  if (local < start) return { kind: 'pastOnce', date };
  if (local > end) return { kind: 'upcoming', date };
  return { kind: 'once', day: serviceDayOf(local), date };
}
