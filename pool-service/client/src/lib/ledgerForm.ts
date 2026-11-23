import { isBillableCategory, type LedgerKind } from '@pool/shared';
import { numberOrNull } from './customer';
import { newId } from './format';
import { localDate } from './money';
import type { Ledger } from './types';

/** The expense / income / mileage form (phone screen and desktop panel). */
export interface LedgerForm {
  date: string;
  amount: string | number;
  category: string | null;
  vendor: string;
  customerId: string | null;
  note: string;
  receiptDataUrl: string;
  billToCustomer: boolean;
  billedAmount: string | number;
  miles: string | number;
  odometerStart: string | number;
  odometerEnd: string | number;
}

export function blankLedgerForm(): LedgerForm {
  return {
    date: localDate(new Date()),
    amount: '',
    category: null,
    vendor: '',
    customerId: null,
    note: '',
    receiptDataUrl: '',
    billToCustomer: true,
    billedAmount: '',
    miles: '',
    odometerStart: '',
    odometerEnd: '',
  };
}

export function ledgerToForm(e: Ledger): LedgerForm {
  return {
    date: e.date,
    amount: e.amount ?? '',
    category: e.category ?? null,
    vendor: e.vendor ?? '',
    customerId: e.customerId ?? null,
    note: e.note ?? '',
    receiptDataUrl: e.receiptDataUrl ?? '',
    billToCustomer: !!e.billToCustomer,
    billedAmount: e.billedAmount ?? '',
    miles: e.miles ?? '',
    odometerStart: e.odometerStart ?? '',
    odometerEnd: e.odometerEnd ?? '',
  };
}

/** Supplies for a customer can go on their invoice. */
export const canBill = (kind: LedgerKind, form: Pick<LedgerForm, 'category' | 'customerId'>) => kind === 'expense' && isBillableCategory(form.category) && !!form.customerId;

/** The entry to save (blank fields left out). */
export function ledgerFromForm(form: LedgerForm, kind: LedgerKind, existing: Ledger | undefined): Ledger {
  const base = existing ? { ...existing } : ({ _id: newId(), kind, createdAt: '', updatedAt: '', deletedAt: null } as Ledger);
  const doc: Ledger = { ...base, kind, date: form.date || localDate(new Date()) };
  const set = <K extends keyof Ledger>(k: K, v: Ledger[K] | '' | null | undefined) => {
    if (v === '' || v === null || v === undefined) delete doc[k];
    else doc[k] = v as Ledger[K];
  };
  if (kind === 'mileage') {
    set('miles', numberOrNull(form.miles));
    set('odometerStart', numberOrNull(form.odometerStart));
    set('odometerEnd', numberOrNull(form.odometerEnd));
  } else {
    set('amount', numberOrNull(form.amount));
    set('customerId', form.customerId);
    if (kind === 'expense') {
      set('category', form.category);
      set('vendor', form.vendor.trim());
      set('receiptDataUrl', form.receiptDataUrl);
      doc.billToCustomer = canBill(kind, form) && form.billToCustomer;
      set('billedAmount', doc.billToCustomer ? numberOrNull(form.billedAmount) : null);
    }
  }
  set('note', form.note.trim());
  return doc;
}
