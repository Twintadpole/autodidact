<template>
  <div class="column no-wrap full-height" data-test="mileage-card">
    <div class="row items-end q-gutter-x-lg">
      <div>
        <div class="hero" data-test="mileage-month">{{ fmtMiles(current.miles) }} mi</div>
        <div class="hero-sub">driven this month{{ current.worth != null ? ` · worth ${fmt(current.worth)}` : '' }}</div>
      </div>
      <div class="hero-sub">
        {{ fmtMiles(total.miles) }} mi in {{ tools.months }} months{{ total.worth != null ? ` · ${fmt(total.worth)}` : '' }}
        <div v-if="rate == null" class="text-grey-7">Set your rate per mile under Business details to see what it's worth.</div>
      </div>
    </div>

    <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
      <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
        <EChart :option="option" :label="`Miles driven by month, last ${tools.months} months`" />
      </div>
      <CardTable v-if="mode === 'l'" name="mileage-by-month" :columns="columns" :rows="tableRows" :class="side ? 'side-table scroll' : 'q-mt-sm'" test-id="mileage-table" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import EChart from '@/components/desk/EChart.vue';
import CardTable, { type CardColumn } from '@/components/desk/CardTable.vue';
import { useDataStore } from '@/stores/data';
import { formatMoney, useDashTools } from '@/composables/useDashTools';
import { lastMonths, monthLabel } from '@/lib/visitsReport';
import { base, barEnd, categoryAxis, INK, SERIES, valueAxis, zoomFor } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const tools = useDashTools();
const fmt = (v: number) => formatMoney(v, tools.format);
const fmtMiles = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
const side = computed(() => props.mode === 'l' && props.width >= 760);
const rate = computed(() => data.settings?.mileageRate ?? null);

/** Real miles from the mileage entries, by month (works offline). */
const months = computed(() =>
  lastMonths(Math.max(2, tools.months)).map((p) => {
    const miles = Math.round(data.ledger.filter((e) => e.kind === 'mileage' && e.date.slice(0, 7) === p).reduce((t, e) => t + (e.miles ?? 0), 0) * 10) / 10;
    return { p, miles, worth: rate.value != null ? Math.round(miles * rate.value * 100) / 100 : null };
  }),
);
const current = computed(() => months.value.at(-1)!);
const total = computed(() => {
  const miles = Math.round(months.value.reduce((t, m) => t + m.miles, 0) * 10) / 10;
  return { miles, worth: rate.value != null ? Math.round(miles * rate.value * 100) / 100 : null };
});

const columns: CardColumn[] = [
  { key: 'month', label: 'Month' },
  { key: 'miles', label: 'Miles', align: 'right' },
  { key: 'worth', label: 'Worth', align: 'right', money: true },
];
const tableRows = computed(() => [...months.value].reverse().map((m) => ({ month: monthLabel(m.p), miles: m.miles, worth: m.worth })));

const option = computed(() => ({
  ...base,
  grid: { top: 18, left: 8, right: 8, bottom: tools.zoom ? 34 : 4, containLabel: true },
  tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${fmtMiles(v)} mi` },
  ...zoomFor(tools.zoom),
  xAxis: categoryAxis(months.value.map((m) => monthLabel(m.p))),
  yAxis: valueAxis((v: number) => `${v}`),
  series: [
    {
      name: 'Miles',
      type: 'bar',
      barMaxWidth: 18,
      data: months.value.map((m) => m.miles),
      itemStyle: { ...barEnd(), color: SERIES[0] },
      label: { show: months.value.length <= 12, position: 'top', color: INK.secondary, formatter: (p: { value: number }) => (p.value ? fmtMiles(p.value) : '') },
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
  width: 300px;
  flex: none;
  max-height: 100%;
}
</style>
