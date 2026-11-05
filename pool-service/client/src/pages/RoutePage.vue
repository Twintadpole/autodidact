<template>
  <q-page class="q-pb-lg">
    <Teleport defer to="#header-actions">
      <q-btn flat round icon="more_vert" aria-label="Route menu" data-test="route-menu">
        <q-menu auto-close>
          <q-list style="min-width: 180px">
            <q-item clickable data-test="reset-week" @click="confirmReset">
              <q-item-section avatar><q-icon name="restart_alt" /></q-item-section>
              <q-item-section>Reset week</q-item-section>
            </q-item>
            <q-item clickable @click="data.loadAll(true)">
              <q-item-section avatar><q-icon name="refresh" /></q-item-section>
              <q-item-section>Refresh</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </Teleport>

    <!-- Progress + filter -->
    <div class="q-px-md q-pt-md q-pb-sm">
      <div class="row items-baseline justify-between">
        <div class="text-h6" data-test="done-count">{{ doneCount }} / {{ activePools.length }} done</div>
        <div class="text-caption text-grey-7">Week of {{ weekLabel }}</div>
      </div>
      <q-linear-progress :value="activePools.length ? doneCount / activePools.length : 0" rounded size="8px" color="positive" class="q-mt-xs" />
      <q-btn-toggle
        v-model="filter"
        spread
        no-caps
        unelevated
        toggle-color="primary"
        color="grey-3"
        text-color="grey-9"
        class="q-mt-md"
        data-test="route-filter"
        :options="[
          { label: 'All', value: 'all' },
          { label: 'Remaining', value: 'remaining' },
          { label: 'Done', value: 'done' },
        ]"
      />
    </div>

    <div v-if="!data.loaded && data.loading" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>

    <div v-else-if="!activePools.length" class="q-pa-lg text-center text-grey-7">
      <q-icon name="pool" size="48px" />
      <div class="q-mt-sm">No pools yet. Add a customer and their pool under Customers.</div>
      <q-btn class="q-mt-md" color="primary" unelevated label="Add customer" to="/customers/new" />
    </div>

    <template v-for="group in groups" :key="group.day">
      <q-item-label header class="row items-center justify-between q-pb-xs">
        <span :class="group.isToday ? 'text-primary text-weight-bold' : ''">
          {{ group.label }}<span v-if="group.isToday"> · Today</span>
        </span>
        <span class="text-caption">{{ group.done }}/{{ group.total }}</span>
      </q-item-label>
      <q-list bordered separator class="bg-white">
        <q-item v-for="p in group.pools" :key="p._id" class="route-row" :data-test="`route-row-${p._id}`">
          <q-item-section side class="q-pr-sm">
            <q-checkbox
              :model-value="p.week.done"
              size="lg"
              color="positive"
              :aria-label="`Done this week: ${customerName(p)}`"
              :data-test="`done-${p._id}`"
              @update:model-value="(v: boolean) => toggle(p._id, v)"
            />
          </q-item-section>
          <q-item-section class="cursor-pointer" :data-test="`open-${p._id}`" @click="open(p._id)">
            <q-item-label class="text-weight-medium" :class="{ 'text-grey-6': p.week.done }">{{ customerName(p) }}</q-item-label>
            <q-item-label caption>{{ p.name }} · {{ shortAddress(p) }}</q-item-label>
          </q-item-section>
          <q-item-section side class="row no-wrap items-center">
            <q-badge v-if="data.openIssueCount.get(p._id)" color="orange-8" class="q-mr-sm" :label="`${data.openIssueCount.get(p._id)} issue${data.openIssueCount.get(p._id)! > 1 ? 's' : ''}`" />
            <q-btn flat round color="primary" icon="directions" :href="mapsUrl(poolAddress(p, data.customerById.get(p.customerId)))" target="_blank" aria-label="Navigate" @click.stop />
          </q-item-section>
        </q-item>
      </q-list>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { format, startOfISOWeek } from 'date-fns';
import { serviceDaysFrom } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { DAY_LABELS, mapsUrl, poolAddress } from '@/lib/format';
import type { Pool } from '@/lib/types';

defineOptions({ name: 'RoutePage' });

const $q = useQuasar();
const router = useRouter();
const data = useDataStore();
const filter = ref<'all' | 'remaining' | 'done'>('all');

const activePools = computed(() => data.pools.filter((p) => p.active));
const doneCount = computed(() => activePools.value.filter((p) => p.week.done).length);
const weekLabel = format(startOfISOWeek(new Date()), 'MMM d');

const groups = computed(() => {
  const days = serviceDaysFrom(new Date());
  return days
    .map((day, i) => {
      const all = activePools.value.filter((p) => p.serviceDay === day).sort((a, b) => a.routeOrder - b.routeOrder);
      const shown = all.filter((p) => (filter.value === 'all' ? true : filter.value === 'done' ? p.week.done : !p.week.done));
      return {
        day,
        label: DAY_LABELS[day],
        isToday: i === 0,
        pools: shown,
        total: all.length,
        done: all.filter((p) => p.week.done).length,
      };
    })
    .filter((g) => g.pools.length);
});

function customerName(p: Pool) {
  return data.customerById.get(p.customerId)?.name ?? 'Unknown customer';
}

function shortAddress(p: Pool) {
  const a = poolAddress(p, data.customerById.get(p.customerId));
  return a ? `${a.line1}, ${a.city}` : '';
}

function open(id: string) {
  void router.push(`/pools/${id}`);
}

async function toggle(id: string, done: boolean) {
  try {
    await data.setDone(id, done);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
    await data.loadAll(true);
  }
}

function confirmReset() {
  $q.dialog({
    title: 'Reset week?',
    message: 'This clears the checkmark on every pool.',
    cancel: true,
    ok: { label: 'Reset', color: 'negative', unelevated: true },
  }).onOk(async () => {
    try {
      await data.resetWeek();
      $q.notify({ message: 'Week reset', color: 'grey-8' });
    } catch (err) {
      $q.notify({ type: 'negative', message: errorMessage(err) });
    }
  });
}
</script>

<style scoped>
.route-row {
  min-height: 64px;
}
</style>
