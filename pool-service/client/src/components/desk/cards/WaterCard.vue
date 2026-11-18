<template>
  <div class="column no-wrap full-height" data-test="water-card">
    <div v-if="!report && error" class="text-grey-7">Needs a connection the first time (it uses every visit).</div>
    <template v-else-if="report">
      <div class="row items-end q-gutter-x-lg">
        <div>
          <div class="hero" :class="{ 'text-negative': report.poolsNow.length }" data-test="water-now">{{ report.poolsNow.length }}</div>
          <div class="hero-sub">pool{{ report.poolsNow.length === 1 ? '' : 's' }} with a reading way off at the last visit</div>
        </div>
        <div class="hero-sub">{{ report.visitsOff }} of {{ report.visits }} visits had something off ({{ tools.months }} months)</div>
        <q-space />
        <span v-if="error && fetchedAt" class="text-caption text-grey-7"><q-icon name="cloud_off" /> as of {{ asOf(fetchedAt) }}</span>
        <q-btn flat round dense size="sm" icon="refresh" aria-label="Refresh" :loading="loading" @click="reload" />
      </div>

      <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
        <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
          <EChart :option="option" :label="`Readings out of range by test, last ${tools.months} months`" />
        </div>
        <CardTable
          v-if="mode === 'l'"
          name="water-problems"
          :columns="columns"
          :rows="report.poolsNow"
          clickable
          empty="Every pool's last visit was in range."
          :class="side ? 'side-table scroll' : 'q-mt-sm'"
          test-id="water-table"
          @row="(r) => router.push(`/pools/${r.poolId}/overview`)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { READINGS, rateReading } from '@pool/shared';
import EChart from '@/components/desk/EChart.vue';
import CardTable, { type CardColumn } from '@/components/desk/CardTable.vue';
import { useDataStore } from '@/stores/data';
import { useCachedReport } from '@/composables/useCachedReport';
import { useDashTools } from '@/composables/useDashTools';
import { lastMonths, visitsForMonths } from '@/lib/visitsReport';
import { asOf, type CardMode } from '@/lib/dashboard';
import { base, barEnd, categoryAxis, INK, STATUS, valueAxis } from '@/lib/chartTheme';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const router = useRouter();
const tools = useDashTools();
const side = computed(() => props.mode === 'l' && props.width >= 760);

interface WaterReport {
  visits: number;
  visitsOff: number;
  /** reading key → [a little off, way off] */
  byReading: Record<string, [number, number]>;
  /** Pools whose latest visit had a reading way off (red). */
  poolsNow: { poolId: string; pool: string; date: string; readings: string }[];
}
const periods = computed(() => lastMonths(Math.max(2, tools.months)));
const key = computed(() => `water-${periods.value.at(-1)}-${periods.value.length}-${tools.customerId ?? 'all'}`);
const { data: report, fetchedAt, loading, error, reload } = useCachedReport<WaterReport>(key, async () => {
  const visits = (await visitsForMonths(periods.value.length)).filter((v) => data.poolById.has(v.poolId) && (!tools.customerId || data.poolById.get(v.poolId)?.customerId === tools.customerId));
  const byReading: WaterReport['byReading'] = {};
  let visitsOff = 0;
  const latest = new Map<string, (typeof visits)[number]>();
  for (const v of visits) {
    let off = false;
    for (const r of READINGS) {
      const st = rateReading(r.key, v.readings?.[r.key]);
      if (st === 'warn' || st === 'bad') {
        off = true;
        const row = (byReading[r.key] ??= [0, 0]);
        row[st === 'bad' ? 1 : 0]++;
      }
    }
    if (off) visitsOff++;
    const prev = latest.get(v.poolId);
    if (!prev || prev.visitedAt < v.visitedAt) latest.set(v.poolId, v);
  }
  const poolsNow = [...latest.values()]
    .map((v) => {
      const bad = READINGS.filter((r) => rateReading(r.key, v.readings?.[r.key]) === 'bad');
      const low = (r: (typeof READINGS)[number], x: number) => ('ideal' in r && r.ideal && 'min' in r.ideal && r.ideal.min != null && x < r.ideal.min ? 'low' : 'high');
      return {
        poolId: v.poolId,
        pool: data.poolLabel(v.poolId),
        date: new Date(v.visitedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        readings: bad.map((r) => `${r.short} ${v.readings![r.key]} (${low(r, v.readings![r.key]!)})`).join(', '),
      };
    })
    .filter((x) => x.readings);
  return { visits: visits.length, visitsOff, byReading, poolsNow };
});

const columns: CardColumn[] = [
  { key: 'pool', label: 'Customer · pool', class: 'ellipsis' },
  { key: 'date', label: 'Last visit' },
  { key: 'readings', label: 'Way off' },
];

const option = computed(() => {
  const keys = READINGS.filter((r) => report.value?.byReading[r.key]);
  return {
    ...base,
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: INK.secondary } },
    grid: { top: 28, left: 8, right: 8, bottom: 4, containLabel: true },
    tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: categoryAxis(keys.map((r) => r.short)),
    yAxis: valueAxis((v: number) => String(v)),
    // Status colours, named in the legend: amber = a little off, red = way off.
    series: [
      { name: 'A little off', type: 'bar', stack: 'off', barMaxWidth: 28, data: keys.map((r) => report.value!.byReading[r.key]![0]), itemStyle: { color: STATUS.warning, borderColor: '#fcfcfb', borderWidth: 1 } },
      { name: 'Way off', type: 'bar', stack: 'off', barMaxWidth: 28, data: keys.map((r) => report.value!.byReading[r.key]![1]), itemStyle: { ...barEnd(), color: STATUS.critical, borderColor: '#fcfcfb', borderWidth: 1 } },
    ],
  };
});
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
  width: 420px;
  flex: none;
  max-height: 100%;
}
</style>
