<template>
  <q-page class="q-pa-md">
    <DeskTable :rows="rows" :columns="columns" :storage-key="mileage ? 'mileage' : 'ledger'" :export-name="mileage ? 'mileage' : 'expenses-income'" sort-by="date" descending :test-id="mileage ? 'desk-mileage' : 'desk-ledger'" @row="openRow">
      <template #filters>
        <q-select v-model="period" dense outlined emit-value map-options :options="PERIOD_OPTIONS" style="width: 150px" data-test="desk-period" />
        <q-btn-toggle v-if="!mileage" v-model="kindFilter" dense no-caps unelevated toggle-color="primary" color="grey-3" text-color="grey-9" :options="kindOptions" data-test="desk-kind" />
      </template>
      <template #actions>
        <template v-if="mileage">
          <q-btn color="primary" unelevated no-caps icon="add" label="Miles" data-test="desk-new-mileage" @click="openNew('mileage')" />
        </template>
        <template v-else>
          <q-btn color="primary" unelevated no-caps icon="add" label="Expense" data-test="desk-new-expense" @click="openNew('expense')" />
          <q-btn color="primary" outline no-caps icon="add" label="Income" data-test="desk-new-income" @click="openNew('income')" />
        </template>
      </template>

      <template #quick>
        <q-form class="row items-center q-gutter-sm quick-row" data-test="desk-ledger-quick" @submit.prevent="quickAdd">
          <q-icon name="bolt" color="grey-6" />
          <q-input v-model="quick.date" dense outlined type="date" style="width: 150px" data-test="quick-date" />
          <template v-if="mileage">
            <q-input v-model="quick.miles" dense outlined label="Miles" type="number" min="0" step="0.1" style="width: 110px" data-test="quick-miles" />
          </template>
          <template v-else>
            <q-btn-toggle v-model="quickKind" dense no-caps unelevated toggle-color="primary" color="grey-3" text-color="grey-9" :options="[{ label: 'Expense', value: 'expense' }, { label: 'Income', value: 'income' }]" data-test="quick-kind" />
            <q-select v-if="quickKind === 'expense'" v-model="quick.category" dense outlined emit-value map-options clearable :options="categoryOptions" label="Category" style="width: 190px" data-test="quick-category" />
            <q-input v-if="quickKind === 'expense'" v-model="quick.vendor" dense outlined label="Vendor" style="width: 140px" data-test="quick-vendor" />
            <q-input v-model="quick.amount" dense outlined label="Amount" prefix="$" type="number" min="0" step="0.01" style="width: 120px" data-test="quick-amount" />
            <q-select v-model="quick.customerId" dense outlined emit-value map-options clearable :options="customerOptions" label="Customer" style="width: 180px" data-test="quick-customer" />
          </template>
          <q-input v-model="quick.note" dense outlined label="Note" class="col" data-test="quick-note" />
          <q-btn type="submit" color="primary" outline no-caps icon="add" label="Add" :disable="!quickReady" data-test="quick-add" />
        </q-form>
      </template>

      <template #body-cell-receipt="props">
        <q-td :props="props"><q-icon v-if="props.value" name="receipt_long" color="grey-7" /></q-td>
      </template>
    </DeskTable>
    <div v-if="mileage" class="text-caption text-grey-7 q-mt-sm">
      {{ rate != null ? `At your rate of ${money(rate)} a mile (Business details).` : 'Set your rate per mile under Business details to see what the miles are worth.' }}
    </div>

    <SidePanel v-model="panel" :title="panelTitle">
      <q-form id="desk-ledger-form" @submit.prevent="save">
        <LedgerFields :key="editing?._id ?? `new-${panelKind}`" :form="form" :kind="panelKind" :existing="editing" />
      </q-form>
      <template #actions>
        <q-btn v-if="editing" flat color="negative" icon="delete" label="Delete" no-caps data-test="panel-delete" @click="remove" />
        <q-space />
        <q-btn flat label="Cancel" no-caps v-close-popup />
        <q-btn type="submit" form="desk-ledger-form" color="primary" unelevated no-caps label="Save" :loading="busy" data-test="panel-save" />
      </template>
    </SidePanel>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { categoryLabel, EXPENSE_CATEGORIES, type LedgerKind } from '@pool/shared';
import DeskTable, { type DeskColumn } from '@/components/desk/DeskTable.vue';
import SidePanel from '@/components/desk/SidePanel.vue';
import LedgerFields from '@/components/LedgerFields.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { money, numberOrNull } from '@/lib/customer';
import { blankLedgerForm, ledgerFromForm, ledgerToForm } from '@/lib/ledgerForm';
import { localDate } from '@/lib/money';
import { PERIOD_OPTIONS, inPeriod, type DeskPeriod } from '@/lib/deskPeriod';
import type { Ledger } from '@/lib/types';

defineOptions({ name: 'DeskLedgerPage' });

/** Mileage screen when true, otherwise Expenses & income. */
const props = defineProps<{ mileage?: boolean }>();

const $q = useQuasar();
const data = useDataStore();
const period = ref<DeskPeriod>('thisYear');
const kindFilter = ref<'all' | 'expense' | 'income'>('all');
const rate = computed(() => data.settings?.mileageRate ?? null);

interface Row {
  _id: string;
  date: string;
  kind: string;
  category: string;
  vendor: string;
  customer: string;
  note: string;
  expense: number | null;
  income: number | null;
  billed: number | null;
  receipt: boolean;
  miles: number | null;
  odoStart: number | null;
  odoEnd: number | null;
  value: number | null;
  entry: Ledger;
}

const inRange = computed(() => data.ledger.filter((e) => inPeriod(e.date, period.value)));
const rows = computed<Row[]>(() =>
  inRange.value
    .filter((e) => (props.mileage ? e.kind === 'mileage' : e.kind !== 'mileage' && (kindFilter.value === 'all' || e.kind === kindFilter.value)))
    .map((e) => ({
      _id: e._id,
      date: e.date,
      kind: e.kind === 'income' ? 'Income' : e.kind === 'expense' ? 'Expense' : 'Miles',
      category: e.kind === 'expense' ? categoryLabel(e.category) : '',
      vendor: e.vendor ?? '',
      customer: e.customerId ? (data.customerById.get(e.customerId)?.name ?? '') : '',
      note: e.note ?? '',
      expense: e.kind === 'expense' ? (e.amount ?? null) : null,
      income: e.kind === 'income' ? (e.amount ?? null) : null,
      billed: e.billToCustomer ? (e.billedAmount ?? e.amount ?? null) : null,
      receipt: !!e.receiptDataUrl,
      miles: e.miles ?? null,
      odoStart: e.odometerStart ?? null,
      odoEnd: e.odometerEnd ?? null,
      value: e.miles != null && rate.value != null ? Math.round(e.miles * rate.value * 100) / 100 : null,
      entry: e,
    })),
);

const kindOptions = computed(() => {
  const list = inRange.value.filter((e) => e.kind !== 'mileage');
  return [
    { label: `All ${list.length}`, value: 'all' },
    { label: `Expenses ${list.filter((e) => e.kind === 'expense').length}`, value: 'expense' },
    { label: `Income ${list.filter((e) => e.kind === 'income').length}`, value: 'income' },
  ];
});

const dollars = (v: number | null) => (v == null ? '' : money(v));
const num = (v: number | null) => (v == null ? '' : String(v));
const dateCol: DeskColumn<Row> = { name: 'date', label: 'Date', field: 'date', align: 'left', sortable: true, required: true, format: (v: string) => shortDay(v), exportType: 'date' };
const columns = computed<DeskColumn<Row>[]>(() =>
  props.mileage
    ? [
        dateCol,
        { name: 'miles', label: 'Miles', field: 'miles', align: 'right', sortable: true, sum: true, format: num },
        { name: 'odoStart', label: 'Odometer start', field: 'odoStart', align: 'right', format: num },
        { name: 'odoEnd', label: 'Odometer end', field: 'odoEnd', align: 'right', format: num },
        { name: 'value', label: 'Worth', field: 'value', align: 'right', sortable: true, sum: true, format: dollars, exportType: 'money' },
        { name: 'note', label: 'Note', field: 'note', align: 'left' },
      ]
    : [
        dateCol,
        { name: 'kind', label: 'Type', field: 'kind', align: 'left', sortable: true },
        { name: 'category', label: 'Category', field: 'category', align: 'left', sortable: true },
        { name: 'vendor', label: 'Vendor', field: 'vendor', align: 'left', sortable: true },
        { name: 'customer', label: 'Customer', field: 'customer', align: 'left', sortable: true },
        { name: 'note', label: 'Note', field: 'note', align: 'left', classes: 'ellipsis note-cell' },
        { name: 'expense', label: 'Expense', field: 'expense', align: 'right', sortable: true, sum: true, format: dollars, exportType: 'money' },
        { name: 'income', label: 'Income', field: 'income', align: 'right', sortable: true, sum: true, format: dollars, exportType: 'money' },
        { name: 'billed', label: 'Billed to customer', field: 'billed', align: 'right', sortable: true, sum: true, format: dollars, hidden: true, exportType: 'money' },
        { name: 'receipt', label: 'Receipt', field: 'receipt', align: 'center', hidden: true },
      ],
);

const shortDay = (d: string) => new Date(d.slice(0, 10) + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ---- side panel
const TITLES: Record<LedgerKind, string> = { expense: 'expense', income: 'other income', mileage: 'miles' };
const panel = ref(false);
const busy = ref(false);
const editing = ref<Ledger | undefined>(undefined);
const panelKind = ref<LedgerKind>('expense');
const form = reactive(blankLedgerForm());
const panelTitle = computed(() => `${editing.value ? 'Edit' : 'New'} ${TITLES[panelKind.value]}`);

function openRow(r: Row) {
  editing.value = r.entry;
  panelKind.value = r.entry.kind;
  Object.assign(form, ledgerToForm(r.entry));
  panel.value = true;
}
function openNew(kind: LedgerKind) {
  editing.value = undefined;
  panelKind.value = kind;
  Object.assign(form, blankLedgerForm());
  panel.value = true;
}

async function save() {
  busy.value = true;
  try {
    const before = editing.value;
    const saved = await data.saveLedger(ledgerFromForm(form, panelKind.value, before));
    if (saved.billToCustomer && saved.invoiceId && (!before || before.invoiceId !== saved.invoiceId)) {
      const inv = data.invoiceById.get(saved.invoiceId);
      $q.notify({ type: 'positive', message: inv ? `Added to draft invoice #${inv.number}` : 'Added to their invoice' });
    }
    panel.value = false;
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}

function remove() {
  const e = editing.value;
  if (!e) return;
  $q.dialog({ title: `Delete this ${TITLES[e.kind]}?`, cancel: true, ok: { label: 'Delete', color: 'negative', unelevated: true } }).onOk(async () => {
    await data.deleteLedger(e._id);
    panel.value = false;
  });
}

// ---- quick entry
const quickKind = ref<'expense' | 'income'>('expense');
const quick = reactive({ date: localDate(new Date()), amount: '' as string | number, category: null as string | null, vendor: '', customerId: null as string | null, note: '', miles: '' as string | number });
const quickReady = computed(() => (props.mileage ? numberOrNull(quick.miles) != null : numberOrNull(quick.amount) != null));
const categoryOptions = EXPENSE_CATEGORIES.map((c) => ({ label: c.label, value: c.key as string }));
const customerOptions = computed(() => data.customers.map((c) => ({ label: c.name, value: c._id })));
watch(quickKind, (k) => {
  if (k === 'income') quick.category = null;
});

async function quickAdd() {
  if (!quickReady.value) return;
  const kind: LedgerKind = props.mileage ? 'mileage' : quickKind.value;
  const f = { ...blankLedgerForm(), date: quick.date, note: quick.note };
  if (kind === 'mileage') f.miles = quick.miles;
  else Object.assign(f, { amount: quick.amount, customerId: quick.customerId, ...(kind === 'expense' && { category: quick.category, vendor: quick.vendor }) });
  try {
    const saved = await data.saveLedger(ledgerFromForm(f, kind, undefined));
    const inv = saved.billToCustomer && saved.invoiceId ? data.invoiceById.get(saved.invoiceId) : undefined;
    $q.notify({ type: 'positive', message: inv ? `Added, and put on draft invoice #${inv.number}` : 'Added', timeout: 1500 });
    Object.assign(quick, { amount: '', vendor: '', note: '', miles: '' });
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}
</script>

<style scoped>
:deep(.note-cell) {
  max-width: 260px;
}
</style>
