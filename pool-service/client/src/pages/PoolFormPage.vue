<template>
  <q-page class="q-pa-md">
    <q-form class="column q-gutter-md" @submit.prevent="save">
      <div v-if="customer" class="text-caption text-grey-7">Customer: {{ customer.name }}</div>
      <q-input v-model="form.name" outlined label="Pool name" hint="e.g. Backyard, Spa" data-test="pool-name" />
      <div class="row q-col-gutter-sm">
        <q-select v-model="form.type" outlined label="Type" class="col-6" emit-value map-options :options="[{ label: 'Chlorine', value: 'chlorine' }, { label: 'Salt', value: 'salt' }]" data-test="pool-type" />
        <q-input v-model.number="form.volumeGal" outlined label="Gallons" type="number" inputmode="numeric" class="col-6" :rules="[(v) => v > 0 || 'Required']" hide-bottom-space data-test="pool-volume" />
      </div>
      <div class="row q-col-gutter-sm">
        <q-select v-model="form.serviceDay" outlined label="Service day" class="col-8" emit-value map-options :options="dayOptions" data-test="pool-day" />
        <q-input v-model.number="form.routeOrder" outlined label="Stop #" type="number" inputmode="numeric" class="col-4" data-test="pool-order" />
      </div>
      <q-input v-model="form.surface" outlined label="Surface (optional)" hint="plaster, pebble, vinyl, fiberglass…" />
      <q-input v-model="form.accessNotes" outlined autogrow label="Access notes" hint="Gate code, dog, where the equipment is" data-test="pool-access" />

      <q-toggle v-model="useOwnAddress" label="Different address from the customer" />
      <AddressFields v-if="useOwnAddress" v-model="form.address" required />

      <q-toggle v-model="form.active" label="Active (on the route)" />

      <q-btn type="submit" color="primary" unelevated size="lg" :label="isNew ? 'Add pool' : 'Save'" :loading="busy" data-test="pool-save" />
      <q-btn v-if="!isNew" flat color="negative" icon="delete" label="Delete pool" @click="remove" />
    </q-form>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { SERVICE_DAYS, type ServiceDay } from '@pool/shared';
import AddressFields from '@/components/AddressFields.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { DAY_LABELS } from '@/lib/format';
import type { Pool } from '@/lib/types';

defineOptions({ name: 'PoolFormPage' });

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const data = useDataStore();
const busy = ref(false);
const useOwnAddress = ref(false);

const poolId = computed(() => (route.name === 'pool-edit' ? String(route.params.id) : null));
const isNew = computed(() => !poolId.value);
const existing = computed(() => (poolId.value ? data.poolById.get(poolId.value) : undefined));
const customerId = computed(() => (route.params.customerId ? String(route.params.customerId) : existing.value?.customerId));
const customer = computed(() => (customerId.value ? data.customerById.get(customerId.value) : undefined));

const dayOptions = SERVICE_DAYS.map((d) => ({ label: DAY_LABELS[d], value: d }));

const form = reactive({
  name: 'Pool',
  type: 'chlorine' as Pool['type'],
  volumeGal: 15000,
  serviceDay: 'mon' as ServiceDay,
  routeOrder: 1,
  surface: '',
  accessNotes: '',
  active: true,
  address: { line1: '', line2: '', city: '', state: 'TX', zip: '' },
});

// New pool: next stop number on that day.
watch(
  () => [form.serviceDay, data.pools.length],
  () => {
    if (!isNew.value) return;
    const same = data.pools.filter((p) => p.serviceDay === form.serviceDay);
    form.routeOrder = same.length ? Math.max(...same.map((p) => p.routeOrder)) + 1 : 1;
  },
  { immediate: true },
);

watch(
  existing,
  (p) => {
    if (!p) return;
    form.name = p.name;
    form.type = p.type;
    form.volumeGal = p.volumeGal;
    form.serviceDay = p.serviceDay;
    form.routeOrder = p.routeOrder;
    form.surface = p.surface ?? '';
    form.accessNotes = p.accessNotes;
    form.active = p.active;
    useOwnAddress.value = !!p.address;
    if (p.address) form.address = { line2: '', ...p.address } as typeof form.address;
  },
  { immediate: true },
);

async function save() {
  if (!customerId.value) return;
  const a = form.address;
  const body: Partial<Pool> = {
    customerId: customerId.value,
    name: form.name.trim() || 'Pool',
    type: form.type,
    volumeGal: Number(form.volumeGal),
    serviceDay: form.serviceDay,
    routeOrder: Number(form.routeOrder) || 0,
    accessNotes: form.accessNotes.trim(),
    active: form.active,
    ...(form.surface.trim() ? { surface: form.surface.trim() } : {}),
    ...(useOwnAddress.value
      ? { address: { line1: a.line1.trim(), city: a.city.trim(), state: a.state.trim(), zip: a.zip.trim(), ...(a.line2.trim() ? { line2: a.line2.trim() } : {}) } }
      : {}),
  };
  busy.value = true;
  try {
    const saved = await data.savePool(poolId.value, body);
    await router.replace(`/pools/${saved._id}/overview`);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}

function remove() {
  if (!poolId.value) return;
  $q.dialog({ title: 'Delete pool?', message: 'It is removed from the route. Visit history is kept.', cancel: true, ok: { label: 'Delete', color: 'negative', unelevated: true } }).onOk(
    async () => {
      const cid = existing.value?.customerId;
      await data.deletePool(poolId.value!);
      await router.replace(cid ? `/customers/${cid}` : '/');
    },
  );
}
</script>
