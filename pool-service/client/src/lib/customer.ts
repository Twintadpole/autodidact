import type { CustomerStatus, EquipmentKind, PaymentMethod } from '@pool/shared';

export const STATUS_LABEL: Record<CustomerStatus, string> = { current: 'Current', prospect: 'Prospect', past: 'Past' };
export const STATUS_COLOR: Record<CustomerStatus, string> = { current: 'positive', prospect: 'blue-7', past: 'grey-7' };
export const STATUS_OPTIONS = (['current', 'prospect', 'past'] as const).map((value) => ({ label: STATUS_LABEL[value], value }));

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { check: 'Check', cash: 'Cash', electronic: 'Electronic', other: 'Other' };
export const PAYMENT_OPTIONS = (['check', 'cash', 'electronic', 'other'] as const).map((value) => ({ label: PAYMENT_LABEL[value], value }));

/** Ready-made equipment slots, in the order the pool screen lists them. "other" is the custom "+ Add equipment". */
export const EQUIPMENT_LABEL: Record<EquipmentKind, string> = {
  pump: 'Pump',
  filter: 'Filter',
  heater: 'Heater',
  saltCell: 'Salt cell / chlorinator',
  cleaner: 'Cleaner',
  automation: 'Automation',
  lights: 'Lights',
  timer: 'Timer',
  other: 'Other equipment',
};
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
export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

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
