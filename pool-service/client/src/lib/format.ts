import { format, isToday, isYesterday, parseISO } from 'date-fns';
import type { ServiceDay } from '@pool/shared';
import type { Address, Customer, Pool } from './types';

export const DAY_LABELS: Record<ServiceDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export function addressText(a: Address | undefined): string {
  if (!a) return '';
  return [a.line1, a.line2, `${a.city}, ${a.state} ${a.zip}`].filter(Boolean).join(', ');
}

/** The pool's own address if set, otherwise the customer's. */
export function poolAddress(pool: Pool, customer: Customer | undefined): Address | undefined {
  return pool.address ?? customer?.address;
}

/** Google Maps turn-by-turn directions to an address. */
export function mapsUrl(a: Address | undefined): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressText(a))}`;
}

export const telHref = (e164: string) => `tel:${e164}`;
export const smsHref = (e164: string) => `sms:${e164}`;

/** +15125550123 → (512) 555-0123; other countries are shown as stored. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Accepts "512 555 0123", "(512) 555-0123", "+44 20…"; US numbers get +1. Returns null if not valid. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseISO(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

export function longDate(iso: string | null | undefined): string {
  return iso ? format(parseISO(iso), 'EEE, MMM d, yyyy') : '';
}

export function fmtNumber(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

export function newId(): string {
  return crypto.randomUUID();
}
