<template>
  <div class="column no-wrap full-height" data-test="pipeline-card">
    <div class="row items-end q-gutter-x-lg">
      <div>
        <div class="hero" data-test="pipeline-current">{{ counts.current }}</div>
        <div class="hero-sub">{{ $t(`current customers`) }}</div>
      </div>
      <div>
        <div class="hero hero-2" data-test="pipeline-monthly">{{ fmt(monthly) }}</div>
        <div class="hero-sub">{{ $t(`a month in rates`) }}</div>
      </div>
      <div class="hero-sub" data-test="pipeline-prospects">
        {{ counts.prospect }} prospect{{ counts.prospect === 1 ? '' : 's' }}{{ prospectRates ? ` (${fmt(prospectRates)} a month)` : '' }} · {{ counts.past }} past
      </div>
    </div>

    <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
      <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
        <EChart :option="option" :label="$t('Customers started and ended by month, last {months} months', { months: tools.months })" />
      </div>
      <CardTable
        v-if="mode === 'l'"
        name="prospects"
        :columns="columns"
        :rows="tableRows"
        clickable
        :empty="$t('No prospects.')"
        :class="side ? 'side-table scroll' : 'q-mt-sm'"
        test-id="pipeline-table"
        @row="(r) => router.push(`/customers/${r.id}`)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t, locale } from '@/i18n';
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { customerStatus } from '@pool/shared';
import EChart from '@/components/desk/EChart.vue';
import CardTable, { type CardColumn } from '@/components/desk/CardTable.vue';
import { useDataStore } from '@/stores/data';
import { formatMoney, useDashTools } from '@/composables/useDashTools';
import { lastMonths, monthLabel } from '@/lib/visitsReport';
import { base, barEnd, categoryAxis, SERIES, valueAxis, zoomFor } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const router = useRouter();
const tools = useDashTools();
const fmt = (v: number) => formatMoney(v, tools.format);
const side = computed(() => props.mode === 'l' && props.width >= 760);

const withStatus = computed(() => data.customers.map((c) => ({ c, s: customerStatus(c) })));
const counts = computed(() => ({
  current: withStatus.value.filter((x) => x.s === 'current').length,
  prospect: withStatus.value.filter((x) => x.s === 'prospect').length,
  past: withStatus.value.filter((x) => x.s === 'past').length,
}));
const sumRates = (s: string) => Math.round(withStatus.value.filter((x) => x.s === s).reduce((t, x) => t + (x.c.monthlyRate ?? 0), 0) * 100) / 100;
const monthly = computed(() => sumRates('current'));
const prospectRates = computed(() => sumRates('prospect'));

/** Service start and end dates, by month (only customers with those dates filled in). */
const months = computed(() =>
  lastMonths(Math.max(2, tools.months)).map((p) => ({
    p,
    started: data.customers.filter((c) => c.startDate?.slice(0, 7) === p).length,
    ended: data.customers.filter((c) => c.endDate?.slice(0, 7) === p).length,
  })),
);

const columns: CardColumn[] = [
  { key: 'name', label: t('Prospect') },
  { key: 'rate', label: t('Rate'), align: 'right', money: true },
  { key: 'added', label: t('Added') },
];
const tableRows = computed(() =>
  withStatus.value
    .filter((x) => x.s === 'prospect')
    .sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt))
    .map((x) => ({ id: x.c._id, name: x.c.name, rate: x.c.monthlyRate ?? null, added: new Date(x.c.createdAt).toLocaleDateString(locale.value, { month: 'short', day: 'numeric', year: 'numeric' }) })),
);

const option = computed(() => ({
  ...base,
  color: [SERIES[0], SERIES[1]],
  legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: '#52514e' } },
  grid: { top: 28, left: 8, right: 8, bottom: tools.zoom ? 34 : 4, containLabel: true },
  tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
  ...zoomFor(tools.zoom),
  xAxis: categoryAxis(months.value.map((m) => monthLabel(m.p))),
  yAxis: valueAxis((v: number) => String(v)),
  series: [
    { name: t('Started'), type: 'bar', data: months.value.map((m) => m.started), itemStyle: barEnd(), barGap: '8%', barMaxWidth: 14 },
    { name: t('Ended'), type: 'bar', data: months.value.map((m) => m.ended), itemStyle: barEnd(), barMaxWidth: 14 },
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
  width: 340px;
  flex: none;
  max-height: 100%;
}
</style>
