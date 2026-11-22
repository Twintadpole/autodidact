<template>
  <div class="column no-wrap full-height" data-test="money-card">
    <div class="row items-end q-gutter-x-lg">
      <div>
        <div class="hero" :class="{ 'text-negative': current.profit < 0 }" data-test="money-card-profit">{{ fmt(current.profit) }}</div>
        <div class="hero-sub">{{ $t(`profit this month`) }}</div>
      </div>
      <div class="hero-sub">
        {{ fmt(current.income) }} in · {{ fmt(current.costs) }} running costs
        <div v-if="previous">
          <q-icon :name="delta >= 0 ? 'trending_up' : 'trending_down'" />
          {{ delta >= 0 ? '+' : '−' }}{{ fmt(Math.abs(delta)) }} vs {{ previous.label }}
        </div>
      </div>
    </div>

    <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
      <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
        <EChart :option="option" :label="$t('Income, running costs and profit by month, last {months} months', { months: tools.months })" />
      </div>
      <!-- Table view of the same figures -->
      <CardTable
        v-if="mode === 'l'"
        name="money-by-month"
        :columns="columns"
        :rows="tableRows"
        :class="side ? 'side-table scroll' : 'q-mt-sm'"
        test-id="money-table"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { computed } from 'vue';
import EChart from '@/components/desk/EChart.vue';
import CardTable, { type CardColumn } from '@/components/desk/CardTable.vue';
import { useDataStore } from '@/stores/data';
import { formatMoney, useDashTools } from '@/composables/useDashTools';
import { localDate } from '@/lib/money';
import { moneySummary } from '@/lib/report';
import { lastMonths, monthLabel } from '@/lib/visitsReport';
import { base, barEnd, categoryAxis, compactMoney, SERIES, valueAxis, zoomFor } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const tools = useDashTools();
const fmt = (v: number) => formatMoney(v, tools.format);
/** Wide enough to put the table beside the chart. */
const side = computed(() => props.mode === 'l' && props.width >= 760);

/** Month by month, oldest first, worked out on this device (works offline). */
const months = computed(() =>
  lastMonths(Math.max(2, tools.months)).map((period) => {
    const first = new Date(Number(period.slice(0, 4)), Number(period.slice(5)) - 1, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const s = moneySummary(data.invoices, data.ledger, localDate(first), localDate(last), data.settings?.mileageRate);
    return { period, label: monthLabel(period), income: s.income.total, costs: s.runningCosts, profit: s.profit };
  }),
);
const current = computed(() => months.value[months.value.length - 1]!);
const previous = computed(() => months.value[months.value.length - 2]);
const delta = computed(() => Math.round((current.value.profit - (previous.value?.profit ?? 0)) * 100) / 100);

const columns: CardColumn[] = [
  { key: 'month', label: t('Month') },
  { key: 'income', label: t('Income'), align: 'right', money: true },
  { key: 'costs', label: t('Running costs'), align: 'right', money: true },
  { key: 'profit', label: t('Profit'), align: 'right', money: true },
];
const tableRows = computed(() => [...months.value].reverse().map((m) => ({ month: m.label, income: m.income, costs: m.costs, profit: m.profit })));

const option = computed(() => {
  const compact = props.mode !== 'l';
  return {
    ...base,
    color: [...SERIES],
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: '#52514e' } },
    grid: { top: 28, left: 8, right: 8, bottom: tools.zoom ? 34 : 4, containLabel: true },
    tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: fmt },
    ...zoomFor(tools.zoom),
    xAxis: categoryAxis(months.value.map((m) => m.label)),
    yAxis: valueAxis(compactMoney),
    series: [
      { name: t('Income'), type: 'bar', data: months.value.map((m) => m.income), itemStyle: barEnd(), barGap: '8%', barMaxWidth: compact ? 12 : 18 },
      { name: t('Running costs'), type: 'bar', data: months.value.map((m) => m.costs), itemStyle: barEnd(), barMaxWidth: compact ? 12 : 18 },
      { name: t('Profit'), type: 'line', data: months.value.map((m) => m.profit), lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 8, itemStyle: { borderColor: '#fcfcfb', borderWidth: 2 } },
    ],
  };
});
</script>

<style scoped>
.chart-box {
  min-height: 150px;
}
.chart-fixed {
  height: 240px;
  flex: none;
}
.side-table {
  width: 340px;
  flex: none;
  max-height: 100%;
}
</style>
