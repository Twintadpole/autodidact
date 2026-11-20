<template>
  <div class="column no-wrap full-height" data-test="equipment-card">
    <div class="row items-end q-gutter-x-lg">
      <div>
        <div class="hero" data-test="equipment-count">{{ items.length }}</div>
        <div class="hero-sub">pieces of equipment</div>
      </div>
      <div class="hero-sub">
        {{ dated.length }} with an install date{{ oldest ? ` · oldest ${oldest.age} yr (${oldest.what})` : '' }}
        <div v-if="old.length" class="text-orange-9 text-weight-medium" data-test="equipment-old"><q-icon name="history" /> {{ old.length }} over {{ OLD }} years</div>
      </div>
    </div>

    <div v-if="mode !== 's'" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
      <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
        <EChart :option="option" label="Equipment by age" />
      </div>
      <CardTable
        v-if="mode === 'l'"
        name="equipment-age"
        :columns="columns"
        :rows="tableRows"
        clickable
        empty="No equipment recorded yet."
        :class="side ? 'side-table scroll' : 'q-mt-sm'"
        test-id="equipment-table"
        @row="(r) => router.push(`/pools/${r.poolId}/overview`)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import EChart from '@/components/desk/EChart.vue';
import CardTable, { type CardColumn } from '@/components/desk/CardTable.vue';
import { useDataStore } from '@/stores/data';
import { useDashTools } from '@/composables/useDashTools';
import { EQUIPMENT_LABEL } from '@/lib/customer';
import { AGE_RAMP, base, barEnd, categoryAxis, INK, valueAxis } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const router = useRouter();
const tools = useDashTools();
const side = computed(() => props.mode === 'l' && props.width >= 760);
/** Years after which equipment is flagged as old. */
const OLD = 8;

/** Every piece of equipment on active pools of current customers (or the chosen customer). */
const items = computed(() => {
  const now = Date.now();
  const pools = tools.customerId ? data.pools.filter((p) => p.customerId === tools.customerId) : data.routePools;
  return pools.flatMap((p) =>
    (p.equipment ?? []).map((e) => {
      const installed = e.installedOn ? e.installedOn.slice(0, 10) : null;
      const age = installed ? Math.floor(((now - new Date(installed + 'T12:00').getTime()) / (365.25 * 86_400_000)) * 10) / 10 : null;
      return { poolId: p._id, pool: data.poolLabel(p._id), what: e.name?.trim() || EQUIPMENT_LABEL[e.kind], model: e.model ?? '', installed, age };
    }),
  );
});
const dated = computed(() => items.value.filter((i) => i.age != null).sort((a, b) => b.age! - a.age!));
const oldest = computed(() => dated.value[0]);
const old = computed(() => dated.value.filter((i) => i.age! >= OLD));

const BUCKETS = [
  { label: '0–2 yr', test: (a: number) => a < 3 },
  { label: '3–5', test: (a: number) => a >= 3 && a < 6 },
  { label: '6–8', test: (a: number) => a >= 6 && a < 9 },
  { label: '9–11', test: (a: number) => a >= 9 && a < 12 },
  { label: '12+', test: (a: number) => a >= 12 },
];

const columns: CardColumn[] = [
  { key: 'pool', label: 'Customer · pool', class: 'ellipsis' },
  { key: 'what', label: 'Equipment' },
  { key: 'model', label: 'Model' },
  { key: 'installed', label: 'Installed' },
  { key: 'age', label: 'Years', align: 'right' },
];
/** Oldest first; equipment without a date at the end. */
const tableRows = computed(() => [...dated.value, ...items.value.filter((i) => i.age == null)]);

const option = computed(() => ({
  ...base,
  grid: { top: 18, left: 8, right: 8, bottom: 4, containLabel: true },
  tooltip: { ...base.tooltip, trigger: 'item', valueFormatter: (v: number) => `${v} piece${v === 1 ? '' : 's'}` },
  xAxis: categoryAxis([...BUCKETS.map((b) => b.label), 'No date']),
  yAxis: valueAxis((v: number) => String(v)),
  series: [
    {
      name: 'Equipment',
      type: 'bar',
      barMaxWidth: 36,
      // One hue, light = newer, dark = older; "No date" in grey.
      data: [
        ...BUCKETS.map((b, i) => ({ value: dated.value.filter((x) => b.test(x.age!)).length, itemStyle: { ...barEnd(), color: AGE_RAMP[i] } })),
        { value: items.value.length - dated.value.length, itemStyle: { ...barEnd(), color: INK.axis } },
      ],
      label: { show: true, position: 'top', color: INK.secondary, formatter: (p: { value: number }) => (p.value ? String(p.value) : '') },
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
  width: 420px;
  flex: none;
  max-height: 100%;
}
</style>
