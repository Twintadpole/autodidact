<template>
  <q-page class="q-pa-md">
    <DeskTable :rows="rows" :columns="columns" storage-key="chemicals" sort-by="name" test-id="desk-chemicals" @row="openRow">
      <template #filters>
        <q-toggle v-model="showInactive" dense label="Show inactive" />
      </template>
      <template #quick>
        <q-form class="row items-center q-gutter-sm quick-row" data-test="desk-chemical-quick" @submit.prevent="quickAdd">
          <q-icon name="bolt" color="grey-6" />
          <q-input v-model="quick.name" dense outlined label="Name" class="col-3" data-test="quick-name" />
          <q-select v-model="quick.defaultUnit" dense outlined :options="units" label="Unit" style="width: 100px" />
          <q-input v-model="quick.price" dense outlined label="Your cost" prefix="$" type="number" min="0" step="0.01" style="width: 140px" data-test="quick-price" />
          <q-select v-model="quick.priceUnit" dense outlined :options="units" label="per" style="width: 100px" />
          <q-btn type="submit" color="primary" outline no-caps icon="add" label="Add" :disable="!quick.name.trim()" data-test="quick-add" />
        </q-form>
      </template>
      <template #body-cell-active="props">
        <q-td :props="props" @click.stop>
          <q-toggle :model-value="props.value" dense :aria-label="props.value ? 'Deactivate' : 'Activate'" @update:model-value="(v: boolean) => setActive(props.row.chemical, v)" />
        </q-td>
      </template>
    </DeskTable>
    <div class="text-caption text-grey-7 q-mt-sm">Only you see costs. They're never on invoices or recaps.</div>

    <SidePanel v-model="panel" :title="form.name || 'Chemical'">
      <q-form id="desk-chemical-form" class="column q-gutter-md" @submit.prevent="save">
        <q-input v-model="form.name" outlined label="Name" :rules="[(v) => !!v?.trim() || 'Required']" data-test="chemical-name" />
        <q-select v-model="form.defaultUnit" outlined label="Default unit" :options="units" />
        <div class="row q-col-gutter-sm">
          <q-input v-model="form.price" outlined label="Your cost" prefix="$" type="number" min="0" step="0.01" class="col-7" data-test="chemical-price" />
          <q-select v-model="form.priceUnit" outlined label="per" :options="units" class="col-5" />
        </div>
        <q-toggle v-model="form.active" label="Active (shown when adding doses)" />
      </q-form>
      <template #actions>
        <q-btn flat label="Cancel" no-caps v-close-popup />
        <q-btn type="submit" form="desk-chemical-form" color="primary" unelevated no-caps label="Save" :loading="busy" data-test="panel-save" />
      </template>
    </SidePanel>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useQuasar } from 'quasar';
import { UNITS, type Unit } from '@pool/shared';
import DeskTable, { type DeskColumn } from '@/components/desk/DeskTable.vue';
import SidePanel from '@/components/desk/SidePanel.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { money, numberOrNull } from '@/lib/customer';
import type { Chemical } from '@/lib/types';

defineOptions({ name: 'DeskChemicalsPage' });

const $q = useQuasar();
const data = useDataStore();
const units = [...UNITS];
const showInactive = ref(false);

interface Row {
  _id: string;
  name: string;
  unit: Unit;
  price: number | null;
  per: string;
  active: boolean;
  chemical: Chemical;
}
const rows = computed<Row[]>(() =>
  data.chemicals
    .filter((c) => showInactive.value || c.active)
    .map((c) => ({ _id: c._id, name: c.name, unit: c.defaultUnit, price: c.price ?? null, per: c.price != null ? (c.priceUnit ?? '') : '', active: c.active, chemical: c })),
);
const columns: DeskColumn<Row>[] = [
  { name: 'name', label: 'Name', field: 'name', align: 'left', sortable: true, required: true },
  { name: 'unit', label: 'Default unit', field: 'unit', align: 'left', sortable: true },
  { name: 'price', label: 'Your cost', field: 'price', align: 'right', sortable: true, format: (v: number | null) => (v == null ? '' : money(v)) },
  { name: 'per', label: 'per', field: 'per', align: 'left' },
  { name: 'active', label: 'Active', field: 'active', align: 'center', sortable: true },
];

const panel = ref(false);
const busy = ref(false);
const editing = ref<Chemical | null>(null);
const form = reactive({ name: '', defaultUnit: 'lb' as Unit, price: '' as string | number, priceUnit: 'lb' as Unit, active: true });

function openRow(r: Row) {
  const c = r.chemical;
  editing.value = c;
  Object.assign(form, { name: c.name, defaultUnit: c.defaultUnit, price: c.price ?? '', priceUnit: c.priceUnit ?? c.defaultUnit, active: c.active });
  panel.value = true;
}

async function save() {
  busy.value = true;
  try {
    const price = numberOrNull(form.price);
    await data.saveChemical(editing.value?._id ?? null, { name: form.name.trim(), defaultUnit: form.defaultUnit, price, priceUnit: price == null ? null : form.priceUnit, active: form.active });
    panel.value = false;
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}

async function setActive(c: Chemical, active: boolean) {
  try {
    await data.saveChemical(c._id, { active });
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}

const quick = reactive({ name: '', defaultUnit: 'lb' as Unit, price: '' as string | number, priceUnit: 'lb' as Unit });
async function quickAdd() {
  const name = quick.name.trim();
  if (!name) return;
  try {
    const price = numberOrNull(quick.price);
    await data.saveChemical(null, { name, defaultUnit: quick.defaultUnit, price, priceUnit: price == null ? null : quick.priceUnit });
    $q.notify({ type: 'positive', message: `Added ${name}`, timeout: 1500 });
    quick.name = '';
    quick.price = '';
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}
</script>
