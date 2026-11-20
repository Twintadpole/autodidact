<template>
  <q-page class="q-pa-md">
    <DeskTable :rows="rows" :columns="columns" storage-key="customers" export-name="customers" sort-by="name" test-id="desk-customers" @row="openRow">
      <template #filters>
        <q-btn-toggle v-model="ui.customerFilter" dense no-caps unelevated toggle-color="primary" color="grey-3" text-color="grey-9" :options="classOptions" data-test="desk-customer-class" />
      </template>
      <template #actions>
        <q-btn flat no-caps icon="upload_file" label="Import" to="/desk/import" data-test="desk-customer-import" />
        <q-btn color="primary" unelevated no-caps icon="person_add" label="New customer" data-test="desk-customer-new" @click="openNew" />
      </template>
      <template #quick>
        <q-form class="row items-center q-gutter-sm quick-row" data-test="desk-customer-quick" @submit.prevent="quickAdd">
          <q-icon name="bolt" color="grey-6" />
          <q-input v-model="quick.name" dense outlined label="Name" class="col-3" data-test="quick-name" />
          <q-select v-model="quick.status" dense outlined emit-value map-options :options="STATUS_OPTIONS" label="Class" style="width: 130px" />
          <q-input v-model="quick.phone" dense outlined label="Phone" type="tel" style="width: 170px" data-test="quick-phone" />
          <q-input v-model="quick.rate" dense outlined label="Monthly rate" prefix="$" type="number" min="0" step="0.01" style="width: 150px" data-test="quick-rate" />
          <q-btn type="submit" color="primary" outline no-caps icon="add" label="Add" :disable="!quick.name.trim()" data-test="quick-add" />
        </q-form>
      </template>
      <template #body-cell-status="props">
        <q-td :props="props"><q-badge :color="STATUS_COLOR[props.value as CustomerStatus]" :label="STATUS_LABEL[props.value as CustomerStatus]" /></q-td>
      </template>
      <template #body-cell-owed="props">
        <q-td :props="props" :class="props.value ? 'text-negative text-weight-medium' : 'text-grey-5'">{{ props.value ? money(props.value) : '–' }}</q-td>
      </template>
    </DeskTable>

    <SidePanel v-model="panel" :title="editingId ? form.name || 'Customer' : 'New customer'">
      <template #head>
        <q-btn v-if="editingId" flat dense no-caps icon="open_in_new" label="Pools & notes" :to="`/customers/${editingId}`" data-test="panel-open-customer" />
      </template>
      <q-form id="desk-customer-form" @submit.prevent="save">
        <CustomerFields :key="editingId ?? 'new'" :form="form" />
      </q-form>
      <template #actions>
        <q-btn v-if="editingId" flat color="negative" icon="delete" label="Delete" no-caps @click="remove" />
        <q-space />
        <q-btn flat label="Cancel" no-caps v-close-popup />
        <q-btn type="submit" form="desk-customer-form" color="primary" unelevated no-caps :label="editingId ? 'Save' : 'Add customer'" :loading="busy" data-test="panel-save" />
      </template>
    </SidePanel>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useQuasar } from 'quasar';
import { customerStatus, type CustomerStatus } from '@pool/shared';
import DeskTable, { type DeskColumn } from '@/components/desk/DeskTable.vue';
import SidePanel from '@/components/desk/SidePanel.vue';
import CustomerFields from '@/components/CustomerFields.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { errorMessage } from '@/stores/api';
import { money, numberOrNull, PAYMENT_LABEL, scheduleText, STATUS_COLOR, STATUS_LABEL, STATUS_OPTIONS } from '@/lib/customer';
import { blankCustomerForm, customerFromForm, customerToForm } from '@/lib/customerForm';
import { DAY_LABELS, formatPhone, normalizePhone } from '@/lib/format';
import type { Customer } from '@/lib/types';

defineOptions({ name: 'DeskCustomersPage' });

const $q = useQuasar();
const data = useDataStore();
const ui = useUiStore();

interface Row {
  _id: string;
  name: string;
  status: CustomerStatus;
  phone: string;
  email: string;
  city: string;
  pools: number;
  schedule: string;
  rate: number | null;
  distance: number | null;
  owed: number;
  pays: string;
  started: string;
  ended: string;
  customer: Customer;
}

const rowsAll = computed<Row[]>(() =>
  data.customers.map((c) => {
    const pools = data.pools.filter((p) => p.customerId === c._id);
    return {
      _id: c._id,
      name: c.name,
      status: customerStatus(c),
      phone: c.phones[0] ? formatPhone(c.phones[0].number) : '',
      email: c.email ?? '',
      city: c.address?.city ?? '',
      pools: pools.length,
      schedule: [...new Set(pools.filter((p) => p.active).map((p) => scheduleText(p, DAY_LABELS)))].join(', '),
      rate: c.monthlyRate ?? null,
      distance: c.distanceMiles ?? null,
      owed: data.balanceByCustomer.get(c._id) ?? 0,
      pays: c.paymentMethod ? PAYMENT_LABEL[c.paymentMethod] : '',
      started: c.startDate?.slice(0, 10) ?? '',
      ended: c.endDate?.slice(0, 10) ?? '',
      customer: c,
    };
  }),
);
const rows = computed(() => (ui.customerFilter === 'all' ? rowsAll.value : rowsAll.value.filter((r) => r.status === ui.customerFilter)));

const classOptions = computed(() => {
  const n = (s: CustomerStatus) => rowsAll.value.filter((r) => r.status === s).length;
  return [
    { label: `Current ${n('current')}`, value: 'current' },
    { label: `Prospects ${n('prospect')}`, value: 'prospect' },
    { label: `Past ${n('past')}`, value: 'past' },
    { label: `All ${rowsAll.value.length}`, value: 'all' },
  ];
});

const dollars = (v: number | null) => (v == null ? '' : money(v));
const columns: DeskColumn<Row>[] = [
  { name: 'name', label: 'Name', field: 'name', align: 'left', sortable: true, required: true },
  { name: 'status', label: 'Class', field: 'status', align: 'left', sortable: true, exportValue: (r) => STATUS_LABEL[r.status] },
  { name: 'phone', label: 'Phone', field: 'phone', align: 'left' },
  { name: 'email', label: 'Email', field: 'email', align: 'left', sortable: true },
  { name: 'city', label: 'City', field: 'city', align: 'left', sortable: true },
  { name: 'pools', label: 'Pools', field: 'pools', align: 'right', sortable: true, hidden: true },
  { name: 'schedule', label: 'Service day', field: 'schedule', align: 'left', sortable: true },
  { name: 'rate', label: 'Monthly rate', field: 'rate', align: 'right', sortable: true, sum: true, format: dollars, exportType: 'money' },
  { name: 'distance', label: 'Miles from HQ', field: 'distance', align: 'right', sortable: true, format: (v: number | null) => (v == null ? '' : String(v)) },
  { name: 'owed', label: 'Owed', field: 'owed', align: 'right', sortable: true, sum: true, format: (v: number) => (v ? money(v) : ''), exportType: 'money' },
  { name: 'pays', label: 'Pays by', field: 'pays', align: 'left', sortable: true, hidden: true },
  { name: 'started', label: 'Started', field: 'started', align: 'left', sortable: true, hidden: true, exportType: 'date' },
  { name: 'ended', label: 'Ended', field: 'ended', align: 'left', sortable: true, hidden: true, exportType: 'date' },
];

// ---- side panel
const panel = ref(false);
const busy = ref(false);
const editingId = ref<string | null>(null);
const form = reactive(blankCustomerForm());

function openRow(r: Row) {
  editingId.value = r._id;
  Object.assign(form, customerToForm(r.customer));
  panel.value = true;
}
function openNew() {
  editingId.value = null;
  Object.assign(form, blankCustomerForm(ui.customerFilter === 'all' ? 'current' : ui.customerFilter));
  panel.value = true;
}

async function save() {
  const result = customerFromForm(form);
  if ('error' in result) {
    $q.notify({ type: 'warning', message: result.error });
    return;
  }
  busy.value = true;
  try {
    await data.saveCustomer(editingId.value, result.body);
    panel.value = false;
    $q.notify({ type: 'positive', message: `Saved ${result.body.name}`, timeout: 1500 });
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}

function remove() {
  const id = editingId.value;
  if (!id) return;
  $q.dialog({ title: 'Delete customer?', message: 'Their pools are removed from the route too.', cancel: true, ok: { label: 'Delete', color: 'negative', unelevated: true } }).onOk(async () => {
    await data.deleteCustomer(id);
    panel.value = false;
  });
}

// ---- quick entry
const quick = reactive({ name: '', status: (ui.customerFilter === 'all' ? 'current' : ui.customerFilter) as CustomerStatus, phone: '', rate: '' as string | number });
async function quickAdd() {
  const name = quick.name.trim();
  if (!name) return;
  const phone = quick.phone.trim() ? normalizePhone(quick.phone) : null;
  if (quick.phone.trim() && !phone) {
    $q.notify({ type: 'warning', message: 'Check the phone number.' });
    return;
  }
  try {
    await data.saveCustomer(null, { name, status: quick.status, phones: phone ? [{ label: 'mobile', number: phone }] : [], monthlyRate: numberOrNull(quick.rate) });
    $q.notify({ type: 'positive', message: `Added ${name}`, timeout: 1500 });
    quick.name = '';
    quick.phone = '';
    quick.rate = '';
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}
</script>
