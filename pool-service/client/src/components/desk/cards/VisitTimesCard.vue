<template>
  <div class="column no-wrap full-height" data-test="visit-times-card">
    <div v-if="!report && error" class="text-grey-7">{{ $t(`Needs a connection the first time (it uses every visit).`) }}</div>
    <template v-else-if="report">
      <div class="row items-end q-gutter-x-lg">
        <div>
          <div class="hero" data-test="visit-times-avg">{{ report.avgMin != null ? `${report.avgMin} min` : '—' }}</div>
          <div class="hero-sub">average visit, {{ tools.months }} months</div>
        </div>
        <div class="hero-sub">{{ report.timed }} of {{ report.total }} visits timed · {{ report.hours }} h on site</div>
        <q-space />
        <span v-if="error && fetchedAt" class="text-caption text-grey-7"><q-icon name="cloud_off" /> as of {{ asOf(fetchedAt) }}</span>
        <q-btn flat round dense size="sm" icon="refresh" :aria-label="$t(`Refresh`)" :loading="loading" @click="reload" />
      </div>

      <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
        <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
          <EChart :option="option" :label="$t('Average minutes per timed visit by month, last {months} months', { months: tools.months })" />
        </div>
        <CardTable v-if="mode === 'l'" name="visit-times-by-customer" :columns="columns" :rows="report.byCustomer" :class="side ? 'side-table scroll' : 'q-mt-sm'" test-id="visit-times-table" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { computed } from 'vue';
import { timeLogSeconds } from '@pool/shared';
import EChart from '@/components/desk/EChart.vue';
import CardTable, { type CardColumn } from '@/components/desk/CardTable.vue';
import { useDataStore } from '@/stores/data';
import { useCachedReport } from '@/composables/useCachedReport';
import { useDashTools } from '@/composables/useDashTools';
import { periodOf } from '@/lib/money';
import { lastMonths, monthLabel, visitsForMonths } from '@/lib/visitsReport';
import { asOf, type CardMode } from '@/lib/dashboard';
import { base, categoryAxis, SERIES, valueAxis, zoomFor } from '@/lib/chartTheme';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const tools = useDashTools();
const side = computed(() => props.mode === 'l' && props.width >= 760);

interface TimesReport {
  avgMin: number | null;
  timed: number;
  total: number;
  hours: number;
  months: { period: string; avgMin: number | null }[];
  byCustomer: { customer: string; visits: number; timed: number; avgMin: number | null; hours: number }[];
}
const periods = computed(() => lastMonths(Math.max(2, tools.months)));
const key = computed(() => `visit-times-${periods.value.at(-1)}-${periods.value.length}-${tools.customerId ?? 'all'}`);
const { data: report, fetchedAt, loading, error, reload } = useCachedReport<TimesReport>(key, async () => {
  const visits = (await visitsForMonths(periods.value.length)).filter((v) => !tools.customerId || data.poolById.get(v.poolId)?.customerId === tools.customerId);
  const byMonth = new Map<string, number[]>();
  const byCust = new Map<string, { visits: number; secs: number[] }>();
  const all: number[] = [];
  for (const v of visits) {
    const secs = v.timeLog?.finished ? timeLogSeconds(v.timeLog) : 0;
    const cust = data.customerById.get(data.poolById.get(v.poolId)?.customerId ?? '')?.name ?? 'Customer';
    const c = byCust.get(cust) ?? { visits: 0, secs: [] };
    c.visits++;
    if (secs > 0) {
      c.secs.push(secs);
      all.push(secs);
      const p = periodOf(new Date(v.visitedAt));
      byMonth.set(p, [...(byMonth.get(p) ?? []), secs]);
    }
    byCust.set(cust, c);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((t, x) => t + x, 0) / xs.length / 60) : null);
  const hrs = (xs: number[]) => Math.round((xs.reduce((t, x) => t + x, 0) / 3600) * 10) / 10;
  return {
    avgMin: avg(all),
    timed: all.length,
    total: visits.length,
    hours: hrs(all),
    months: periods.value.map((period) => ({ period, avgMin: avg(byMonth.get(period) ?? []) })),
    byCustomer: [...byCust.entries()]
      .map(([customer, c]) => ({ customer, visits: c.visits, timed: c.secs.length, avgMin: avg(c.secs), hours: hrs(c.secs) }))
      .sort((a, b) => (b.avgMin ?? -1) - (a.avgMin ?? -1)),
  };
});

const columns: CardColumn[] = [
  { key: 'customer', label: t('Customer'), class: 'ellipsis' },
  { key: 'visits', label: t('Visits'), align: 'right' },
  { key: 'timed', label: t('Timed'), align: 'right' },
  { key: 'avgMin', label: t('Avg min'), align: 'right' },
  { key: 'hours', label: t('Hours'), align: 'right' },
];

const option = computed(() => ({
  ...base,
  grid: { top: 8, left: 8, right: 8, bottom: tools.zoom ? 34 : 4, containLabel: true },
  tooltip: { ...base.tooltip, trigger: 'axis', valueFormatter: (v: number | null) => (v == null ? t('no timed visits') : `${v} min`) },
  ...zoomFor(tools.zoom),
  xAxis: categoryAxis((report.value?.months ?? []).map((m) => monthLabel(m.period))),
  yAxis: valueAxis((v: number) => `${v} min`),
  series: [
    {
      name: t('Average visit'),
      type: 'line',
      connectNulls: true,
      data: (report.value?.months ?? []).map((m) => m.avgMin),
      lineStyle: { width: 2, color: SERIES[0] },
      itemStyle: { color: SERIES[0], borderColor: '#fcfcfb', borderWidth: 2 },
      symbol: 'circle',
      symbolSize: 8,
    },
  ],
}));
</script>

<style scoped>
.chart-box {
  min-height: 130px;
}
.chart-fixed {
  height: 220px;
  flex: none;
}
.side-table {
  width: 360px;
  flex: none;
  max-height: 100%;
}
</style>
