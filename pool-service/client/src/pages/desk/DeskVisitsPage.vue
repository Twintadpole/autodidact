<template>
  <q-page class="q-pa-md">
    <DeskTable :rows="rows" :columns="columns" storage-key="visits" sort-by="at" descending :loading="loading" test-id="desk-visits" @row="(r) => router.push(`/pools/${r.poolId}/visits/${r._id}`)">
      <template #filters>
        <q-select v-model="period" dense outlined emit-value map-options :options="PERIOD_OPTIONS" style="width: 150px" data-test="desk-period" />
        <q-select v-model="customerId" dense outlined emit-value map-options clearable :options="customerOptions" label="Customer" style="width: 200px" data-test="desk-visit-customer" />
      </template>
      <template #actions>
        <q-chip v-if="fromPhone" dense icon="cloud_off" color="grey-3" text-color="grey-8" data-test="desk-visits-local">Only visits on this device (no connection)</q-chip>
        <q-btn flat dense no-caps icon="refresh" label="Refresh" :loading="loading" @click="load" />
      </template>
      <template v-for="r in READINGS" :key="r.key" #[`body-cell-r_${r.key}`]="props">
        <q-td :props="props" :class="RATE_CLASS[rateReading(r.key, props.value)]">{{ props.value ?? '' }}</q-td>
      </template>
    </DeskTable>
    <div class="text-caption text-grey-7 q-mt-sm">Click a visit to open it. Chemical cost is for you only.</div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { READINGS, rateReading, timeLogSeconds, type ReadingStatus } from '@pool/shared';
import DeskTable, { type DeskColumn } from '@/components/desk/DeskTable.vue';
import { useDataStore, normalizeVisit } from '@/stores/data';
import { api } from '@/stores/api';
import { db } from '@/offline/db';
import { money } from '@/lib/customer';
import { localDate, visitChemicalCost } from '@/lib/money';
import { deskRange, inPeriod, PERIOD_OPTIONS, type DeskPeriod } from '@/lib/deskPeriod';
import type { Visit } from '@/lib/types';

defineOptions({ name: 'DeskVisitsPage' });

const router = useRouter();
const data = useDataStore();
const period = ref<DeskPeriod>('thisMonth');
const customerId = ref<string | null>(null);
const visits = ref<Visit[]>([]);
const loading = ref(false);
const fromPhone = ref(false);

const RATE_CLASS: Record<ReadingStatus, string> = { ok: '', none: '', warn: 'text-orange-9 text-weight-medium', bad: 'text-negative text-weight-bold' };
const TASKS: Record<string, string> = { brushed: 'Brushed', skimmed: 'Skimmed', vacuumed: 'Vacuumed', skimmerBaskets: 'Skimmer baskets', pumpBasket: 'Pump basket', filterCleaned: 'Filter cleaned', basketsEmptied: 'Baskets' };

/** Every visit in the period from the server; with no connection, the visits this device has. */
async function load() {
  loading.value = true;
  try {
    const r = deskRange(period.value) ?? { from: '2000-01-01', to: localDate(new Date()) };
    try {
      const remote = await api<Visit[]>(`/reports/visits?from=${r.from}&to=${r.to}&tzOffsetMin=${new Date().getTimezoneOffset()}`);
      visits.value = remote.map(normalizeVisit);
      fromPhone.value = false;
    } catch {
      const pools = new Set(data.pools.map((p) => p._id));
      visits.value = (await db.visits.toArray())
        .filter((v) => !v.deletedAt && pools.has(v.poolId) && inPeriod(localDate(new Date(v.visitedAt)), period.value))
        .map(normalizeVisit);
      fromPhone.value = true;
    }
  } finally {
    loading.value = false;
  }
}
watch(period, load, { immediate: true });

interface Row {
  _id: string;
  poolId: string;
  at: string;
  customer: string;
  minutes: number | null;
  tasks: string;
  chemicals: string;
  cost: number | null;
  notes: string;
  recap: string;
  [reading: `r_${string}`]: number | null;
}
const rows = computed<Row[]>(() =>
  visits.value
    .filter((v) => !customerId.value || data.poolById.get(v.poolId)?.customerId === customerId.value)
    .map((v) => {
      const secs = timeLogSeconds(v.timeLog);
      const row: Row = {
        _id: v._id,
        poolId: v.poolId,
        at: v.visitedAt,
        customer: data.poolLabel(v.poolId),
        minutes: secs ? Math.round(secs / 60) : null,
        tasks: Object.entries(v.tasks)
          .filter(([, done]) => done)
          .map(([k]) => TASKS[k] ?? k)
          .join(', '),
        chemicals: v.doses.map((d) => `${data.chemicalById.get(d.chemicalId)?.name ?? 'Chemical'} ${d.amount} ${d.unit}`).join(', '),
        cost: visitChemicalCost(v),
        notes: v.notes ?? '',
        recap: v.recapSentAt ? v.recapSentAt.slice(0, 10) : '',
      };
      for (const r of READINGS) row[`r_${r.key}`] = v.readings[r.key] ?? null;
      return row;
    }),
);

const customerOptions = computed(() => data.customers.map((c) => ({ label: c.name, value: c._id })));
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const MAIN_READINGS = new Set(['fc', 'ph', 'ta', 'cya', 'salt']);
const columns: DeskColumn<Row>[] = [
  { name: 'at', label: 'Date', field: 'at', align: 'left', sortable: true, required: true, format: when },
  { name: 'customer', label: 'Customer · pool', field: 'customer', align: 'left', sortable: true },
  { name: 'minutes', label: 'Minutes', field: 'minutes', align: 'right', sortable: true, sum: true, format: (v: number | null) => (v == null ? '' : String(v)) },
  ...READINGS.map(
    (r): DeskColumn<Row> => ({ name: `r_${r.key}`, label: r.short, field: `r_${r.key}`, align: 'right', sortable: true, hidden: !MAIN_READINGS.has(r.key) }),
  ),
  { name: 'tasks', label: 'Tasks', field: 'tasks', align: 'left', hidden: true },
  { name: 'chemicals', label: 'Chemicals added', field: 'chemicals', align: 'left', classes: 'ellipsis wide-cell' },
  { name: 'cost', label: 'Chemical cost', field: 'cost', align: 'right', sortable: true, sum: true, format: (v: number | null) => (v == null ? '' : money(v)) },
  { name: 'notes', label: 'Notes', field: 'notes', align: 'left', classes: 'ellipsis wide-cell', hidden: true },
  { name: 'recap', label: 'Recap sent', field: 'recap', align: 'left', sortable: true, hidden: true },
];
</script>

<style scoped>
:deep(.wide-cell) {
  max-width: 280px;
}
</style>
