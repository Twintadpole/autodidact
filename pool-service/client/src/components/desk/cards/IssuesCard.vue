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

    <q-list v-if="mode === 'l'" dense separator class="q-mt-sm col scroll" data-test="issues-list">
      <div v-if="!active.length" class="text-grey-7 q-py-sm">No open issues.</div>
      <q-item v-for="i in sorted" :key="i._id" clickable class="q-px-xs" @click="router.push(`/pools/${i.poolId}/issues`)">
        <q-item-section>
          <q-item-label>{{ i.title }}</q-item-label>
          <q-item-label caption>{{ data.poolLabel(i.poolId) }} · {{ age(i.createdAt) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge :color="deriveQuadrant(i) === 'do_now' ? 'negative' : 'grey-6'" :label="QUADRANTS.find((q) => q.key === deriveQuadrant(i))!.label" />
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { deriveQuadrant, QUADRANTS, type QuadrantKey } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import type { CardMode } from '@/lib/dashboard';

defineProps<{ mode: CardMode; width?: number }>();
const data = useDataStore();
const router = useRouter();

/** Open issues of current customers; postponed ones are parked. */
const active = computed(() => data.openIssues.filter((i) => i.status !== 'postponed'));
const postponed = computed(() => data.openIssues.length - active.value.length);
const counts = computed(() => {
  const c = Object.fromEntries(QUADRANTS.map((q) => [q.key, 0])) as Record<QuadrantKey, number>;
  for (const i of active.value) c[deriveQuadrant(i)]++;
  return c;
});
const rank = (k: QuadrantKey) => QUADRANTS.findIndex((q) => q.key === k);
const sorted = computed(() => [...active.value].sort((a, b) => rank(deriveQuadrant(a)) - rank(deriveQuadrant(b)) || a.createdAt.localeCompare(b.createdAt)));
const age = (iso: string) => `${formatDistanceToNowStrict(parseISO(iso))} old`;
</script>

<style scoped>
.quad {
  background: #f3f4f5;
  border-radius: 6px;
}
</style>
