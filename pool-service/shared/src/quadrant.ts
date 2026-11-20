/**
 * Eisenhower quadrant, derived from an issue's flags (never stored).
 *   urgent + important → Do now
 *   important only     → Schedule
 *   urgent only        → Quick fix
 *   neither            → Someday
 */
export const QUADRANTS = [
  { key: 'do_now', label: 'Do now', urgent: true, important: true },
  { key: 'schedule', label: 'Schedule', urgent: false, important: true },
  { key: 'quick_fix', label: 'Quick fix', urgent: true, important: false },
  { key: 'someday', label: 'Someday', urgent: false, important: false },
] as const;

export type QuadrantKey = (typeof QUADRANTS)[number]['key'];

export function deriveQuadrant(flags: { urgent: boolean; important: boolean }): QuadrantKey {
  if (flags.urgent && flags.important) return 'do_now';
  if (flags.important) return 'schedule';
  if (flags.urgent) return 'quick_fix';
  return 'someday';
}
