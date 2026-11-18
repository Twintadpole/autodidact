<template>
  <q-page class="q-pa-md">
    <DeskTable :rows="rows" :columns="columns" storage-key="invoices" export-name="invoices" sort-by="number" descending test-id="desk-invoices" @row="(r) => openInvoice(r._id)">
      <template #filters>
        <q-select v-model="period" dense outlined emit-value map-options :options="PERIOD_OPTIONS" style="width: 150px" data-test="desk-period" />
        <q-btn-toggle v-model="filter" dense no-caps unelevated toggle-color="primary" color="grey-3" text-color="grey-9" :options="filterOptions" data-test="desk-invoice-filter" />
      </template>
      <template #actions>
        <q-btn color="primary" unelevated no-caps icon="post_add" label="Create monthly invoices" data-test="desk-create-monthly">
          <q-menu>
            <q-list style="min-width: 260px">
              <q-item-label header>Drafts for current customers with a monthly rate</q-item-label>
              <q-item v-for="o in monthOptions" :key="o.value" v-close-popup clickable :data-test="`create-${o.value}`" @click="createMonthly(o.value)">
                <q-item-section>{{ o.label }}</q-item-section>
                <q-item-section side>{{ dueCount(o.value) }} to make</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </template>
      <template #quick>
        <q-form class="row items-center q-gutter-sm quick-row" data-test="desk-invoice-quick" @submit.prevent="quickNew">
          <q-icon name="bolt" color="grey-6" />
          <q-select v-model="quick.customerId" dense outlined emit-value map-options use-input input-debounce="0" :options="customerOptions" label="New draft invoice for…" style="width: 280px" data-test="quick-customer" @filter="filterCustomers" />
          <q-btn type="submit" color="primary" outline no-caps icon="add" label="Create" :disable="!quick.customerId" data-test="quick-add" />
        </q-form>
      </template>
      <template #body-cell-state="props">
        <q-td :props="props"><q-badge :color="STATE_COLOR[props.row.state as State]" :label="STATE_LABEL[props.row.state as State]" /></q-td>
      </template>
    </DeskTable>

    <SidePanel v-model="panel" :title="panelTitle">
      <template #head>
        <q-btn v-if="openId" flat dense no-caps icon="open_in_new" label="Phone screen" :to="`/invoices/${openId}`" />
      </template>
      <InvoiceEditor v-if="openId" :id="openId" :key="openId" @deleted="panel = false" />
    </SidePanel>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useQuasar } from 'quasar';
import { customerStatus, invoiceBalance, invoicePaid, invoiceState, invoiceTotal } from '@pool/shared';
import DeskTable, { type DeskColumn } from '@/components/desk/DeskTable.vue';
import SidePanel from '@/components/desk/SidePanel.vue';
import InvoiceEditor from '@/components/InvoiceEditor.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { money } from '@/lib/customer';
import { periodLabel, periodOf } from '@/lib/money';
import { STATE_COLOR, STATE_LABEL } from '@/lib/invoice';
import { PERIOD_OPTIONS, inPeriod, type DeskPeriod } from '@/lib/deskPeriod';

defineOptions({ name: 'DeskInvoicesPage' });

type State = keyof typeof STATE_LABEL;
const $q = useQuasar();
const data = useDataStore();
const period = ref<DeskPeriod>('thisYear');
const filter = ref<'all' | 'unpaid' | 'overdue' | 'draft' | 'paid' | 'void'>('all');

interface Row {
  _id: string;
  number: number;
  customer: string;
  month: string;
  issued: string;
  due: string;
  total: number;
  paid: number;
  balance: number;
  state: State;
  sent: string;
}
const all = computed<Row[]>(() =>
  data.invoices
    .filter((i) => inPeriod(i.issueDate, period.value))
    .map((i) => {
      const state = invoiceState(i);
      return {
        _id: i._id,
        number: i.number,
        customer: data.customerById.get(i.customerId)?.name ?? 'Customer',
        month: periodLabel(i.period),
        issued: i.issueDate.slice(0, 10),
        due: i.dueDate?.slice(0, 10) ?? '',
        total: invoiceTotal(i),
        paid: invoicePaid(i),
        // Void invoices owe nothing.
        balance: state === 'void' ? 0 : invoiceBalance(i),
        state,
        sent: i.sentAt?.slice(0, 10) ?? '',
      };
    }),
);
const matches = (s: State, f: typeof filter.value) => (f === 'all' ? true : f === 'unpaid' ? s === 'sent' || s === 'overdue' : s === f);
const rows = computed(() => all.value.filter((r) => matches(r.state, filter.value)));
const filterOptions = computed(() =>
  (
    [
      ['all', 'All'],
      ['unpaid', 'Unpaid'],
      ['overdue', 'Overdue'],
      ['draft', 'Drafts'],
      ['paid', 'Paid'],
      ['void', 'Void'],
    ] as const
  ).map(([value, label]) => ({ value, label: `${label} ${all.value.filter((r) => matches(r.state, value)).length}` })),
);

const day = (d: string) => (d ? new Date(d + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const columns: DeskColumn<Row>[] = [
  { name: 'number', label: '#', field: 'number', align: 'left', sortable: true, required: true },
  { name: 'customer', label: 'Customer', field: 'customer', align: 'left', sortable: true },
  { name: 'month', label: 'Month', field: 'month', align: 'left', sortable: true, sort: (_a, _b, x: Row, y: Row) => x.issued.localeCompare(y.issued) },
  { name: 'issued', label: 'Date', field: 'issued', align: 'left', sortable: true, format: day, exportType: 'date' },
  { name: 'due', label: 'Due', field: 'due', align: 'left', sortable: true, format: day, exportType: 'date' },
  { name: 'total', label: 'Total', field: 'total', align: 'right', sortable: true, sum: true, format: money, exportType: 'money' },
  { name: 'paid', label: 'Paid', field: 'paid', align: 'right', sortable: true, sum: true, format: money, exportType: 'money' },
  { name: 'balance', label: 'Balance', field: 'balance', align: 'right', sortable: true, sum: true, format: money, exportType: 'money' },
  { name: 'state', label: 'Status', field: 'state', align: 'left', sortable: true, exportValue: (r) => STATE_LABEL[r.state] },
  { name: 'sent', label: 'Sent', field: 'sent', align: 'left', sortable: true, format: day, hidden: true, exportType: 'date' },
];

// ---- panel
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

// ---- create
const now = new Date();
const monthOptions = [-1, 0, 1].map((d) => {
  const p = periodOf(new Date(now.getFullYear(), now.getMonth() + d, 1));
  return { label: periodLabel(p), value: p };
});
function dueCount(p: string) {
  const billed = new Set(data.invoices.filter((i) => i.period === p && i.status !== 'void').map((i) => i.customerId));
  return data.customers.filter((c) => customerStatus(c) === 'current' && (c.monthlyRate ?? 0) > 0 && !billed.has(c._id)).length;
}
async function createMonthly(p: string) {
  if (!dueCount(p)) {
    $q.notify({ message: `Everyone with a monthly rate already has a ${periodLabel(p)} invoice.`, color: 'grey-8' });
    return;
  }
  try {
    const made = await data.createMonthlyInvoices(p);
    $q.notify({ type: 'positive', message: `${made.length} draft invoice${made.length === 1 ? '' : 's'} for ${periodLabel(p)}` });
    filter.value = 'draft';
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}

const quick = reactive({ customerId: null as string | null });
const allCustomers = computed(() => data.customers.map((c) => ({ label: c.name, value: c._id })));
const customerOptions = ref(allCustomers.value);
function filterCustomers(val: string, update: (fn: () => void) => void) {
  update(() => {
    const q = val.toLowerCase();
    customerOptions.value = allCustomers.value.filter((o) => o.label.toLowerCase().includes(q));
  });
}
async function quickNew() {
  if (!quick.customerId) return;
  try {
    const inv = await data.createInvoice(quick.customerId);
    quick.customerId = null;
    openInvoice(inv._id);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}
</script>
