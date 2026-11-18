import { inject, provide, reactive, type InjectionKey } from 'vue';

/** How money is shown: $1,234.56, $1,235 or $1.2k. */
export type NumberFormat = 'exact' | 'whole' | 'short';

export interface TableExport {
  /** File name without extension. */
  name: string;
  columns: { key: string; label: string }[];
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
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', ...(f === 'whole' && { minimumFractionDigits: 0, maximumFractionDigits: 0 }) });
}

/** A CSV file of a table (raw numbers, so a spreadsheet can add them up), downloaded by the browser. */
export function downloadCsv(t: TableExport, hidden: string[] = []) {
  const cols = t.columns.filter((c) => !hidden.includes(c.key));
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.map((c) => cell(c.label)).join(','), ...t.rows.map((r) => cols.map((c) => cell(r[c.key])).join(','))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t.name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
