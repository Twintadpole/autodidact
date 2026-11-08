<template>
  <q-page class="q-pa-md column q-gutter-md">
    <q-list bordered separator class="bg-white rounded-borders" data-test="chemicals-list">
      <q-item v-for="c in sorted" :key="c._id" :class="{ 'text-grey-6': !c.active }">
        <q-item-section>
          <q-item-label>{{ c.name }}</q-item-label>
          <q-item-label caption>Default unit: {{ c.defaultUnit }}{{ c.active ? '' : ' · inactive' }}</q-item-label>
        </q-item-section>
        <q-item-section side class="row no-wrap">
          <q-btn flat round dense icon="edit" aria-label="Edit" @click="edit(c)" />
          <q-toggle :model-value="c.active" dense :aria-label="c.active ? 'Deactivate' : 'Activate'" @update:model-value="(v: boolean) => setActive(c, v)" />
        </q-item-section>
      </q-item>
    </q-list>
    <q-btn outline color="primary" icon="add" label="Add chemical" no-caps data-test="add-chemical" @click="edit(null)" />

    <q-dialog v-model="dialog">
      <q-card style="min-width: 300px">
        <q-form @submit.prevent="save">
          <q-card-section class="text-h6">{{ editing ? 'Edit chemical' : 'New chemical' }}</q-card-section>
          <q-card-section class="q-gutter-md">
            <q-input v-model="form.name" outlined label="Name" autofocus :rules="[(v) => !!v?.trim() || 'Required']" data-test="chemical-name" />
            <q-select v-model="form.defaultUnit" outlined label="Default unit" :options="units" data-test="chemical-unit" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="Cancel" v-close-popup />
            <q-btn type="submit" color="primary" unelevated label="Save" data-test="chemical-save" />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useQuasar } from 'quasar';
import { UNITS, type Unit } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import type { Chemical } from '@/lib/types';

defineOptions({ name: 'ChemicalsPage' });

const $q = useQuasar();
const data = useDataStore();
const dialog = ref(false);
const editing = ref<Chemical | null>(null);
const form = reactive({ name: '', defaultUnit: 'lb' as Unit });
const units = [...UNITS];

const sorted = computed(() => [...data.chemicals].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)));

function edit(c: Chemical | null) {
  editing.value = c;
  form.name = c?.name ?? '';
  form.defaultUnit = c?.defaultUnit ?? 'lb';
  dialog.value = true;
}

async function save() {
  try {
    await data.saveChemical(editing.value?._id ?? null, { name: form.name.trim(), defaultUnit: form.defaultUnit });
    dialog.value = false;
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}

async function setActive(c: Chemical, active: boolean) {
  try {
    await data.saveChemical(c._id, { active });
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}
</script>
