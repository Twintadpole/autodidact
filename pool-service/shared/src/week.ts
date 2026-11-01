import { endOfISOWeek, format, getISODay, startOfISOWeek } from 'date-fns';
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
