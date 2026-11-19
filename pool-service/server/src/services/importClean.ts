import type { Address, CustomerStatus, EquipmentKind, PaymentMethod, ServiceDay } from '@pool/shared';
import { cellText, type Cell } from './importRead.js';

/**
 * Turning spreadsheet cells into the app's values. Each cleaner returns `undefined` for an empty
 * cell, `{ ok: value }` when it understood the cell, or `{ bad: text }` when it didn't (the caller
 * keeps that text in the customer's notes, so nothing from the file is lost).
 */
export type Clean<T> = undefined | { ok: T } | { bad: string };
const empty = (c: Cell) => c === null || (typeof c === 'string' && c.trim() === '');
const bad = (c: Cell): { bad: string } => ({ bad: cellText(c) });

export function cleanText(c: Cell): Clean<string> {
  if (empty(c)) return undefined;
  return { ok: cellText(c) };
}

/** "$1,200.50", "15,000 gal", "12 mi", "15k" → number. */
export function cleanNumber(c: Cell, opts: { min?: number; positive?: boolean } = {}): Clean<number> {
  if (empty(c)) return undefined;
  let n: number;
  if (typeof c === 'number') n = c;
  else {
    let s = cellText(c).toLowerCase().replace(/[$,\s]/g, '').replace(/(gallons?|gals?|miles?|mi|usd|\/mo(nth)?|permonth|monthly)$/, '');
    let factor = 1;
    if (/^\d+(\.\d+)?k$/.test(s)) {
      factor = 1000;
      s = s.slice(0, -1);
    }
    if (!/^-?\d+(\.\d+)?$/.test(s)) return bad(c);
    n = Number(s) * factor;
  }
  if (!Number.isFinite(n) || (opts.min !== undefined && n < opts.min) || (opts.positive && n <= 0)) return bad(c);
  return { ok: Math.round(n * 100) / 100 };
}

const utcDay = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
};
/** Date-only values are stored at midnight UTC, like the app's date fields. US order (M/D/Y) for slashes. */
export function cleanDate(c: Cell): Clean<Date> {
  if (empty(c)) return undefined;
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? bad(c) : { ok: utcDay(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate())! };
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    // An Excel day number that arrived as a plain number.
    const dt = new Date(Date.UTC(1899, 11, 30) + c * 86_400_000);
    return { ok: utcDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())! };
  }
  const s = cellText(c);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = utcDay(+m[1]!, +m[2]!, +m[3]!);
    return d ? { ok: d } : bad(c);
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! - (+m[3]! > 69 ? 100 : 0) : +m[3]!;
    const d = utcDay(y, +m[1]!, +m[2]!);
    return d ? { ok: d } : bad(c);
  }
  const t = Date.parse(`${s} 12:00 UTC`);
  if (!Number.isNaN(t) && /[a-z]{3}/i.test(s)) {
    const dt = new Date(t);
    return { ok: utcDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())! };
  }
  return bad(c);
}

export function cleanEmail(c: Cell): Clean<string> {
  if (empty(c)) return undefined;
  const s = cellText(c).toLowerCase().replace(/^mailto:/, '');
  return /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/.test(s) ? { ok: s } : bad(c);
}

/** US numbers: 10 digits → +1…; "+" numbers kept. One cell may hold several ("mobile: …; home: …"). */
export function cleanPhones(c: Cell, headerLabel: string): { ok: { label: string; number: string }[]; bad: string[] } | undefined {
  if (empty(c)) return undefined;
  const out: { label: string; number: string }[] = [];
  const bads: string[] = [];
  const text = typeof c === 'number' ? String(Math.round(c)) : cellText(c);
  for (const part of text.split(/[;,/\n]|\s+or\s+/i).map((p) => p.trim()).filter(Boolean)) {
    const lm = part.match(/^([a-z][a-z ]{0,15}):\s*(.+)$/i);
    const label = (lm?.[1] ?? headerLabel).trim().toLowerCase();
    const raw = (lm?.[2] ?? part).replace(/\s*(x|ext\.?|extension)\s*\d+$/i, '');
    const digits = raw.replace(/\D/g, '');
    let number: string | null = null;
    if (raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') number = `+${digits}`;
    else if (digits.length === 10 && /^[2-9]/.test(digits)) number = `+1${digits}`;
    else if (digits.length === 11 && digits[0] === '1') number = `+${digits}`;
    if (number) out.push({ label, number });
    else bads.push(part);
  }
  return { ok: out, bad: bads };
}
/** Label for phones from a column's header: "Cell phone" → mobile, "Home" → home, … */
export function phoneLabel(header: string): string {
  const h = header.toLowerCase();
  if (/cell|mobile/.test(h)) return 'mobile';
  if (/home/.test(h)) return 'home';
  if (/work|office|business/.test(h)) return 'work';
  if (/alt|second|other/.test(h)) return 'other';
  return 'mobile';
}
export const prettyPhone = (n: string) => (/^\+1\d{10}$/.test(n) ? `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : n);

const DAY_WORDS: [RegExp, ServiceDay][] = [
  [/^(mon(day)?|mo|m)$/, 'mon'],
  [/^(tue(s(day)?)?|tu|t)$/, 'tue'],
  [/^(wed(nesday)?|we|w)$/, 'wed'],
  [/^(thu(r(s(day)?)?)?|th|r)$/, 'thu'],
  [/^(fri(day)?|fr|f)$/, 'fri'],
  [/^(sat(urday)?|sa)$/, 'sat'],
  [/^(sun(day)?|su|u)$/, 'sun'],
];
/** "Monday", "Mon", "M", "every tuesday" → day. Several days → the first, with `extra` set. */
export function cleanDay(c: Cell): undefined | { bad: string } | { ok: ServiceDay; extra?: boolean } {
  if (empty(c)) return undefined;
  const words = cellText(c).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const days = words.map((w) => DAY_WORDS.find(([re]) => re.test(w))?.[1]).filter((d): d is ServiceDay => !!d);
  if (!days.length) return bad(c);
  return new Set(days).size > 1 ? { ok: days[0]!, extra: true } : { ok: days[0]! };
}

export function cleanPoolType(c: Cell): Clean<'salt' | 'chlorine'> {
  if (empty(c)) return undefined;
  const s = cellText(c).toLowerCase();
  if (/salt|swg|generator/.test(s)) return { ok: 'salt' };
  if (/chlor|bleach|tab|liquid|trichlor/.test(s)) return { ok: 'chlorine' };
  return bad(c);
}

export function cleanStatus(c: Cell): Clean<CustomerStatus> {
  if (empty(c)) return undefined;
  if (typeof c === 'boolean') return { ok: c ? 'current' : 'past' };
  const s = cellText(c).toLowerCase();
  if (/^(current|active|yes|y|true|1|customer|weekly|regular)$/.test(s)) return { ok: 'current' };
  if (/^(prospect|lead|potential|quote|quoted|estimate|new lead)$/.test(s)) return { ok: 'prospect' };
  if (/^(past|former|inactive|no|n|false|0|cancel+ed|canceled|ended|lost|old)$/.test(s)) return { ok: 'past' };
  return bad(c);
}

/** Pays by. Card, ACH, Zelle, Venmo… are all "electronic"; anything else is "other" (the text goes to notes). */
export function cleanPayment(c: Cell): undefined | { ok: PaymentMethod; note?: string } {
  if (empty(c)) return undefined;
  const s = cellText(c).toLowerCase();
  if (/che(ck|que)/.test(s)) return { ok: 'check' };
  if (/^cash$/.test(s)) return { ok: 'cash' };
  if (/card|credit|debit|ach|zelle|venmo|paypal|cash ?app|transfer|online|electronic|auto ?pay|bank|stripe|square/.test(s)) return { ok: 'electronic' };
  return { ok: 'other', note: cellText(c) };
}

export function cleanYesNo(c: Cell): Clean<boolean> {
  if (empty(c)) return undefined;
  if (typeof c === 'boolean') return { ok: c };
  const s = cellText(c).toLowerCase();
  if (/^(yes|y|true|1|active|x|on)$/.test(s)) return { ok: true };
  if (/^(no|n|false|0|inactive|off|closed)$/.test(s)) return { ok: false };
  return bad(c);
}

/** "12 Oak St, Apt 2, Dallas, TX 75201" → parts. A single part is the street. */
export function cleanAddress(c: Cell): Clean<Address> {
  if (empty(c)) return undefined;
  const parts = cellText(c).split(/\s*[,\n]\s*/).filter(Boolean);
  const a: Address = {};
  if (parts.length > 1) {
    const last = parts[parts.length - 1]!;
    const stateZip = last.match(/^([A-Za-z]{2})?\s*(\d{5}(?:-\d{4})?)?$/);
    const cityStateZip = last.match(/^(.*\S)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (stateZip && (stateZip[1] || stateZip[2])) {
      a.state = stateZip[1]?.toUpperCase();
      a.zip = stateZip[2];
      parts.pop();
    } else if (cityStateZip) {
      a.city = cityStateZip[1];
      a.state = cityStateZip[2]!.toUpperCase();
      a.zip = cityStateZip[3];
      parts.pop();
    }
    if (!a.city && parts.length > 1) a.city = parts.pop();
  }
  a.line1 = parts.shift();
  if (parts.length) a.line2 = parts.join(', ');
  return { ok: Object.fromEntries(Object.entries(a).filter(([, v]) => v)) as Address };
}

export const EQUIPMENT_FROM_FIELD: Record<string, EquipmentKind> = {
  'equipment.pump': 'pump', 'equipment.filter': 'filter', 'equipment.heater': 'heater', 'equipment.saltCell': 'saltCell',
  'equipment.cleaner': 'cleaner', 'equipment.automation': 'automation', 'equipment.lights': 'lights', 'equipment.timer': 'timer',
};
