<template>
  <div class="column no-wrap full-height" data-test="chemicals-card">
    <div v-if="!report && error" class="text-grey-7">{{ $t(`Needs a connection the first time (it uses every visit).`) }}</div>
    <template v-else-if="report">
      <div class="row items-end q-gutter-x-lg">
        <div>
          <div class="hero" data-test="chem-month">{{ fmt(thisMonth) }}</div>
          <div class="hero-sub">{{ $t(`chemicals this month`) }}</div>
        </div>
        <div class="hero-sub">
          {{ fmt(lastMonth) }} last month · {{ fmt(total) }} in {{ tools.months }} months
          <div v-if="report.unpriced" class="text-orange-9"><q-icon name="info" /> {{ report.unpriced }} dose{{ report.unpriced === 1 ? '' : 's' }} without a price</div>
        </div>
        <q-space />
        <span v-if="error && fetchedAt" class="text-caption text-grey-7"><q-icon name="cloud_off" /> as of {{ asOf(fetchedAt) }}</span>
        <q-btn flat round dense size="sm" icon="refresh" :aria-label="$t(`Refresh`)" :loading="loading" @click="reload" />
      </div>

      <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
        <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
          <EChart :option="option" :label="$t('Chemical cost by month, last {months} months', { months: tools.months })" />
        </div>
        <CardTable v-if="mode === 'l'" name="chemical-costs" :columns="columns" :rows="tableRows" :class="side ? 'side-table scroll' : 'q-mt-sm'" test-id="chem-table" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { computed } from 'vue';
import EChart from '@/components/desk/EChart.vue';
import CardTable, { type CardColumn } from '@/components/desk/CardTable.vue';
import { useDataStore } from '@/stores/data';
import { useCachedReport } from '@/composables/useCachedReport';
import { formatMoney, useDashTools } from '@/composables/useDashTools';
import { periodOf } from '@/lib/money';
import { lastMonths, monthLabel, visitsForMonths } from '@/lib/visitsReport';
import { asOf } from '@/lib/dashboard';
import { base, barEnd, categoryAxis, compactMoney, SERIES, valueAxis, zoomFor } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const tools = useDashTools();
const fmt = (v: number) => formatMoney(v, tools.format);
const side = computed(() => props.mode === 'l' && props.width >= 760);

/** Owner-only: dose costs saved with each visit, by month and by chemical. */
interface ChemReport {
  months: { period: string; cost: number }[];
  /** chemicalId → { period → cost } */
  byChemical: Record<string, Record<string, number>>;
  unpriced: number;
}
const periods = computed(() => lastMonths(Math.max(2, tools.months)));
const key = computed(() => `chemicals-${periods.value.at(-1)}-${periods.value.length}-${tools.customerId ?? 'all'}`);
const { data: report, fetchedAt, loading, error, reload } = useCachedReport<ChemReport>(key, async () => {
  const visits = await visitsForMonths(periods.value.length);
  const months = new Map(periods.value.map((p) => [p, 0]));
  const byChemical: ChemReport['byChemical'] = {};
  let unpriced = 0;
  for (const v of visits) {
    if (tools.customerId && data.poolById.get(v.poolId)?.customerId !== tools.customerId) continue;
    const p = periodOf(new Date(v.visitedAt));
    for (const d of v.doses ?? []) {
      if (d.cost == null) {
        unpriced++;
        continue;
      }
      months.set(p, (months.get(p) ?? 0) + d.cost);
      const row = (byChemical[d.chemicalId] ??= {});
      row[p] = (row[p] ?? 0) + d.cost;
    }
  }
  return { months: periods.value.map((period) => ({ period, cost: Math.round((months.get(period) ?? 0) * 100) / 100 })), byChemical, unpriced };
});

const r2 = (n: number) => Math.round(n * 100) / 100;
const costIn = (p: string | undefined) => report.value?.months.find((m) => m.period === p)?.cost ?? 0;
const thisMonth = computed(() => costIn(periods.value.at(-1)));
const lastMonth = computed(() => costIn(periods.value.at(-2)));
const total = computed(() => r2((report.value?.months ?? []).reduce((t, m) => t + m.cost, 0)));

const columns = computed<CardColumn[]>(() => [
  { key: 'chemical', label: t('Chemical'), class: 'ellipsis' },
  { key: 'month', label: t('This month'), align: 'right', money: true },
  { key: 'total', label: `${tools.months} months`, align: 'right', money: true },
]);
const tableRows = computed(() =>
  Object.entries(report.value?.byChemical ?? {})
    .map(([id, m]) => ({ chemical: data.chemicalById.get(id)?.name ?? 'Chemical', month: r2(m[periods.value.at(-1)!] ?? 0) || null, total: r2(Object.values(m).reduce((t, x) => t + x, 0)) }))
    .sort((a, b) => b.total - a.total),
);

const option = computed(() => ({
  ...base,
  grid: { top: 8, left: 8, right: 8, bottom: tools.zoom ? 34 : 4, containLabel: true },
  tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: fmt },
  ...zoomFor(tools.zoom),
  xAxis: categoryAxis((report.value?.months ?? []).map((m) => monthLabel(m.period))),
  yAxis: valueAxis(compactMoney),
  series: [{ name: t('Chemical cost'), type: 'bar', barMaxWidth: 18, data: (report.value?.months ?? []).map((m) => m.cost), itemStyle: { ...barEnd(), color: SERIES[0] } }],
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
  width: 340px;
  flex: none;
  max-height: 100%;
}
</style>
