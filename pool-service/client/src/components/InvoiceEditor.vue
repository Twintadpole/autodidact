<template>
  <!-- One invoice: lines, totals, payments and actions. Used by the phone screen and the desktop panel. -->
  <div class="column q-gutter-md">
    <div v-if="!inv" class="text-center text-grey-7 q-pa-lg">Invoice not found.</div>
    <template v-else>
      <div class="row items-center justify-between">
        <div>
          <div class="text-h6">Invoice #{{ inv.number }}</div>
          <router-link v-if="customer" :to="`/customers/${customer._id}`" class="text-primary">{{ customer.name }}</router-link>
        </div>
        <q-badge :color="STATE_COLOR[state]" :label="STATE_LABEL[state]" class="text-body2 q-px-sm" data-test="invoice-state" />
      </div>

      <!-- Edit (anything but a void invoice) -->
      <div class="row q-col-gutter-sm">
        <q-input v-model="form.issueDate" outlined dense stack-label label="Date" type="date" class="col-6" :readonly="locked" data-test="invoice-issue" />
        <q-input v-model="form.dueDate" outlined dense stack-label label="Due" type="date" class="col-6" :readonly="locked" data-test="invoice-due" />
      </div>

      <div>
        <div class="text-subtitle2 q-mb-xs">Lines</div>
        <div v-for="(l, idx) in form.lines" :key="l._id" class="row no-wrap items-start q-gutter-x-sm q-mb-sm">
          <q-input v-model="l.description" outlined dense autogrow label="Description" class="col" :readonly="locked" :data-test="`line-desc-${idx}`" />
          <q-input v-model="l.amount" outlined dense label="Amount" prefix="$" type="number" inputmode="decimal" step="0.01" style="width: 110px" :readonly="locked" :data-test="`line-amount-${idx}`" />
          <q-btn v-if="!locked" flat round dense icon="close" aria-label="Remove line" @click="form.lines.splice(idx, 1)" />
        </div>
        <q-btn v-if="!locked" flat no-caps color="primary" icon="add" label="Add line" data-test="add-line" @click="addLine" />
      </div>
      <q-input v-model="form.notes" outlined autogrow type="textarea" label="Note to the customer (on the invoice)" :readonly="locked" data-test="invoice-notes" />
      <q-btn v-if="dirty" color="primary" unelevated label="Save changes" :loading="busy" data-test="invoice-save" @click="save" />

      <!-- Totals -->
      <q-list dense bordered class="bg-white rounded-borders">
        <q-item><q-item-section>Total</q-item-section><q-item-section side class="text-grey-10" data-test="invoice-total">{{ money(total) }}</q-item-section></q-item>
        <q-item v-if="inv.payments.length"><q-item-section>Paid</q-item-section><q-item-section side class="text-grey-10">{{ money(paid) }}</q-item-section></q-item>
        <q-item><q-item-section class="text-weight-bold">Balance</q-item-section><q-item-section side class="text-weight-bold text-grey-10" data-test="invoice-balance">{{ money(balance) }}</q-item-section></q-item>
      </q-list>

      <!-- Payments -->
      <div v-if="inv.payments.length">
        <div class="text-subtitle2 q-mb-xs">Payments</div>
        <q-list bordered separator class="bg-white rounded-borders" data-test="payments">
          <q-item v-for="p in inv.payments" :key="p._id">
            <q-item-section>
              <q-item-label>{{ money(p.amount) }}</q-item-label>
              <q-item-label caption>{{ day(p.date) }}{{ p.method ? ` · ${PAYMENT_LABEL[p.method]}` : '' }}{{ p.reference ? ` · ${p.reference}` : '' }}</q-item-label>
            </q-item-section>
            <q-item-section v-if="state !== 'void'" side><q-btn flat round dense icon="delete" aria-label="Remove payment" @click="removePayment(p._id)" /></q-item-section>
          </q-item>
        </q-list>
      </div>

      <!-- Actions -->
      <div class="row q-col-gutter-sm">
        <div class="col-6"><q-btn class="full-width" color="primary" unelevated icon="share" label="Share PDF" no-caps :loading="sharing" data-test="invoice-share" @click="share" /></div>
        <div class="col-6">
          <q-btn class="full-width" color="positive" unelevated icon="payments" label="Record payment" no-caps :disable="state === 'void' || balance <= 0" data-test="invoice-pay" @click="openPayment" />
        </div>
        <div v-if="state === 'draft'" class="col-6"><q-btn class="full-width" outline color="primary" icon="mark_email_read" label="Mark sent" no-caps data-test="invoice-mark-sent" @click="markSent" /></div>
        <div v-if="state !== 'void' && state !== 'draft'" class="col-6"><q-btn class="full-width" flat color="negative" icon="block" label="Void" no-caps data-test="invoice-void" @click="voidIt" /></div>
        <div v-if="state === 'draft'" class="col-6"><q-btn class="full-width" flat color="negative" icon="delete" label="Delete draft" no-caps data-test="invoice-delete" @click="deleteDraft" /></div>
      </div>
      <div v-if="inv.sentAt" class="text-caption text-grey-7">Sent {{ day(inv.sentAt) }}</div>

      <!-- Payment dialog -->
      <q-dialog v-model="payOpen">
        <q-card style="min-width: 300px" data-test="payment-dialog">
          <q-card-section class="text-h6">Record payment</q-card-section>
          <q-card-section class="q-gutter-sm">
            <q-input v-model="pay.amount" outlined dense label="Amount" prefix="$" type="number" inputmode="decimal" step="0.01" data-test="payment-amount" />
            <q-input v-model="pay.date" outlined dense stack-label label="Date" type="date" data-test="payment-date" />
            <q-select v-model="pay.method" outlined dense label="Method" emit-value map-options clearable :options="PAYMENT_OPTIONS" data-test="payment-method" />
            <q-input v-model="pay.reference" outlined dense label="Check # or reference" data-test="payment-reference" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Cancel" v-close-popup />
            <q-btn color="positive" unelevated label="Save payment" data-test="payment-save" @click="savePayment" />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { invoiceBalance, invoicePaid, invoiceState, invoiceTotal, type PaymentMethod } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { money, numberOrNull, PAYMENT_LABEL, PAYMENT_OPTIONS } from '@/lib/customer';
import { localDate, newIdLine } from '@/lib/invoiceForm';
import { STATE_COLOR, STATE_LABEL } from '@/lib/invoice';
import { invoicePdf, sharePdf } from '@/lib/invoicePdf';
import { clone } from '@/lib/format';
import type { Invoice } from '@/lib/types';

defineOptions({ name: 'InvoiceEditor' });

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ deleted: [] }>();

const $q = useQuasar();
const data = useDataStore();
const busy = ref(false);
const sharing = ref(false);

const inv = computed(() => data.invoiceById.get(props.id));
const customer = computed(() => (inv.value ? data.customerById.get(inv.value.customerId) : undefined));
const state = computed(() => (inv.value ? invoiceState(inv.value) : 'draft'));
const locked = computed(() => state.value === 'void');

type FormLine = { _id: string; description: string; amount: string | number };
const form = reactive({ issueDate: '', dueDate: '', notes: '', lines: [] as FormLine[] });
const fromInvoice = (i: Invoice) => ({
  issueDate: i.issueDate.slice(0, 10),
  dueDate: i.dueDate ? i.dueDate.slice(0, 10) : '',
  notes: i.notes ?? '',
  lines: i.lines.map((l) => ({ ...l })),
});
const snapshot = (f: typeof form) => JSON.stringify({ ...f, lines: f.lines.map((l) => ({ ...l, amount: Number(l.amount) || 0 })) });
const saved = ref('');
watch(
  inv,
  (i) => {
    if (!i) return;
    const f = fromInvoice(i);
    // Don't overwrite typing in progress when a sync refreshes the list.
    if (saved.value && snapshot(form) !== saved.value) return;
    Object.assign(form, clone(f));
    saved.value = snapshot(form);
  },
  { immediate: true },
);
const dirty = computed(() => !!inv.value && snapshot(form) !== saved.value);

/** Totals follow what's on screen. */
const current = computed(() => ({ lines: form.lines.map((l) => ({ amount: Number(l.amount) || 0 })), payments: inv.value?.payments ?? [], status: inv.value?.status ?? 'draft' }));
const total = computed(() => invoiceTotal(current.value));
const paid = computed(() => invoicePaid(current.value));
const balance = computed(() => invoiceBalance(current.value));

const day = (d: string) => new Date(d.slice(0, 10) + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function addLine() {
  form.lines.push(newIdLine());
}

function edited(): Invoice | null {
  if (!inv.value) return null;
  const doc: Invoice = {
    ...clone(inv.value),
    issueDate: form.issueDate || inv.value.issueDate,
    dueDate: form.dueDate || null,
    lines: form.lines.map((l) => ({ _id: l._id, description: l.description.trim(), amount: Number(l.amount) || 0 })),
  };
  if (form.notes.trim()) doc.notes = form.notes.trim();
  else delete doc.notes;
  return doc;
}

async function save() {
  const doc = edited();
  if (!doc) return;
  busy.value = true;
  try {
    await data.saveInvoice(doc, `Edit invoice #${doc.number}`);
    saved.value = snapshot(form);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}

async function share() {
  if (!inv.value) return;
  if (dirty.value) await save();
  sharing.value = true;
  try {
    const doc = edited()!;
    const blob = await invoicePdf(doc, customer.value, data.settings);
    const how = await sharePdf(blob, `Invoice-${doc.number}.pdf`, `Invoice #${doc.number}`);
    if (how === 'downloaded') $q.notify({ message: 'Invoice PDF saved to Downloads', color: 'grey-8' });
    if (state.value === 'draft') {
      $q.dialog({ title: 'Mark as sent?', message: `Invoice #${doc.number} was shared with the customer.`, cancel: { label: 'Not yet', flat: true }, ok: { label: 'Mark sent', unelevated: true } }).onOk(() => void markSent());
    }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') $q.notify({ type: 'negative', message: `Couldn't make the PDF: ${errorMessage(err)}` });
  } finally {
    sharing.value = false;
  }
}

async function markSent() {
  if (!inv.value) return;
  if (dirty.value) await save();
  await data.markInvoiceSent(inv.value._id);
}

// ---- payments
const payOpen = ref(false);
const pay = reactive({ amount: '' as string | number, date: '', method: null as PaymentMethod | null, reference: '' });
function openPayment() {
  pay.amount = balance.value;
  pay.date = localDate(new Date());
  pay.method = customer.value?.paymentMethod ?? null;
  pay.reference = '';
  payOpen.value = true;
}
async function savePayment() {
  const amount = numberOrNull(pay.amount);
  if (!inv.value || !amount || amount <= 0) {
    $q.notify({ type: 'warning', message: 'Enter the amount received.' });
    return;
  }
  if (dirty.value) await save();
  await data.recordPayment(inv.value._id, { amount, date: pay.date || localDate(new Date()), method: pay.method ?? null, ...(pay.reference.trim() ? { reference: pay.reference.trim() } : {}) });
  payOpen.value = false;
  $q.notify({ type: 'positive', message: invoiceBalance(data.invoiceById.get(inv.value._id)!) <= 0 ? 'Paid in full' : 'Payment recorded' });
}
function removePayment(id: string) {
  $q.dialog({ title: 'Remove this payment?', cancel: true, ok: { label: 'Remove', color: 'negative', unelevated: true } }).onOk(() => void data.removePayment(inv.value!._id, id));
}

function voidIt() {
  $q.dialog({ title: `Void invoice #${inv.value!.number}?`, message: 'It stays on record, marked Void, and no longer counts as owed.', cancel: true, ok: { label: 'Void', color: 'negative', unelevated: true } }).onOk(
    () => void data.voidInvoice(inv.value!._id),
  );
}
function deleteDraft() {
  $q.dialog({ title: `Delete draft #${inv.value!.number}?`, cancel: true, ok: { label: 'Delete', color: 'negative', unelevated: true } }).onOk(async () => {
    await data.deleteDraftInvoice(inv.value!._id);
    emit('deleted');
  });
}
</script>
