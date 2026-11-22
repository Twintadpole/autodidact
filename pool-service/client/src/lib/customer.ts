import { locale, t, translated, translatedOptions } from '@/i18n';
import type { CustomerStatus, EquipmentKind, PaymentMethod } from '@pool/shared';

export const STATUS_LABEL: Record<CustomerStatus, string> = translated({ current: 'Current', prospect: 'Prospect', past: 'Past' });
export const STATUS_COLOR: Record<CustomerStatus, string> = { current: 'positive', prospect: 'blue-7', past: 'grey-7' };
export const STATUS_OPTIONS = translatedOptions((['current', 'prospect', 'past'] as const).map((value) => ({ label: { current: 'Current', prospect: 'Prospect', past: 'Past' }[value], value })));

export const PAYMENT_LABEL: Record<PaymentMethod, string> = translated({ check: 'Check', cash: 'Cash', electronic: 'Electronic', other: 'Other' });
export const PAYMENT_OPTIONS = translatedOptions((['check', 'cash', 'electronic', 'other'] as const).map((value) => ({ label: ({ check: 'Check', cash: 'Cash', electronic: 'Electronic', other: 'Other' } as const)[value], value })));

/** Ready-made equipment slots, in the order the pool screen lists them. "other" is the custom "+ Add equipment". */
export const EQUIPMENT_LABEL: Record<EquipmentKind, string> = translated({
  pump: 'Pump',
  filter: 'Filter',
  heater: 'Heater',
  saltCell: 'Salt cell / chlorinator',
  cleaner: 'Cleaner',
  automation: 'Automation',
  lights: 'Lights',
  timer: 'Timer',
  other: 'Other equipment',
});
export const EQUIPMENT_ICON: Record<EquipmentKind, string> = {
  pump: 'settings_input_component',
  filter: 'filter_alt',
  heater: 'local_fire_department',
  saltCell: 'science',
  cleaner: 'cleaning_services',
  automation: 'settings_remote',
  lights: 'lightbulb',
  timer: 'schedule',
  other: 'build',
};
export const EQUIPMENT_SLOTS = ['pump', 'filter', 'heater', 'saltCell', 'cleaner', 'automation', 'lights', 'timer'] as const;

/** "$150.00" */
export const money = (n: number) => n.toLocaleString(locale.value, { style: 'currency', currency: 'USD' });

/** Address form fields → stored address with only the filled parts; undefined when nothing but the default state is filled. */
export function cleanAddress(a: { line1: string; line2: string; city: string; state: string; zip: string }) {
  const out = Object.fromEntries(
    (['line1', 'line2', 'city', 'state', 'zip'] as const).map((k) => [k, (a[k] ?? '').trim()]).filter(([, v]) => v),
  ) as { line1?: string; line2?: string; city?: string; state?: string; zip?: string };
  const meaningful = out.line1 || out.line2 || out.city || out.zip;
  return meaningful ? out : undefined;
}

/** "2026-11-01" from a stored date (no time-zone shift). */
export const dateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

/** A typed number, or null when blank or not a number. */
export function numberOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const looksLikeEmail = (v: string) => EMAIL.test(v.trim());

/** "Tuesday", "One-time · Thu Nov 20" or "Not scheduled". */
export function scheduleText(p: { serviceDay?: import('@pool/shared').ServiceDay | null; oneTimeDate?: string | null }, dayLabels: Record<string, string>): string {
  if (p.serviceDay) return dayLabels[p.serviceDay]!;
  if (p.oneTimeDate) {
    const [y, m, d] = p.oneTimeDate.slice(0, 10).split('-').map(Number);
    return t('One-time · {date}', { date: new Date(y!, m! - 1, d!).toLocaleDateString(locale.value, { weekday: 'short', month: 'short', day: 'numeric' }) });
  }
  return t('Not scheduled');
}
