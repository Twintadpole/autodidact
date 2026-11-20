<template>
  <div class="column no-wrap full-height" data-test="issues-card">
    <div class="row items-end q-gutter-x-lg">
      <div>
        <div class="hero" data-test="issues-open">{{ active.length }}</div>
        <div class="hero-sub">open{{ postponed ? ` · ${postponed} postponed` : '' }}</div>
      </div>
      <div v-if="counts.do_now" class="text-negative text-weight-medium" data-test="issues-do-now"><q-icon name="priority_high" /> {{ counts.do_now }} do now</div>
    </div>

    <!-- The four quadrants -->
    <div v-if="mode !== 's'" class="row q-col-gutter-sm q-mt-sm">
      <div v-for="q in QUADRANTS" :key="q.key" class="col-3">
        <div class="quad q-pa-xs text-center">
          <div class="text-h6">{{ counts[q.key] }}</div>
          <div class="text-caption text-grey-8 ellipsis">{{ q.label }}</div>
        </div>
      </div>
    </div>

    <CardTable
      v-if="mode === 'l'"
      name="open-issues"
      :columns="columns"
      :rows="tableRows"
      clickable
      empty="No open issues."
      class="q-mt-sm col scroll"
      test-id="issues-list"
      @row="(r) => router.push(`/pools/${r.poolId}/issues`)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { deriveQuadrant, QUADRANTS, type QuadrantKey } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import CardTable, { type CardColumn } from '@/components/desk/CardTable.vue';
import { useDashTools } from '@/composables/useDashTools';
import type { CardMode } from '@/lib/dashboard';

defineProps<{ mode: CardMode; width?: number }>();
const data = useDataStore();
const router = useRouter();
const tools = useDashTools();

/** Open issues of current customers; postponed ones are parked. */
const forCustomer = computed(() => data.openIssues.filter((i) => !tools.customerId || data.poolById.get(i.poolId)?.customerId === tools.customerId));
const active = computed(() => forCustomer.value.filter((i) => i.status !== 'postponed'));
const postponed = computed(() => forCustomer.value.length - active.value.length);
const counts = computed(() => {
  const c = Object.fromEntries(QUADRANTS.map((q) => [q.key, 0])) as Record<QuadrantKey, number>;
  for (const i of active.value) c[deriveQuadrant(i)]++;
  return c;
});
const rank = (k: QuadrantKey) => QUADRANTS.findIndex((q) => q.key === k);
const sorted = computed(() => [...active.value].sort((a, b) => rank(deriveQuadrant(a)) - rank(deriveQuadrant(b)) || a.createdAt.localeCompare(b.createdAt)));
const age = (iso: string) => `${formatDistanceToNowStrict(parseISO(iso))} old`;
const columns: CardColumn[] = [
  { key: 'title', label: 'Issue' },
  { key: 'pool', label: 'Customer · pool' },
  { key: 'priority', label: 'Priority' },
  { key: 'age', label: 'Age' },
];
const tableRows = computed(() =>
  sorted.value.map((i) => ({ poolId: i.poolId, title: i.title, pool: data.poolLabel(i.poolId), priority: QUADRANTS.find((q) => q.key === deriveQuadrant(i))!.label, age: age(i.createdAt) })),
);
</script>

<style scoped>
.quad {
  background: #f3f4f5;
  border-radius: 6px;
}
</style>
