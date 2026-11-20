import { apiDownload, saveBlob } from '@/stores/api';
import { localDate } from './money';

/** How a column comes out in Excel (Phase 7E). */
export type ExportType = 'text' | 'number' | 'money' | 'date' | 'datetime' | 'yesno';
export type ExportValue = string | number | boolean | null;
export interface ExportTable {
  /** File name, without the date or extension. */
  name: string;
  columns: { label: string; type?: ExportType }[];
  rows: ExportValue[][];
}

const today = () => localDate(new Date());

/** CSV, made on this device (works offline). Numbers stay plain so a spreadsheet can add them up. */
export function exportCsv(t: ExportTable) {
  const cell = (v: ExportValue) => {
    const s = v == null ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [t.columns.map((c) => cell(c.label)).join(','), ...t.rows.map((r) => r.map(cell).join(','))].join('\r\n');
  saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${t.name}-${today()}.csv`);
}

/** Excel, made by the server from these rows (needs a connection). */
export function exportXlsx(t: ExportTable) {
  return apiDownload('/export/table.xlsx', { name: `${t.name}-${today()}`, sheet: t.name, columns: t.columns.map((c) => ({ header: c.label, ...(c.type && { type: c.type }) })), rows: t.rows });
}

/** Everything the business has, one sheet per kind (needs a connection). */
export function exportEverything() {
  return apiDownload(`/export/everything.xlsx?tzOffsetMin=${new Date().getTimezoneOffset()}`);
}

/** An ISO moment → "2026-11-18 14:20" in this device's time (what Excel should show). */
export function localDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${localDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
