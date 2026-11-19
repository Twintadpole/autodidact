import ExcelJS from 'exceljs';
import { guessMapping, type ImportFieldKey, type ImportReadResult } from '@pool/shared';
import { HttpError } from '../util.js';

/** A spreadsheet cell after reading: Excel keeps numbers and dates; CSV is all text. */
export type Cell = string | number | boolean | Date | null;
export interface Table {
  name: string;
  headers: string[];
  /** Data rows (header row excluded, empty rows dropped), each with its spreadsheet row number. */
  rows: { row: number; cells: Cell[] }[];
}
export interface ReadFile {
  kind: 'table' | 'app';
  tables: Table[];
  /** For the app's own export: the fixed column matching of its combined table. */
  mapping?: (ImportFieldKey | null)[];
}

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
const MAX_COLUMNS = 200;

const isEmpty = (c: Cell) => c === null || (typeof c === 'string' && c.trim() === '');
export const cellText = (c: Cell): string =>
  c === null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : typeof c === 'boolean' ? (c ? 'Yes' : 'No') : String(c).trim();

// ---------------------------------------------------------------- CSV
/** RFC 4180 CSV with quotes; the delimiter (comma, semicolon or tab) is taken from the first line. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- Excel
function excelCell(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return excelCell((v.result ?? null) as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    if ('error' in v) return null;
  }
  return String(v);
}

function toTable(name: string, grid: { row: number; cells: Cell[] }[]): Table {
  const nonEmpty = grid.filter((r) => r.cells.some((c) => !isEmpty(c)));
  const [head, ...data] = nonEmpty;
  if (!head) return { name, headers: [], rows: [] };
  const width = Math.min(MAX_COLUMNS, Math.max(...nonEmpty.map((r) => r.cells.length)));
  const headers = Array.from({ length: width }, (_, i) => cellText(head.cells[i] ?? null) || `Column ${i + 1}`);
  const rows = data.map((r) => ({ row: r.row, cells: Array.from({ length: width }, (_, i) => r.cells[i] ?? null) }));
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(413, `"${name}" has ${rows.length} rows; the limit is ${MAX_IMPORT_ROWS}. Split the file.`);
  return { name, headers, rows };
}

async function readExcel(buf: Buffer): Promise<Table[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  } catch {
    throw new HttpError(400, 'This file could not be read as Excel (.xlsx). Save it as .xlsx or CSV and try again.');
  }
  const tables: Table[] = [];
  wb.eachSheet((ws) => {
    const grid: { row: number; cells: Cell[] }[] = [];
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      const cells: Cell[] = [];
      r.eachCell({ includeEmpty: true }, (c, col) => {
        if (col <= MAX_COLUMNS) cells[col - 1] = excelCell(c.value);
      });
      grid.push({ row: n, cells: Array.from(cells, (c) => c ?? null) });
    });
    tables.push(toTable(ws.name, grid));
  });
  return tables;
}

// ---------------------------------------------------------------- the app's own export
const APP_HEADERS = [
  ['Name', 'customer.name'],
  ['Class', 'customer.status'],
  ['Phones', 'customer.phone'],
  ['Email', 'customer.email'],
  ['Address', 'customer.address'],
  ['Monthly rate', 'customer.monthlyRate'],
  ['Billing email', 'customer.billingEmail'],
  ['Pays by', 'customer.paymentMethod'],
  ['Service started', 'customer.startDate'],
  ['Service ended', 'customer.endDate'],
  ['Miles from HQ', 'customer.distanceMiles'],
  ['Notes', 'customer.notes'],
  ['Pool', 'pool.name'],
  ['Pool address', 'pool.address'],
  ['Type', 'pool.type'],
  ['Surface', 'pool.surface'],
  ['Gallons', 'pool.volumeGal'],
  ['Service day', 'pool.serviceDay'],
  ['One-time date', 'pool.oneTimeDate'],
  ['Stop #', 'pool.routeOrder'],
  ['Active', 'pool.active'],
  ['Access notes', 'pool.accessNotes'],
  ['Equipment', 'pool.equipmentList'],
] as const satisfies readonly (readonly [string, ImportFieldKey])[];

const EQUIPMENT_KIND: Record<string, string> = {
  pump: 'pump', filter: 'filter', heater: 'heater', 'salt cell / chlorinator': 'saltCell', cleaner: 'cleaner',
  automation: 'automation', lights: 'lights', timer: 'timer', other: 'other',
};

function isAppExport(tables: Table[]): boolean {
  const byName = new Map(tables.map((t) => [t.name, t.headers]));
  const c = byName.get('Customers');
  const p = byName.get('Pools');
  return !!c && !!p && c[0] === 'Name' && c[1] === 'Class' && c[2] === 'Phones' && p[0] === 'Customer' && p[1] === 'Pool';
}

/** Customers + Pools + Equipment sheets → one table, one row per pool (customers without pools: one row). */
function combineAppExport(tables: Table[]): Table {
  const sheet = (n: string) => tables.find((t) => t.name === n);
  const customers = sheet('Customers')!;
  const pools = sheet('Pools')!;
  const equipment = sheet('Equipment');
  const col = (t: Table, h: string) => t.headers.indexOf(h);
  const key = (c: Cell) => cellText(c).toLowerCase();

  const equipmentByPool = new Map<string, object[]>();
  if (equipment) {
    for (const r of equipment.rows) {
      const get = (h: string) => r.cells[col(equipment, h)] ?? null;
      const k = `${key(get('Customer'))}|${key(get('Pool'))}`;
      const item = {
        kind: EQUIPMENT_KIND[key(get('Equipment'))] ?? 'other',
        name: cellText(get('Name')) || undefined,
        model: cellText(get('Model')) || undefined,
        serial: cellText(get('Serial')) || undefined,
        installedOn: get('Installed') instanceof Date ? (get('Installed') as Date).toISOString() : cellText(get('Installed')) || undefined,
        notes: cellText(get('Notes')) || undefined,
      };
      equipmentByPool.set(k, [...(equipmentByPool.get(k) ?? []), item]);
    }
  }
  const poolsByCustomer = new Map<string, Table['rows']>();
  for (const r of pools.rows) {
    const k = key(r.cells[0] ?? null);
    poolsByCustomer.set(k, [...(poolsByCustomer.get(k) ?? []), r]);
  }
  const customerCols = APP_HEADERS.slice(0, 12).map(([h]) => col(customers, h));
  const poolCols = ['Pool', 'Address (if not the customer’s)', 'Type', 'Surface', 'Gallons', 'Service day', 'One-time date', 'Stop #', 'Active', 'Access notes'].map((h) => col(pools, h));
  const rows: Table['rows'] = [];
  for (const c of customers.rows) {
    const cust = customerCols.map((i) => (i >= 0 ? (c.cells[i] ?? null) : null));
    const its = poolsByCustomer.get(key(c.cells[0] ?? null)) ?? [];
    if (!its.length) rows.push({ row: c.row, cells: [...cust, ...poolCols.map(() => null), null] });
    for (const p of its) {
      const eq = equipmentByPool.get(`${key(p.cells[0] ?? null)}|${key(p.cells[1] ?? null)}`);
      rows.push({ row: c.row, cells: [...cust, ...poolCols.map((i) => (i >= 0 ? (p.cells[i] ?? null) : null)), eq ? JSON.stringify(eq) : null] });
    }
  }
  return { name: 'Customers + Pools', headers: APP_HEADERS.map(([h]) => h), rows };
}

// ---------------------------------------------------------------- entry points
export async function readImportFile(buf: Buffer, fileName: string): Promise<ReadFile> {
  if (buf.length > MAX_IMPORT_BYTES) throw new HttpError(413, 'The file is larger than 5 MB. Split it into smaller files.');
  const lower = fileName.toLowerCase();
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (lower.endsWith('.xls') && !isZip) throw new HttpError(400, 'Old Excel files (.xls) can’t be read. Save it as .xlsx or CSV and try again.');
  if (isZip || lower.endsWith('.xlsx')) {
    const tables = await readExcel(buf);
    if (isAppExport(tables)) {
      return { kind: 'app', tables: [combineAppExport(tables)], mapping: APP_HEADERS.map(([, k]) => k) };
    }
    const withData = tables.filter((t) => t.headers.length);
    if (!withData.length) throw new HttpError(400, 'The file has no rows.');
    return { kind: 'table', tables: withData };
  }
  const grid = parseCsv(buf.toString('utf8')).map((cells, i) => ({ row: i + 1, cells: cells as Cell[] }));
  const table = toTable(fileName.replace(/\.[^.]+$/, '') || 'CSV', grid);
  if (!table.headers.length) throw new HttpError(400, 'The file has no rows.');
  return { kind: 'table', tables: [table] };
}

export function describeFile(file: ReadFile, fileName: string): ImportReadResult {
  return {
    fileName,
    kind: file.kind,
    sheets: file.tables.map((t) => ({ name: t.name, headers: t.headers, rowCount: t.rows.length, sample: t.rows.slice(0, 20).map((r) => r.cells.map(cellText)) })),
    mapping: file.mapping ?? guessMapping(file.tables[0]!.headers),
  };
}
