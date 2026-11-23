import { locale } from '@/i18n';
import { inject, provide, reactive, type InjectionKey } from 'vue';

/** How money is shown: $1,234.56, $1,235 or $1.2k. */
export type NumberFormat = 'exact' | 'whole' | 'short';

export interface TableExport {
  /** File name without extension. */
  name: string;
  columns: { key: string; label: string; money?: boolean }[];
  rows: Record<string, unknown>[];
}

/**
 * Tools of a card opened full screen (Phase 7D): date range, customer filter, number format, chart zoom,
 * columns to hide and export. Cards on the dashboard get the defaults.
 */
export interface DashTools {
  /** Months back from this one, for cards with a time range. */
  months: number;
  customerId: string | null;
  format: NumberFormat;
  zoom: boolean;
  hiddenCols: string[];
  /** The table the card is showing, for Columns and Export. */
  table: TableExport | null;
}

const KEY: InjectionKey<DashTools> = Symbol('dash-tools');

export function newDashTools(): DashTools {
  return reactive({ months: 12, customerId: null, format: 'exact', zoom: false, hiddenCols: [], table: null });
}

/** The full-screen dialog provides its tools to the card inside it. */
export function provideDashTools(tools: DashTools) {
  provide(KEY, tools);
}

/** A card's tools: the full-screen ones, or the dashboard defaults. */
export function useDashTools(): DashTools {
  return inject(KEY, () => newDashTools(), true);
}

/** Money in the chosen format. */
export function formatMoney(v: number, f: NumberFormat): string {
  if (f === 'short') {
    const a = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (a >= 1_000_000) return `${sign}$${Math.round(a / 100_000) / 10}M`;
    if (a >= 1000) return `${sign}$${Math.round(a / 100) / 10}k`;
    return `${sign}$${Math.round(a)}`;
  }
  return v.toLocaleString(locale.value, { style: 'currency', currency: 'USD', ...(f === 'whole' && { minimumFractionDigits: 0, maximumFractionDigits: 0 }) });
}
