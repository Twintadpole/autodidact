<template>
  <q-page class="q-pa-md column q-gutter-md">
    <div v-if="loading" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>
    <div v-else-if="!visits.length" class="text-center text-grey-7 q-pa-lg">No visits logged for this pool yet.</div>

    <template v-for="m in months" :key="m.key">
      <q-item-label header class="q-pb-xs q-px-none">{{ m.label }}</q-item-label>
      <q-list bordered separator class="bg-white rounded-borders">
        <q-item v-for="v in m.visits" :key="v._id" clickable :to="`/pools/${poolId}/visits/${v._id}`" data-test="visit-row">
          <q-item-section>
            <q-item-label class="text-weight-medium">{{ dayLabel(v.visitedAt) }}</q-item-label>
            <q-item-label caption>
              <span v-if="onSite(v)">{{ onSite(v) }} on site · </span>{{ v.doses.length }} dose{{ v.doses.length === 1 ? '' : 's' }}<span v-if="v.notes"> · note</span>
            </q-item-label>
            <div class="row q-gutter-xs q-mt-xs">
              <template v-for="k in KEYS" :key="k">
                <q-chip v-if="v.readings[k] != null" dense square :class="chipClass(k, v.readings[k])" class="q-ma-none q-mr-xs">{{ label(k) }} {{ fmtNumber(v.readings[k]) }}</q-chip>
              </template>
            </div>
          </q-item-section>
          <q-item-section side>
            <q-icon name="chevron_right" color="grey-6" />
          </q-item-section>
        </q-item>
      </q-list>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { format, parseISO } from 'date-fns';
import { rateReading, READINGS, timeLogSeconds, type ReadingKey } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { fmtNumber } from '@/lib/format';
import { humanDuration } from '@/lib/time';
import type { Visit } from '@/lib/types';

defineOptions({ name: 'PoolVisitsPage' });

const KEYS: ReadingKey[] = ['fc', 'ph'];
const route = useRoute();
const data = useDataStore();
const ui = useUiStore();
const poolId = computed(() => String(route.params.id));
const visits = ref<Visit[]>([]);
const loading = ref(true);

const label = (k: ReadingKey) => READINGS.find((r) => r.key === k)?.short ?? k;
const dayLabel = (iso: string) => format(parseISO(iso), 'EEE, MMM d');
const onSite = (v: Visit) => (v.timeLog?.segments.length ? humanDuration(timeLogSeconds(v.timeLog)) : '');
function chipClass(k: ReadingKey, v: number | null | undefined) {
  const s = rateReading(k, v ?? null);
  return s === 'warn' ? 'bg-amber-2' : s === 'bad' ? 'bg-red-2' : 'bg-grey-2';
}

/** Newest first, grouped by month. */
const months = computed(() => {
  const groups: { key: string; label: string; visits: Visit[] }[] = [];
  for (const v of visits.value) {
    const d = parseISO(v.visitedAt);
    const key = format(d, 'yyyy-MM');
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label: format(d, 'MMMM yyyy'), visits: [] }));
    g.visits.push(v);
  }
  return groups;
});

async function load() {
  visits.value = await data.recentVisits(poolId.value, 100);
  loading.value = false;
}

watch(
  () => data.poolById.get(poolId.value),
  (p) => p && ui.setTitle('Visits', data.poolLabel(p._id)),
  { immediate: true },
);
watch(() => data.version, load);
onMounted(load);
</script>
