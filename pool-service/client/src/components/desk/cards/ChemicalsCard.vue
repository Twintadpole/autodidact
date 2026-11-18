<template>
  <div class="column no-wrap full-height" data-test="chemicals-card">
    <div v-if="!report && error" class="text-grey-7">Needs a connection the first time (it uses every visit).</div>
    <template v-else-if="report">
      <div class="row items-end q-gutter-x-lg">
        <div>
          <div class="hero" data-test="chem-month">{{ money(thisMonth) }}</div>
          <div class="hero-sub">chemicals this month</div>
        </div>
        <div class="hero-sub">
          {{ money(lastMonth) }} last month · {{ money(yearTotal) }} in 12 months
          <div v-if="report.unpriced" class="text-orange-9"><q-icon name="info" /> {{ report.unpriced }} dose{{ report.unpriced === 1 ? '' : 's' }} without a price</div>
        </div>
        <q-space />
        <span v-if="error && fetchedAt" class="text-caption text-grey-7"><q-icon name="cloud_off" /> as of {{ asOf }}</span>
        <q-btn flat round dense size="sm" icon="refresh" aria-label="Refresh" :loading="loading" @click="reload" />
      </div>

      <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
        <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
          <EChart :option="option" label="Chemical cost by month, last 12 months" />
        </div>
        <q-markup-table v-if="mode === 'l'" flat dense class="bg-transparent" :class="side ? 'side-table scroll' : 'q-mt-sm'" data-test="chem-table">
          <thead>
            <tr><th class="text-left">Chemical</th><th class="text-right">This month</th><th class="text-right">12 months</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in byChemical" :key="c.id">
              <td class="ellipsis" style="max-width: 160px">{{ c.name }}</td>
              <td class="text-right">{{ c.month ? money(c.month) : '' }}</td>
              <td class="text-right">{{ money(c.year) }}</td>
            </tr>
          </tbody>
        </q-markup-table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import EChart from '@/components/desk/EChart.vue';
import { api } from '@/stores/api';
import { useDataStore } from '@/stores/data';
import { useCachedReport } from '@/composables/useCachedReport';
import { money } from '@/lib/customer';
import { localDate, periodOf } from '@/lib/money';
import { base, barEnd, categoryAxis, compactMoney, SERIES, valueAxis } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';
import type { Visit } from '@/lib/types';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const side = computed(() => props.mode === 'l' && props.width >= 760);

/** Owner-only: dose costs saved with each visit, by month and by chemical. */
interface ChemReport {
  months: { period: string; cost: number }[];
  /** chemicalId → { period → cost } */
  byChemical: Record<string, Record<string, number>>;
  unpriced: number;
}
const now = new Date();
const periods = Array.from({ length: 12 }, (_, i) => periodOf(new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)));
const key = computed(() => `chemicals-${periods[11]}`);
const { data: report, fetchedAt, loading, error, reload } = useCachedReport<ChemReport>(key, async () => {
  const from = `${periods[0]}-01`;
  const to = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const visits = await api<Visit[]>(`/reports/visits?from=${from}&to=${to}&tzOffsetMin=${now.getTimezoneOffset()}&limit=5000`);
  const months = new Map(periods.map((p) => [p, 0]));
  const byChemical: ChemReport['byChemical'] = {};
  let unpriced = 0;
  for (const v of visits) {
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
  return { months: periods.map((period) => ({ period, cost: Math.round((months.get(period) ?? 0) * 100) / 100 })), byChemical, unpriced };
});
const asOf = computed(() => (fetchedAt.value ? new Date(fetchedAt.value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''));

const r2 = (n: number) => Math.round(n * 100) / 100;
const costIn = (p: string | undefined) => report.value?.months.find((m) => m.period === p)?.cost ?? 0;
const thisMonth = computed(() => costIn(periods[11]));
const lastMonth = computed(() => costIn(periods[10]));
const yearTotal = computed(() => r2((report.value?.months ?? []).reduce((t, m) => t + m.cost, 0)));
const byChemical = computed(() =>
  Object.entries(report.value?.byChemical ?? {})
    .map(([id, m]) => ({ id, name: data.chemicalById.get(id)?.name ?? 'Chemical', month: r2(m[periods[11]!] ?? 0), year: r2(Object.values(m).reduce((t, x) => t + x, 0)) }))
    .sort((a, b) => b.year - a.year),
);

const label = (p: string) => new Date(Number(p.slice(0, 4)), Number(p.slice(5)) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
const option = computed(() => ({
  ...base,
  grid: { top: 8, left: 8, right: 8, bottom: 4, containLabel: true },
  tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => money(v) },
  xAxis: categoryAxis((report.value?.months ?? []).map((m) => label(m.period))),
  yAxis: valueAxis(compactMoney),
  series: [{ name: 'Chemical cost', type: 'bar', barMaxWidth: 18, data: (report.value?.months ?? []).map((m) => m.cost), itemStyle: { ...barEnd(), color: SERIES[0] } }],
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
