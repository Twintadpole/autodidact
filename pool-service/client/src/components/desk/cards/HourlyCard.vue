<template>
  <div class="column no-wrap full-height" data-test="hourly-card">
    <div class="row items-center q-gutter-x-sm">
      <q-btn-toggle v-model="which" dense no-caps unelevated size="sm" toggle-color="primary" color="grey-3" text-color="grey-9" :options="whichOptions" data-test="hourly-month" />
      <q-badge v-if="which === 'this'" color="orange-7" label="In progress" />
      <q-space />
      <span v-if="error && fetchedAt" class="text-caption text-grey-7" data-test="hourly-cached"><q-icon name="cloud_off" /> as of {{ asOf }}</span>
      <q-btn flat round dense size="sm" icon="refresh" aria-label="Refresh" :loading="loading" @click="reload" />
    </div>

    <div v-if="!report && error" class="text-grey-7 q-mt-sm">Needs a connection the first time (it uses every visit).</div>
    <div v-else-if="report && !rows.length" class="text-grey-7 q-mt-sm">No visits or billing this month yet.</div>
    <template v-else-if="report">
      <div class="row items-end q-gutter-x-lg q-mt-sm">
        <div>
          <div class="hero" data-test="hourly-average">{{ overall != null ? `${money(overall)}/h` : '—' }}</div>
          <div class="hero-sub">on average, {{ totals.hours }} h on site</div>
        </div>
        <div v-if="lowest" class="hero-sub">Lowest: {{ lowest.name }} {{ money(lowest.perHour!) }}/h</div>
      </div>

      <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
        <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
          <EChart :option="option" label="What each customer earns per hour, lowest first" />
        </div>
        <q-markup-table v-if="mode === 'l'" flat dense :class="side ? 'side-table scroll' : 'q-mt-sm'" class="bg-transparent" data-test="hourly-table">
          <thead>
            <tr><th class="text-left">Customer</th><th class="text-right">Visits</th><th class="text-right">Hours</th><th class="text-right">Profit</th><th class="text-right">$/h</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.customerId">
              <td class="ellipsis" style="max-width: 140px">{{ r.name }}</td>
              <td class="text-right">{{ r.visitCount }}</td>
              <td class="text-right">{{ r.hours }}</td>
              <td class="text-right">{{ money(r.profit) }}</td>
              <td class="text-right text-weight-medium" :class="{ 'text-negative': (r.perHour ?? 0) < 0 }">{{ r.perHour != null ? money(r.perHour) : '—' }}</td>
            </tr>
          </tbody>
        </q-markup-table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import EChart from '@/components/desk/EChart.vue';
import { api } from '@/stores/api';
import { useCachedReport } from '@/composables/useCachedReport';
import { money } from '@/lib/customer';
import { periodRange } from '@/lib/report';
import { base, barEnd, compactMoney, INK, SERIES, valueAxis } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';

const props = defineProps<{ mode: CardMode; width: number }>();
const side = computed(() => props.mode === 'l' && props.width >= 760);

interface Row {
  customerId: string;
  name: string;
  profit: number;
  hours: number;
  perHour: number | null;
  visitCount: number;
}
const which = ref<'this' | 'last'>('this');
const whichOptions = [
  { label: 'This month', value: 'this' },
  { label: 'Last month', value: 'last' },
];
const key = computed(() => `hourly-${which.value}`);
const { data: report, fetchedAt, loading, error, reload } = useCachedReport<{ rows: Row[] }>(key, () => {
  const r = periodRange(which.value === 'this' ? 'thisMonth' : 'lastMonth');
  return api(`/reports/customer-hours?from=${r.from}&to=${r.to}&tzOffsetMin=${new Date().getTimezoneOffset()}`);
});
const asOf = computed(() => (fetchedAt.value ? new Date(fetchedAt.value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''));

/** Customers with time on site, lowest $/h first (the server's order). */
const rows = computed(() => (report.value?.rows ?? []).filter((r) => r.perHour != null));
const totals = computed(() => {
  const profit = rows.value.reduce((t, r) => t + r.profit, 0);
  const hours = Math.round(rows.value.reduce((t, r) => t + r.hours, 0) * 10) / 10;
  return { profit, hours };
});
const overall = computed(() => (totals.value.hours ? Math.round((totals.value.profit / totals.value.hours) * 100) / 100 : null));
const lowest = computed(() => rows.value[0]);

const option = computed(() => {
  // Highest at the top of a horizontal bar chart: the axis runs bottom-up, so lowest first fills from the bottom.
  const list = [...rows.value].reverse();
  return {
    ...base,
    grid: { top: 4, left: 8, right: 40, bottom: 4, containLabel: true },
    tooltip: { ...base.tooltip, trigger: 'item', valueFormatter: (v: number) => `${money(v)}/h` },
    xAxis: valueAxis(compactMoney),
    yAxis: { type: 'category', data: list.map((r) => r.name), axisLabel: { color: INK.secondary, width: 110, overflow: 'truncate' }, axisLine: { lineStyle: { color: INK.axis } }, axisTick: { show: false } },
    series: [
      {
        name: 'Per hour',
        type: 'bar',
        barMaxWidth: 14,
        data: list.map((r) => r.perHour),
        itemStyle: { ...barEnd(true), color: SERIES[0] },
        label: { show: list.length <= 12, position: 'right', color: INK.secondary, formatter: (p: { value: number }) => compactMoney(p.value) },
      },
    ],
  };
});
</script>

<style scoped>
.chart-box {
  min-height: 130px;
}
.chart-fixed {
  height: 240px;
  flex: none;
}
.side-table {
  width: 380px;
  flex: none;
  max-height: 100%;
}
</style>
