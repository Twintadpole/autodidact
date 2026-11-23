<template>
  <q-page class="q-pa-md">
    <q-form class="column q-gutter-md" @submit.prevent="save">
      <div v-if="customer" class="text-caption text-grey-7">Customer: {{ customer.name }}</div>
      <q-input v-model="form.name" outlined :label="$t(`Pool name`)" :hint="$t(`e.g. Backyard, Spa`)" data-test="pool-name" />
      <div class="row q-col-gutter-sm">
        <q-select v-model="form.type" outlined :label="$t(`Type`)" class="col-6" emit-value map-options clearable :options="[{ label: $t('Chlorine'), value: 'chlorine' }, { label: $t('Salt'), value: 'salt' }]" data-test="pool-type" />
        <q-input v-model="form.volumeGal" outlined :label="$t(`Gallons`)" type="number" inputmode="numeric" min="0" class="col-6" data-test="pool-volume" />
      </div>
      <div class="row q-col-gutter-sm">
        <q-select v-model="form.serviceDay" outlined :label="$t(`Service day`)" class="col-8" emit-value map-options clearable :options="dayOptions" :hint="$t(`Blank: “Not scheduled” on the Route`)" data-test="pool-day" />
        <q-input v-if="form.serviceDay === 'once'" v-model="form.oneTimeDate" outlined stack-label :label="$t(`One-time date`)" type="date" class="col-12" data-test="pool-once-date" />
        <q-input v-model.number="form.routeOrder" outlined :label="$t(`Stop #`)" type="number" inputmode="numeric" class="col-4" data-test="pool-order" />
      </div>
      <q-input v-model="form.surface" outlined :label="$t(`Surface`)" :hint="$t(`plaster, pebble, vinyl, fiberglass…`)" />
      <q-input v-model="form.accessNotes" outlined autogrow :label="$t(`Access notes`)" :hint="$t(`Gate code, dog, where the equipment is`)" data-test="pool-access" />

      <q-toggle v-model="useOwnAddress" :label="$t(`Different address from the customer`)" />
      <AddressFields v-if="useOwnAddress" v-model="form.address" />

      <q-toggle v-model="form.active" :label="$t(`Active (on the route)`)" />
      <q-select
        v-if="auth.isOwner && techOptions.length > 1"
        v-model="form.techId"
        outlined
        emit-value
        map-options
        :options="techOptions"
        :label="$t(`Tech (whose route it's on)`)"
        :hint="$t(`That tech's phone gets this pool; nobody else's does`)"
        data-test="pool-tech"
      />

      <q-btn type="submit" color="primary" unelevated size="lg" :label="isNew ? $t('Add pool') : $t('Save')" :loading="busy" data-test="pool-save" />
      <q-btn v-if="!isNew && auth.isOwner" flat color="negative" icon="delete" :label="$t(`Delete pool`)" @click="remove" />
    </q-form>
  </q-page>
</template>

<script setup lang="ts">
import { t, translated } from '@/i18n';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { SERVICE_DAYS, type ServiceDay } from '@pool/shared';
import AddressFields from '@/components/AddressFields.vue';
import { useDataStore } from '@/stores/data';
import { useAuthStore } from '@/stores/auth';
import { errorMessage } from '@/stores/api';
import { DAY_LABELS } from '@/lib/format';
import { cleanAddress, numberOrNull } from '@/lib/customer';
import type { Pool } from '@/lib/types';

defineOptions({ name: 'PoolFormPage' });

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const data = useDataStore();
const auth = useAuthStore();
const busy = ref(false);
const techOptions = computed(() => [{ label: t('Nobody (yours)'), value: null as string | null }, ...auth.techs.filter((m) => m.role === 'tech').map((m) => ({ label: m.name, value: m._id as string | null }))]);
const useOwnAddress = ref(false);

const poolId = computed(() => (route.name === 'pool-edit' ? String(route.params.id) : null));
const isNew = computed(() => !poolId.value);
const existing = computed(() => (poolId.value ? data.poolById.get(poolId.value) : undefined));
const customerId = computed(() => (route.params.customerId ? String(route.params.customerId) : existing.value?.customerId));
const customer = computed(() => (customerId.value ? data.customerById.get(customerId.value) : undefined));

const EVERY: Record<ServiceDay, string> = translated({ mon: 'Every Monday', tue: 'Every Tuesday', wed: 'Every Wednesday', thu: 'Every Thursday', fri: 'Every Friday', sat: 'Every Saturday', sun: 'Every Sunday' });
const dayOptions = computed(() => [...SERVICE_DAYS.map((d) => ({ label: EVERY[d], value: d as ServiceDay | 'once' })), { label: t('One-time date'), value: 'once' as const }]);

const form = reactive({
  name: 'Pool',
  type: null as Pool['type'],
  volumeGal: '' as string | number,
  serviceDay: null as ServiceDay | 'once' | null,
  techId: null as string | null,
  oneTimeDate: '',
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
    const same = data.pools.filter((p) => (p.serviceDay ?? null) === (form.serviceDay === 'once' ? null : form.serviceDay));
    form.routeOrder = same.length ? Math.max(...same.map((p) => p.routeOrder)) + 1 : 1;
  },
  { immediate: true },
);

watch(
  existing,
  (p) => {
    if (!p) return;
    form.name = p.name;
    form.type = p.type ?? null;
    form.volumeGal = p.volumeGal ?? '';
    form.serviceDay = p.serviceDay ?? (p.oneTimeDate ? 'once' : null);
    form.oneTimeDate = p.oneTimeDate ? p.oneTimeDate.slice(0, 10) : '';
    form.routeOrder = p.routeOrder;
    form.surface = p.surface ?? '';
    form.accessNotes = p.accessNotes;
    form.active = p.active;
    form.techId = p.techId ?? null;
    useOwnAddress.value = !!p.address;
    if (p.address) form.address = { line1: '', line2: '', city: '', state: '', zip: '', ...p.address } as typeof form.address;
  },
  { immediate: true },
);

async function save() {
  if (!customerId.value) return;
  const address = useOwnAddress.value ? cleanAddress(form.address) : undefined;
  const gallons = numberOrNull(form.volumeGal);
  const body: Partial<Pool> = {
    customerId: customerId.value,
    name: form.name.trim() || 'Pool',
    type: form.type ?? null,
    volumeGal: gallons && gallons > 0 ? gallons : null,
    serviceDay: form.serviceDay && form.serviceDay !== 'once' ? form.serviceDay : null,
    oneTimeDate: form.serviceDay === 'once' && form.oneTimeDate ? form.oneTimeDate : null,
    routeOrder: Number(form.routeOrder) || 0,
    accessNotes: form.accessNotes.trim(),
    active: form.active,
    // A tech's new pool goes on their own route (the server does the same).
    techId: auth.isOwner ? form.techId : (existing.value?.techId ?? auth.me?._id ?? null),
    ...(form.surface.trim() ? { surface: form.surface.trim() } : {}),
    ...(address ? { address } : {}),
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
  $q.dialog({ title: t('Delete pool?'), message: t('It is removed from the route. Visit history is kept.'), cancel: true, ok: { label: t('Delete'), color: 'negative', unelevated: true } }).onOk(
    async () => {
      const cid = existing.value?.customerId;
      await data.deletePool(poolId.value!);
      await router.replace(cid ? `/customers/${cid}` : '/');
    },
  );
}
</script>
