import { z } from 'zod';

/**
 * Customer & pool import (GPF item 2). A spreadsheet (Excel or CSV) has one row per pool; each
 * column is matched to one of these fields (or ignored). Rows for the same customer become one
 * customer with several pools. Nothing is required: unreadable values go into the customer's notes.
 */
export const IMPORT_FIELD_GROUPS = ['customer', 'pool', 'equipment'] as const;

interface FieldDef {
  key: string;
  group: (typeof IMPORT_FIELD_GROUPS)[number];
  label: string;
  /** Lowercase header words that suggest this field (whole header, spaces/punctuation removed). */
  guess: string[];
  /** Several columns may feed it (phones, notes). */
  multi?: boolean;
  /** Not offered in the column menu (set by the app's own export only). */
  hidden?: boolean;
}

export const IMPORT_FIELDS = [
  { key: 'customer.key', group: 'customer', label: 'Customer ID (groups rows)', guess: ['customerid', 'accountid', 'account', 'accountnumber', 'customernumber', 'clientid', 'id'] },
  { key: 'customer.name', group: 'customer', label: 'Customer name', guess: ['name', 'customer', 'customername', 'client', 'clientname', 'fullname', 'displayname', 'contact', 'contactname'] },
  { key: 'customer.firstName', group: 'customer', label: 'First name', guess: ['first', 'firstname', 'givenname', 'fname'] },
  { key: 'customer.lastName', group: 'customer', label: 'Last name', guess: ['last', 'lastname', 'surname', 'familyname', 'lname'] },
  { key: 'customer.company', group: 'customer', label: 'Company', guess: ['company', 'companyname', 'business', 'organization', 'hoa'] },
  { key: 'customer.phone', group: 'customer', label: 'Phone', multi: true, guess: ['phone', 'phones', 'phonenumber', 'mobile', 'cell', 'cellphone', 'mobilephone', 'homephone', 'workphone', 'telephone', 'tel', 'primaryphone', 'secondaryphone', 'altphone'] },
  { key: 'customer.email', group: 'customer', label: 'Email', guess: ['email', 'emailaddress', 'mail', 'primaryemail'] },
  { key: 'customer.address', group: 'customer', label: 'Address (all in one)', guess: ['address', 'fulladdress', 'serviceaddress', 'billingaddress', 'location'] },
  { key: 'customer.line1', group: 'customer', label: 'Street', guess: ['street', 'address1', 'addressline1', 'streetaddress', 'line1'] },
  { key: 'customer.line2', group: 'customer', label: 'Street line 2', guess: ['address2', 'addressline2', 'line2', 'unit', 'apt', 'suite'] },
  { key: 'customer.city', group: 'customer', label: 'City', guess: ['city', 'town'] },
  { key: 'customer.state', group: 'customer', label: 'State', guess: ['state', 'st', 'province', 'region'] },
  { key: 'customer.zip', group: 'customer', label: 'ZIP', guess: ['zip', 'zipcode', 'postalcode', 'postcode', 'postal'] },
  { key: 'customer.notes', group: 'customer', label: 'Notes', multi: true, guess: ['notes', 'note', 'comments', 'comment', 'remarks', 'customernotes'] },
  { key: 'customer.status', group: 'customer', label: 'Class (current/prospect/past)', guess: ['class', 'status', 'customerstatus', 'active', 'customertype'] },
  { key: 'customer.monthlyRate', group: 'customer', label: 'Monthly rate', guess: ['monthlyrate', 'rate', 'price', 'monthlyprice', 'monthlyfee', 'servicerate', 'amount', 'monthly'] },
  { key: 'customer.billingEmail', group: 'customer', label: 'Billing email', guess: ['billingemail', 'invoiceemail'] },
  { key: 'customer.paymentMethod', group: 'customer', label: 'Pays by', guess: ['paysby', 'paymentmethod', 'payment', 'paymenttype', 'paidby'] },
  { key: 'customer.startDate', group: 'customer', label: 'Service started', guess: ['servicestarted', 'startdate', 'start', 'since', 'customersince', 'startedon'] },
  { key: 'customer.endDate', group: 'customer', label: 'Service ended', guess: ['serviceended', 'enddate', 'end', 'cancelled', 'canceldate', 'endedon'] },
  { key: 'customer.distanceMiles', group: 'customer', label: 'Miles from HQ', guess: ['milesfromhq', 'miles', 'distance', 'distancemiles'] },
  { key: 'pool.name', group: 'pool', label: 'Pool name', guess: ['pool', 'poolname', 'body', 'bodyofwater', 'waterbody'] },
  { key: 'pool.address', group: 'pool', label: 'Pool address (all in one)', guess: ['pooladdress', 'addressifnotthecustomers', 'addressifnotthecustomer'] },
  { key: 'pool.line1', group: 'pool', label: 'Pool street', guess: ['poolstreet'] },
  { key: 'pool.line2', group: 'pool', label: 'Pool street line 2', guess: [] },
  { key: 'pool.city', group: 'pool', label: 'Pool city', guess: ['poolcity'] },
  { key: 'pool.state', group: 'pool', label: 'Pool state', guess: ['poolstate'] },
  { key: 'pool.zip', group: 'pool', label: 'Pool ZIP', guess: ['poolzip'] },
  { key: 'pool.type', group: 'pool', label: 'Pool type (salt/chlorine)', guess: ['pooltype', 'type', 'sanitizer', 'chlorinetype', 'saltorchlorine', 'salt'] },
  { key: 'pool.surface', group: 'pool', label: 'Surface', guess: ['surface', 'finish', 'poolsurface', 'interior'] },
  { key: 'pool.volumeGal', group: 'pool', label: 'Gallons', guess: ['gallons', 'volume', 'gal', 'size', 'poolsize', 'poolvolume', 'volumegal', 'volumegallons'] },
  { key: 'pool.serviceDay', group: 'pool', label: 'Service day', guess: ['serviceday', 'day', 'routeday', 'weekday', 'scheduledday', 'dayofweek'] },
  { key: 'pool.oneTimeDate', group: 'pool', label: 'One-time date', guess: ['onetimedate', 'onetime', 'jobdate', 'scheduleddate'] },
  { key: 'pool.routeOrder', group: 'pool', label: 'Stop #', guess: ['stop', 'stopnumber', 'routeorder', 'order', 'sequence', 'stopno'] },
  { key: 'pool.accessNotes', group: 'pool', label: 'Access notes / gate code', multi: true, guess: ['accessnotes', 'access', 'gatecode', 'gate', 'code', 'lockbox', 'dog', 'dogs', 'entry', 'directions'] },
  { key: 'pool.active', group: 'pool', label: 'Active (yes/no)', guess: ['poolactive', 'activepool'] },
  { key: 'pool.equipmentList', group: 'pool', label: 'Equipment (from the app’s export)', hidden: true, guess: [] },
  { key: 'equipment.pump', group: 'equipment', label: 'Pump', guess: ['pump', 'pumpmodel'] },
  { key: 'equipment.filter', group: 'equipment', label: 'Filter', guess: ['filter', 'filtermodel', 'filtertype'] },
  { key: 'equipment.heater', group: 'equipment', label: 'Heater', guess: ['heater', 'heatermodel', 'heatpump'] },
  { key: 'equipment.saltCell', group: 'equipment', label: 'Salt cell / chlorinator', guess: ['saltcell', 'cell', 'chlorinator', 'saltsystem'] },
  { key: 'equipment.cleaner', group: 'equipment', label: 'Cleaner', guess: ['cleaner', 'poolcleaner', 'robot'] },
  { key: 'equipment.automation', group: 'equipment', label: 'Automation', guess: ['automation', 'controller', 'controls'] },
  { key: 'equipment.lights', group: 'equipment', label: 'Lights', guess: ['lights', 'light', 'lighting'] },
  { key: 'equipment.timer', group: 'equipment', label: 'Timer', guess: ['timer', 'timeclock'] },
] as const satisfies readonly FieldDef[];

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key'];
export const IMPORT_FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key) as [ImportFieldKey, ...ImportFieldKey[]];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Best guess for each header; unknown columns go to notes so nothing is lost. Each single field is used once. */
export function guessMapping(headers: string[]): (ImportFieldKey | null)[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const s = squash(h);
    if (!s) return null;
    const hit = IMPORT_FIELDS.find((f) => !('hidden' in f) && (f.guess as readonly string[]).includes(s) && (('multi' in f && f.multi) || !used.has(f.key)));
    if (hit) {
      used.add(hit.key);
      return hit.key;
    }
    return 'customer.notes';
  });
}

export const importOptionsSchema = z.object({
  /** Which sheet of an Excel file (index). */
  sheet: z.number().int().min(0).default(0),
  /** One entry per column: the field it fills, or null to ignore it. */
  mapping: z.array(z.enum(IMPORT_FIELD_KEYS).nullable()).max(200),
  /** Conflict ids (from the preview) where the file's value should replace what's stored. */
  take: z.array(z.string().max(200)).max(20_000).default([]),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;

export interface ImportSheet {
  name: string;
  headers: string[];
  rowCount: number;
  /** First rows, as text, for the column-matching screen. */
  sample: string[][];
}
export interface ImportReadResult {
  fileName: string;
  /** "app" = the app's own Export everything workbook (columns are matched automatically). */
  kind: 'table' | 'app';
  sheets: ImportSheet[];
  mapping: (ImportFieldKey | null)[];
}

export interface ImportFieldChange {
  path: string;
  label: string;
  from: unknown;
  to: unknown;
}
export interface ImportConflict extends ImportFieldChange {
  /** Send it back in `take` to use the file's value. */
  id: string;
}
export interface ImportPlanPool {
  action: 'new' | 'merge' | 'same';
  name: string;
  changes: ImportFieldChange[];
  conflicts: ImportConflict[];
}
export interface ImportPlanCustomer {
  action: 'new' | 'merge' | 'same';
  name: string;
  /** For merges: how it was matched to the stored customer. */
  matchedBy?: 'name and street' | 'name' | 'email' | 'phone';
  rows: number[];
  changes: ImportFieldChange[];
  conflicts: ImportConflict[];
  pools: ImportPlanPool[];
}
export interface ImportSummary {
  rows: number;
  skippedRows: number;
  customersNew: number;
  customersMerged: number;
  poolsNew: number;
  poolsMerged: number;
  conflicts: number;
  warnings: number;
}
export interface ImportPreview {
  summary: ImportSummary;
  customers: ImportPlanCustomer[];
  warnings: { row: number | null; message: string }[];
}
export interface ImportApplyResult {
  importId: string;
  summary: ImportSummary;
}
export interface ImportRecord {
  _id: string;
  at: string;
  fileName: string;
  summary: ImportSummary;
  undoneAt: string | null;
  undo?: { hidden: number; restored: number; kept: number };
}
