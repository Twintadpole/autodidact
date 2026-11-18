<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-gutter-md q-mb-sm">
      <div class="text-h6" data-test="desk-done-count">{{ doneCount }} / {{ scheduled.length }} done</div>
      <div class="text-caption text-grey-7">Week of {{ weekLabel }}</div>
      <q-linear-progress :value="scheduled.length ? doneCount / scheduled.length : 0" rounded size="8px" color="positive" class="col" />
    </div>
    <DeskTable :rows="rows" :columns="columns" storage-key="route" sort-by="day" test-id="desk-route" @row="(r) => router.push(`/pools/${r._id}`)">
      <template #filters>
        <q-select v-model="dayFilter" dense outlined emit-value map-options :options="dayOptions" style="width: 170px" data-test="desk-route-day" />
        <q-btn-toggle v-model="doneFilter" dense no-caps unelevated toggle-color="primary" color="grey-3" text-color="grey-9" :options="doneOptions" data-test="desk-route-done" />
      </template>
      <template #actions>
        <q-btn flat no-caps icon="restart_alt" label="Reset week" data-test="desk-reset-week" @click="confirmReset" />
      </template>
      <template #body-cell-done="props">
        <q-td :props="props" @click.stop>
          <q-checkbox :model-value="props.value" dense color="positive" :aria-label="`Done this week: ${props.row.customer}`" :data-test="`desk-done-${props.row._id}`" @update:model-value="(v: boolean) => toggle(props.row._id, v)" />
        </q-td>
      </template>
      <template #body-cell-day="props">
        <q-td :props="props" :class="props.row.isToday ? 'text-primary text-weight-bold' : ''">{{ props.row.dayLabel }}</q-td>
      </template>
      <template #body-cell-issues="props">
        <q-td :props="props">
          <q-badge v-if="props.value" :color="props.row.doNow ? 'negative' : 'orange-8'" :label="props.value" />
        </q-td>
      </template>
    </DeskTable>
    <div class="text-caption text-grey-7 q-mt-sm">Click a pool to open its visit screen.</div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import { format, startOfISOWeek } from 'date-fns';
import { routeSlot, serviceDaysFrom, type RouteSlot, type ServiceDay } from '@pool/shared';
import DeskTable, { type DeskColumn } from '@/components/desk/DeskTable.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { DAY_LABELS, poolAddress } from '@/lib/format';
import { scheduleText } from '@/lib/customer';

defineOptions({ name: 'DeskRoutePage' });

const $q = useQuasar();
const router = useRouter();
const data = useDataStore();

const EXTRA = { upcoming: 'Coming up (one-time)', pastOnce: 'Past one-time', none: 'Not scheduled' } as const;
type GroupKey = ServiceDay | keyof typeof EXTRA;
const order: GroupKey[] = [...serviceDaysFrom(new Date()), 'upcoming', 'pastOnce', 'none'];
const groupOf = (s: RouteSlot): GroupKey => (s.kind === 'weekly' || s.kind === 'once' ? s.day : s.kind);

interface Row {
  _id: string;
  day: number;
  date: string;
  dayLabel: string;
  isToday: boolean;
  group: GroupKey;
  stop: number;
  customer: string;
  pool: string;
  address: string;
  schedule: string;
  done: boolean;
  issues: number;
  doNow: boolean;
  access: string;
}

const today = new Date();
const allRows = computed<Row[]>(() =>
  data.routePools.map((p) => {
    const slot = routeSlot(p, today);
    const group = groupOf(slot);
    const idx = order.indexOf(group);
    const a = poolAddress(p, data.customerById.get(p.customerId));
    const open = data.openIssues.filter((i) => i.poolId === p._id && i.status !== 'postponed');
    return {
      _id: p._id,
      day: idx,
      date: 'date' in slot ? slot.date : '',
      dayLabel: group in EXTRA ? EXTRA[group as keyof typeof EXTRA] : DAY_LABELS[group as ServiceDay],
      isToday: idx === 0,
      group,
      stop: p.routeOrder,
      customer: data.customerById.get(p.customerId)?.name ?? 'Customer',
      pool: data.poolName(p),
      address: [a?.line1, a?.city].filter((x) => x?.trim()).join(', '),
      schedule: scheduleText(p, DAY_LABELS),
      done: p.week.done,
      issues: open.length,
      doNow: open.some((i) => i.urgent && i.important),
      access: p.accessNotes ?? '',
    };
  }),
);

const dayFilter = ref<GroupKey | 'all'>('all');
const doneFilter = ref<'all' | 'remaining' | 'done'>('all');
const dayOptions = computed(() => [
  { label: 'All days', value: 'all' },
  ...order.filter((g) => allRows.value.some((r) => r.group === g)).map((g) => ({ label: `${g in EXTRA ? EXTRA[g as keyof typeof EXTRA] : DAY_LABELS[g as ServiceDay]}${g === order[0] ? ' · Today' : ''}`, value: g })),
]);
const doneOptions = [
  { label: 'All', value: 'all' },
  { label: 'Remaining', value: 'remaining' },
  { label: 'Done', value: 'done' },
];
const rows = computed(() =>
  allRows.value.filter((r) => (dayFilter.value === 'all' || r.group === dayFilter.value) && (doneFilter.value === 'all' || (doneFilter.value === 'done' ? r.done : !r.done))),
);

/** Due this week (weekly days and one-time dates this week): the weekly count. */
const scheduled = computed(() => allRows.value.filter((r) => !(r.group in EXTRA)));
const doneCount = computed(() => scheduled.value.filter((r) => r.done).length);
const weekLabel = format(startOfISOWeek(new Date()), 'MMM d');

const columns: DeskColumn<Row>[] = [
  { name: 'done', label: 'Done', field: 'done', align: 'center', sortable: true },
  // Day (today first), then one-time date, then stop number.
  { name: 'day', label: 'Day', field: 'day', align: 'left', sortable: true, required: true, sort: (_a, _b, x: Row, y: Row) => x.day - y.day || x.date.localeCompare(y.date) || x.stop - y.stop || x.customer.localeCompare(y.customer) },
  { name: 'stop', label: 'Stop #', field: 'stop', align: 'right', sortable: true, hidden: true },
  { name: 'customer', label: 'Customer', field: 'customer', align: 'left', sortable: true },
  { name: 'pool', label: 'Pool', field: 'pool', align: 'left', sortable: true },
  { name: 'address', label: 'Address', field: 'address', align: 'left', sortable: true },
  { name: 'schedule', label: 'Schedule', field: 'schedule', align: 'left', hidden: true },
  { name: 'issues', label: 'Open issues', field: 'issues', align: 'center', sortable: true },
  { name: 'access', label: 'Access notes', field: 'access', align: 'left', hidden: true },
];

async function toggle(id: string, done: boolean) {
  try {
    await data.setDone(id, done);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}

function confirmReset() {
  $q.dialog({ title: 'Reset week?', message: 'This clears the checkmark on every pool.', cancel: true, ok: { label: 'Reset', color: 'negative', unelevated: true } }).onOk(async () => {
    try {
      await data.resetWeek();
      $q.notify({ message: 'Week reset', color: 'grey-8' });
    } catch (err) {
      $q.notify({ type: 'negative', message: errorMessage(err) });
    }
  });
}
</script>
