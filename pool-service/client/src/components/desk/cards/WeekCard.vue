<template>
  <div class="column no-wrap full-height" data-test="week-card">
    <div class="row items-end q-gutter-x-lg">
      <div>
        <div class="hero" data-test="week-today">{{ today.done }} / {{ today.total }}</div>
        <div class="hero-sub">done today ({{ DAY_LABELS[todayKey] }})</div>
      </div>
      <div>
        <div class="hero hero-2" data-test="week-week">{{ week.done }} / {{ week.total }}</div>
        <div class="hero-sub">{{ $t(`this week`) }}</div>
      </div>
      <div v-if="data.activeTimers.length" class="text-positive text-weight-medium">
        <q-icon name="timer" /> {{ data.activeTimers.length }} on site now
      </div>
    </div>

    <!-- Each day of the week, today first -->
    <div v-if="mode !== 's'" class="row no-wrap q-gutter-x-sm q-mt-md" data-test="week-days">
      <div v-for="d in days" :key="d.day" class="col day" :class="{ today: d.day === todayKey }">
        <div class="text-caption ellipsis" :class="d.day === todayKey ? 'text-primary text-weight-bold' : 'text-grey-8'">{{ DAY_LABELS[d.day].slice(0, 3) }}</div>
        <div class="text-body2">{{ d.done }}/{{ d.total }}</div>
        <q-linear-progress :value="d.total ? d.done / d.total : 0" rounded size="6px" color="positive" track-color="grey-3" />
      </div>
    </div>

    <!-- Today's stops -->
    <q-list v-if="mode === 'l'" dense separator class="q-mt-md col scroll" data-test="week-stops">
      <q-item-label header class="q-px-none q-pb-xs">{{ $t(`Today's stops`) }}</q-item-label>
      <div v-if="!todayPools.length" class="text-grey-7 q-py-sm">{{ $t(`No pools today.`) }}</div>
      <q-item v-for="p in todayPools" :key="p._id" clickable class="q-px-none" @click="router.push(`/pools/${p._id}`)">
        <q-item-section avatar style="min-width: 32px">
          <q-icon :name="p.week.done ? 'check_circle' : 'radio_button_unchecked'" :color="p.week.done ? 'positive' : 'grey-5'" />
        </q-item-section>
        <q-item-section>
          <q-item-label :class="{ 'text-grey-6': p.week.done }">{{ data.poolLabel(p._id) }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="issuesOf(p._id)" side><q-badge color="orange-8" :label="$tn(issuesOf(p._id), '{n} issue', '{n} issues')" /></q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { routeSlot, serviceDaysFrom, type ServiceDay } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { DAY_LABELS } from '@/lib/format';
import type { CardMode } from '@/lib/dashboard';

defineProps<{ mode: CardMode; width?: number }>();
const data = useDataStore();
const router = useRouter();

const order = serviceDaysFrom(new Date());
const todayKey = order[0]!;
/** Pools due this week, with the day they fall on. */
const due = computed(() => {
  const now = new Date();
  return data.routePools
    .map((p) => ({ p, slot: routeSlot(p, now) }))
    .filter(({ slot }) => slot.kind === 'weekly' || slot.kind === 'once')
    .map(({ p, slot }) => ({ p, day: (slot as { day: ServiceDay }).day }));
});
const days = computed(() =>
  order.map((day) => {
    const list = due.value.filter((x) => x.day === day);
    return { day, total: list.length, done: list.filter((x) => x.p.week.done).length };
  }),
);
const today = computed(() => days.value[0]!);
const week = computed(() => ({ total: due.value.length, done: due.value.filter((x) => x.p.week.done).length }));
const todayPools = computed(() =>
  due.value
    .filter((x) => x.day === todayKey)
    .map((x) => x.p)
    .sort((a, b) => Number(a.week.done) - Number(b.week.done) || a.routeOrder - b.routeOrder),
);
const issuesOf = (poolId: string) => data.openIssueCount.get(poolId) ?? 0;
</script>

<style scoped>
.day {
  min-width: 0;
}
</style>
