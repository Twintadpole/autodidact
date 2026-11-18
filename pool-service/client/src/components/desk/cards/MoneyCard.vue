<template>
  <div class="column no-wrap full-height" data-test="money-card">
    <div class="row items-end q-gutter-x-lg">
      <div>
        <div class="hero" :class="{ 'text-negative': current.profit < 0 }" data-test="money-card-profit">{{ money(current.profit) }}</div>
        <div class="hero-sub">profit this month</div>
      </div>
      <div class="hero-sub">
        {{ money(current.income) }} in · {{ money(current.costs) }} running costs
        <div v-if="previous">
          <q-icon :name="delta >= 0 ? 'trending_up' : 'trending_down'" />
          {{ delta >= 0 ? '+' : '−' }}{{ money(Math.abs(delta)) }} vs {{ previous.label }}
        </div>
      </div>
    </div>

    <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
      <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
        <EChart :option="option" label="Income, running costs and profit by month, last 12 months" />
      </div>

      <!-- Table view of the same figures -->
      <q-markup-table v-if="mode === 'l'" flat dense class="month-table" :class="side ? 'side-table scroll' : 'q-mt-sm'" data-test="money-table">
      <thead>
        <tr><th class="text-left">Month</th><th class="text-right">Income</th><th class="text-right">Running costs</th><th class="text-right">Profit</th></tr>
      </thead>
      <tbody>
        <tr v-for="m in [...months].reverse()" :key="m.period">
          <td>{{ m.label }}</td>
          <td class="text-right">{{ money(m.income) }}</td>
          <td class="text-right">{{ money(m.costs) }}</td>
          <td class="text-right" :class="{ 'text-negative': m.profit < 0 }">{{ money(m.profit) }}</td>
        </tr>
      </tbody>
      </q-markup-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import EChart from '@/components/desk/EChart.vue';
import { useDataStore } from '@/stores/data';
import { money } from '@/lib/customer';
import { localDate, periodOf } from '@/lib/money';
import { moneySummary } from '@/lib/report';
import { base, barEnd, categoryAxis, compactMoney, SERIES, valueAxis } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';

const props = defineProps<{ mode: CardMode; width: number }>();
/** Wide enough to put the table beside the chart. */
const side = computed(() => props.mode === 'l' && props.width >= 760);
const data = useDataStore();

/** The last 12 months, oldest first, worked out on this device (works offline). */
const months = computed(() => {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const first = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const s = moneySummary(data.invoices, data.ledger, localDate(first), localDate(last), data.settings?.mileageRate);
    return {
      period: periodOf(first),
      label: first.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      income: s.income.total,
      costs: s.runningCosts,
      profit: s.profit,
    };
  });
});
const current = computed(() => months.value[11]!);
const previous = computed(() => months.value[10]);
const delta = computed(() => Math.round((current.value.profit - (previous.value?.profit ?? 0)) * 100) / 100);

const option = computed(() => {
  const compact = props.mode !== 'l';
  return {
    ...base,
    color: [...SERIES],
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: '#52514e' } },
    grid: { top: 28, left: 8, right: 8, bottom: 4, containLabel: true },
    tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => money(v) },
    xAxis: categoryAxis(months.value.map((m) => m.label)),
    yAxis: valueAxis(compactMoney),
    series: [
      { name: 'Income', type: 'bar', data: months.value.map((m) => m.income), itemStyle: barEnd(), barGap: '8%', barMaxWidth: compact ? 12 : 18 },
      { name: 'Running costs', type: 'bar', data: months.value.map((m) => m.costs), itemStyle: barEnd(), barMaxWidth: compact ? 12 : 18 },
      { name: 'Profit', type: 'line', data: months.value.map((m) => m.profit), lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 8, itemStyle: { borderColor: '#fcfcfb', borderWidth: 2 } },
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
.month-table {
  background: transparent;
}
.side-table {
  width: 340px;
  flex: none;
  max-height: 100%;
}
</style>
