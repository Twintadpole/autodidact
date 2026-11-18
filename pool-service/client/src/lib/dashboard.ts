import type { CardSize, DashboardLayout } from '@pool/shared';

/** The dashboard's cards (Phase 7D). More come in the next segment; their ids are stored in the layout. */
export const CARDS = [
  { id: 'week', title: 'Today & this week', icon: 'checklist', size: 'm' },
  { id: 'money', title: 'Money, last 12 months', icon: 'account_balance_wallet', size: 'l' },
  { id: 'owed', title: 'Owed to you', icon: 'request_quote', size: 'm' },
  { id: 'hourly', title: 'Per hour, by customer', icon: 'timer', size: 'l' },
  { id: 'chemicals', title: 'Chemical costs', icon: 'science', size: 'm' },
  { id: 'issues', title: 'Open issues', icon: 'report_problem', size: 's' },
] as const satisfies readonly { id: string; title: string; icon: string; size: CardSize }[];
export type CardId = (typeof CARDS)[number]['id'];
export const CARD_BY_ID = new Map<string, (typeof CARDS)[number]>(CARDS.map((c) => [c.id, c]));

export const SIZE_LABEL: Record<CardSize, string> = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Full width' };

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
