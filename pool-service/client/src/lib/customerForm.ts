import { customerStatus, type CustomerStatus, type PaymentMethod } from '@pool/shared';
import { formatPhone, normalizePhone } from './format';
import { cleanAddress, dateInput, looksLikeEmail, numberOrNull } from './customer';
import type { Customer } from './types';

/** The customer form's fields (phone screen and desktop panel). Every field optional but the name. */
export interface CustomerForm {
  name: string;
  status: CustomerStatus;
  phones: { label: string; number: string }[];
  email: string;
  address: { line1: string; line2: string; city: string; state: string; zip: string };
  notes: string;
  monthlyRate: string | number;
  paymentMethod: PaymentMethod | null;
  billingEmail: string;
  startDate: string;
  endDate: string;
  distanceMiles: string | number;
}

export function blankCustomerForm(status: CustomerStatus = 'current'): CustomerForm {
  return {
    name: '',
    status,
    phones: [{ label: 'mobile', number: '' }],
    email: '',
    address: { line1: '', line2: '', city: '', state: 'TX', zip: '' },
    notes: '',
    monthlyRate: '',
    paymentMethod: null,
    billingEmail: '',
    startDate: '',
    endDate: '',
    distanceMiles: '',
  };
}

export function customerToForm(c: Customer): CustomerForm {
  return {
    name: c.name,
    status: customerStatus(c),
    phones: c.phones.map((p) => ({ label: p.label, number: formatPhone(p.number) })),
    email: c.email ?? '',
    address: { line1: '', line2: '', city: '', state: '', zip: '', ...c.address } as CustomerForm['address'],
    notes: c.notes ?? '',
    monthlyRate: c.monthlyRate ?? '',
    paymentMethod: c.paymentMethod ?? null,
    billingEmail: c.billingEmail ?? '',
    startDate: dateInput(c.startDate),
    endDate: dateInput(c.endDate),
    distanceMiles: c.distanceMiles ?? '',
  };
}

/** The record to save, or a message saying what to check. */
export function customerFromForm(form: CustomerForm): { body: Partial<Customer> } | { error: string } {
  const phones = form.phones
    .filter((p) => p.number.trim())
    .map((p) => ({ label: p.label.trim() || 'phone', number: normalizePhone(p.number) }));
  if (phones.some((p) => !p.number)) return { error: 'Check the phone numbers.' };
  if ([form.email, form.billingEmail].some((e) => e.trim() && !looksLikeEmail(e))) return { error: 'Check the email address.' };
  const address = cleanAddress(form.address);
  // Cleared Phase 7 fields are sent as null so the server clears them too.
  return {
    body: {
      name: form.name.trim(),
      phones: phones as Customer['phones'],
      ...(address ? { address } : {}),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      status: form.status,
      monthlyRate: numberOrNull(form.monthlyRate),
      paymentMethod: form.paymentMethod ?? null,
      billingEmail: form.billingEmail.trim() || null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      distanceMiles: numberOrNull(form.distanceMiles),
    },
  };
}
