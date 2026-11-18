<template>
  <q-page class="q-pa-md">
    <DeskTable :rows="rows" :columns="columns" storage-key="payments" sort-by="date" descending test-id="desk-payments" @row="(r) => openInvoice(r.invoiceId)">
      <template #filters>
        <q-select v-model="period" dense outlined emit-value map-options :options="PERIOD_OPTIONS" style="width: 150px" data-test="desk-period" />
        <q-select v-model="method" dense outlined emit-value map-options clearable :options="PAYMENT_OPTIONS" label="Method" style="width: 140px" />
      </template>
      <template #quick>
        <q-form class="row items-center q-gutter-sm quick-row" data-test="desk-payment-quick" @submit.prevent="quickAdd">
          <q-icon name="bolt" color="grey-6" />
          <q-select v-model="quick.invoiceId" dense outlined emit-value map-options use-input input-debounce="0" :options="invoiceOptions" label="Payment for invoice…" style="width: 300px" data-test="quick-invoice" @filter="filterInvoices" />
          <q-input v-model="quick.amount" dense outlined label="Amount" prefix="$" type="number" min="0" step="0.01" style="width: 120px" data-test="quick-amount" />
          <q-input v-model="quick.date" dense outlined type="date" style="width: 150px" data-test="quick-date" />
          <q-select v-model="quick.method" dense outlined emit-value map-options clearable :options="PAYMENT_OPTIONS" label="Method" style="width: 140px" data-test="quick-method" />
          <q-input v-model="quick.reference" dense outlined label="Check # / reference" style="width: 170px" data-test="quick-reference" />
          <q-btn type="submit" color="positive" outline no-caps icon="add" label="Record" :disable="!quickReady" data-test="quick-add" />
        </q-form>
      </template>
    </DeskTable>
    <div class="text-caption text-grey-7 q-mt-sm">Payments on void invoices are left out, as in the money report. Click a payment to open its invoice.</div>

    <SidePanel v-model="panel" :title="panelTitle">
      <InvoiceEditor v-if="openId" :id="openId" :key="openId" @deleted="panel = false" />
    </SidePanel>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { invoiceBalance, invoiceState, type PaymentMethod } from '@pool/shared';
import DeskTable, { type DeskColumn } from '@/components/desk/DeskTable.vue';
import SidePanel from '@/components/desk/SidePanel.vue';
import InvoiceEditor from '@/components/InvoiceEditor.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { money, numberOrNull, PAYMENT_LABEL, PAYMENT_OPTIONS } from '@/lib/customer';
import { localDate } from '@/lib/money';
import { PERIOD_OPTIONS, inPeriod, type DeskPeriod } from '@/lib/deskPeriod';

defineOptions({ name: 'DeskPaymentsPage' });

const $q = useQuasar();
const data = useDataStore();
const period = ref<DeskPeriod>('thisYear');
const method = ref<PaymentMethod | null>(null);

interface Row {
  _id: string;
  date: string;
  customer: string;
  number: number;
  method: string;
  reference: string;
  amount: number;
  invoiceId: string;
}
const rows = computed<Row[]>(() =>
  data.invoices
    .filter((i) => i.status !== 'void')
    .flatMap((i) =>
      i.payments
        .filter((p) => inPeriod(p.date, period.value) && (!method.value || p.method === method.value))
        .map((p) => ({
          _id: p._id,
          date: p.date.slice(0, 10),
          customer: data.customerById.get(i.customerId)?.name ?? 'Customer',
          number: i.number,
          method: p.method ? PAYMENT_LABEL[p.method] : '',
          reference: p.reference ?? '',
          amount: p.amount,
          invoiceId: i._id,
        })),
    ),
);
const day = (d: string) => new Date(d + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const columns: DeskColumn<Row>[] = [
  { name: 'date', label: 'Date', field: 'date', align: 'left', sortable: true, required: true, format: day },
  { name: 'customer', label: 'Customer', field: 'customer', align: 'left', sortable: true },
  { name: 'number', label: 'Invoice #', field: 'number', align: 'left', sortable: true },
  { name: 'method', label: 'Method', field: 'method', align: 'left', sortable: true },
  { name: 'reference', label: 'Reference', field: 'reference', align: 'left' },
  { name: 'amount', label: 'Amount', field: 'amount', align: 'right', sortable: true, sum: true, format: money },
];

// ---- panel: the payment's invoice
const panel = ref(false);
const openId = ref<string | null>(null);
const panelTitle = computed(() => {
  const i = openId.value ? data.invoiceById.get(openId.value) : undefined;
  return i ? `Invoice #${i.number} · ${data.customerById.get(i.customerId)?.name ?? ''}` : 'Invoice';
});
function openInvoice(id: string) {
  openId.value = id;
  panel.value = true;
}

// ---- quick entry: a payment on an unpaid invoice
const unpaid = computed(() => data.invoices.filter((i) => ['sent', 'overdue', 'draft'].includes(invoiceState(i)) && invoiceBalance(i) > 0));
const allInvoiceOptions = computed(() =>
  unpaid.value.map((i) => ({ value: i._id, label: `#${i.number} · ${data.customerById.get(i.customerId)?.name ?? 'Customer'} · ${money(invoiceBalance(i))} owed${i.status === 'draft' ? ' (draft)' : ''}` })),
);
const invoiceOptions = ref(allInvoiceOptions.value);
function filterInvoices(val: string, update: (fn: () => void) => void) {
  update(() => {
    const q = val.toLowerCase();
    invoiceOptions.value = allInvoiceOptions.value.filter((o) => o.label.toLowerCase().includes(q));
  });
}
const quick = reactive({ invoiceId: null as string | null, amount: '' as string | number, date: localDate(new Date()), method: null as PaymentMethod | null, reference: '' });
// Picking an invoice fills in its balance and the customer's usual method.
watch(
  () => quick.invoiceId,
  (id) => {
    const i = id ? data.invoiceById.get(id) : undefined;
    if (!i) return;
    quick.amount = invoiceBalance(i);
    quick.method = data.customerById.get(i.customerId)?.paymentMethod ?? quick.method;
  },
);
const quickReady = computed(() => !!quick.invoiceId && (numberOrNull(quick.amount) ?? 0) > 0);
async function quickAdd() {
  const id = quick.invoiceId;
  const amount = numberOrNull(quick.amount);
  if (!id || !amount) return;
  try {
    await data.recordPayment(id, { amount, date: quick.date || localDate(new Date()), method: quick.method ?? null, ...(quick.reference.trim() ? { reference: quick.reference.trim() } : {}) });
    const left = invoiceBalance(data.invoiceById.get(id)!);
    $q.notify({ type: 'positive', message: left <= 0 ? 'Paid in full' : `Payment recorded · ${money(left)} still owed`, timeout: 2000 });
    Object.assign(quick, { invoiceId: null, amount: '', reference: '' });
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}
</script>
