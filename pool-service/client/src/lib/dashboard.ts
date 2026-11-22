import { locale, translated } from '@/i18n';
import type { CardSize, DashboardLayout } from '@pool/shared';

/**
 * The dashboard's cards (Phase 7D). Ids are stored in the owner's layout, so never rename one.
 * `range` and `customer`: the full-screen tools this card understands.
 */
export const CARDS = [
  { id: 'week', title: 'Today & this week', icon: 'checklist', size: 'm', range: false, customer: false },
  { id: 'money', title: 'Money by month', icon: 'account_balance_wallet', size: 'l', range: true, customer: false },
  { id: 'owed', title: 'Owed to you', icon: 'request_quote', size: 'm', range: false, customer: true },
  { id: 'hourly', title: 'Per hour, by customer', icon: 'timer', size: 'l', range: false, customer: false },
  { id: 'chemicals', title: 'Chemical costs', icon: 'science', size: 'm', range: true, customer: true },
  { id: 'issues', title: 'Open issues', icon: 'report_problem', size: 's', range: false, customer: true },
  { id: 'water', title: 'Water problems', icon: 'water_drop', size: 'm', range: true, customer: true },
  { id: 'pipeline', title: 'Customers', icon: 'groups', size: 'm', range: true, customer: false },
  { id: 'visitTimes', title: 'Visit times', icon: 'schedule', size: 'm', range: true, customer: true },
  { id: 'mileage', title: 'Mileage', icon: 'directions_car', size: 's', range: true, customer: false },
  { id: 'equipment', title: 'Equipment age', icon: 'build', size: 'm', range: false, customer: true },
  { id: 'system', title: 'System', icon: 'dns', size: 's', range: false, customer: false },
] as const satisfies readonly { id: string; title: string; icon: string; size: CardSize; range: boolean; customer: boolean }[];
export type CardId = (typeof CARDS)[number]['id'];
export const CARD_BY_ID = new Map<string, (typeof CARDS)[number]>(CARDS.map((c) => [c.id, c]));

export const SIZE_LABEL: Record<CardSize, string> = translated({ s: 'Small', m: 'Medium', l: 'Large', xl: 'Full width' });

export const defaultLayout = (): DashboardLayout => ({ cards: CARDS.map((c) => ({ id: c.id, size: c.size })) });

/**
 * The saved layout with any cards it doesn't mention added at the end (new cards after an update).
 * Ids this app doesn't know are kept in the saved layout but not shown.
 */
export function withAllCards(saved: DashboardLayout | null): DashboardLayout {
  const cards = [...(saved?.cards ?? [])];
  for (const c of CARDS) if (!cards.some((x) => x.id === c.id)) cards.push({ id: c.id, size: c.size, ...(saved && { hidden: false }) });
  return { cards };
}

/** Grid cells a size takes: columns (clamped to what fits) and rows. */
export function span(size: CardSize, cols: number): { c: number; r: number } {
  const want = { s: { c: 1, r: 1 }, m: { c: 2, r: 1 }, l: { c: 2, r: 2 }, xl: { c: cols, r: 2 } }[size];
  return { c: Math.min(want.c, cols), r: want.r };
}

/** How much a card shows, from its real size: small (a few figures), medium (a chart), large (chart + table/list). */
export type CardMode = 's' | 'm' | 'l';
export function cardMode(width: number, height: number): CardMode {
  if (height >= 330) return 'l';
  return width < 440 ? 's' : 'm';
}

/** "Nov 18, 3:05 PM": when remembered figures were loaded. */
export const asOf = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale.value, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
