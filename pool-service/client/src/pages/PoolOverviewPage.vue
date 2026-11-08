<template>
  <q-page class="q-pa-md column q-gutter-md">
    <Teleport defer to="#header-actions">
      <q-btn v-if="pool" flat round icon="edit" aria-label="Edit pool" :to="`/pools/${pool._id}/edit`" data-test="edit-pool" />
    </Teleport>

    <div v-if="!pool" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>
    <template v-else>
      <!-- Details -->
      <q-card flat bordered>
        <q-card-section class="row q-col-gutter-sm text-body2">
          <div class="col-6"><span class="text-grey-7">Type</span><br />{{ pool.type === 'salt' ? 'Salt' : 'Chlorine' }}</div>
          <div class="col-6"><span class="text-grey-7">Volume</span><br />{{ pool.volumeGal.toLocaleString() }} gal</div>
          <div class="col-6"><span class="text-grey-7">Service day</span><br />{{ DAY_LABELS[pool.serviceDay] }} (#{{ pool.routeOrder }})</div>
          <div class="col-6"><span class="text-grey-7">Surface</span><br />{{ pool.surface || '–' }}</div>
          <div v-if="pool.accessNotes" class="col-12"><span class="text-grey-7">Access</span><br />{{ pool.accessNotes }}</div>
        </q-card-section>
        <q-card-actions>
          <q-btn flat color="primary" icon="assignment" label="Log visit" no-caps :to="`/pools/${pool._id}`" />
          <q-btn v-if="customer" flat color="primary" icon="person" label="Customer" no-caps :to="`/customers/${customer._id}`" />
        </q-card-actions>
      </q-card>

      <ContactLinks v-if="customer" :customer="customer" :address="poolAddress(pool, customer)" />

      <!-- History -->
      <div>
        <div class="text-subtitle1 q-mb-xs">Recent visits</div>
        <q-card flat bordered class="q-pa-sm">
          <div class="row q-col-gutter-md q-mb-sm">
            <TrendChart class="col-6" label="FC (ppm)" :points="trend('fc')" :band="{ min: 2, max: 5 }" />
            <TrendChart class="col-6" label="pH" :points="trend('ph')" :band="{ min: 7.4, max: 7.6 }" />
          </div>
          <q-markup-table v-if="visits.length" flat dense separator="horizontal" class="history" data-test="history">
            <thead>
              <tr>
                <th class="text-left">Date</th>
                <th v-for="k in HISTORY_KEYS" :key="k">{{ readingLabel(k) }}</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in visits" :key="v._id">
                <td class="text-left">{{ shortDate(v.visitedAt) }}</td>
                <td v-for="k in HISTORY_KEYS" :key="k" class="text-right" :class="cellClass(k, v.readings[k])">{{ fmtNumber(v.readings[k]) }}</td>
                <td class="text-right">{{ v.timeLog?.segments.length ? Math.round(timeLogSeconds(v.timeLog) / 60) + 'm' : '–' }}</td>
              </tr>
            </tbody>
          </q-markup-table>
          <div v-else class="text-grey-6 q-pa-sm">No visits logged yet.</div>
        </q-card>
      </div>

      <!-- Issues -->
      <div>
        <div class="row items-center justify-between q-mb-xs">
          <div class="text-subtitle1">Open issues</div>
          <q-btn flat dense no-caps color="primary" label="All issues" :to="`/pools/${pool._id}/issues`" />
        </div>
        <q-list v-if="openIssues.length" bordered separator class="bg-white rounded-borders">
          <q-item v-for="i in openIssues" :key="i._id" clickable @click="openIssue(i)">
            <q-item-section avatar><q-icon :name="i.urgent ? 'priority_high' : 'report_problem'" :color="i.urgent ? 'negative' : 'orange-8'" /></q-item-section>
            <q-item-section>
              <q-item-label>{{ i.title }}</q-item-label>
              <q-item-label caption>{{ quadrantLabel(i) }}<span v-if="i.status === 'postponed'"> · postponed</span></q-item-label>
              <PhotoGrid
                v-if="issuePhotos.get(i._id)?.length"
                size="sm"
                class="q-mt-xs"
                :photos="issuePhotos.get(i._id)!.slice(0, 3)"
                :more="Math.max(0, issuePhotos.get(i._id)!.length - 3)"
                @open="openIssue(i)"
              />
            </q-item-section>
          </q-item>
        </q-list>
        <div v-else class="text-grey-6 text-body2">None.</div>
      </div>

      <!-- Photos -->
      <q-card flat bordered data-test="photos-card">
        <q-card-section class="q-pb-sm">
          <div class="text-subtitle1">Photos<span v-if="photoCount" class="text-grey-7"> ({{ photoCount }})</span></div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <PoolGallery ref="gallery" :pool-id="pool._id" @count="(n) => (photoCount = n)" />
        </q-card-section>
      </q-card>

      <!-- Notes -->
      <div>
        <div class="text-subtitle1 q-mb-xs">Notes</div>
        <NotesList parent-type="pool" :parent-id="pool._id" />
      </div>

      <IssueSheet v-model="issueOpen" :issue="selectedIssue" :pool-id="pool._id" @saved="gallery?.load()" />
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { deriveQuadrant, QUADRANTS, rateReading, READINGS, timeLogSeconds, type ReadingKey } from '@pool/shared';
import ContactLinks from '@/components/ContactLinks.vue';
import NotesList from '@/components/NotesList.vue';
import TrendChart from '@/components/TrendChart.vue';
import IssueSheet from '@/components/IssueSheet.vue';
import PoolGallery from '@/components/PoolGallery.vue';
import PhotoGrid from '@/components/PhotoGrid.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { DAY_LABELS, fmtNumber, poolAddress, shortDate } from '@/lib/format';
import type { Issue, Visit } from '@/lib/types';

defineOptions({ name: 'PoolOverviewPage' });

const HISTORY_KEYS: ReadingKey[] = ['fc', 'ph', 'ta', 'cya', 'salt'];

const route = useRoute();
const data = useDataStore();
const ui = useUiStore();
const visits = ref<Visit[]>([]);
const issueOpen = ref(false);
const selectedIssue = ref<Issue | null>(null);
const gallery = ref<InstanceType<typeof PoolGallery> | null>(null);
const photoCount = ref(0);
const issuePhotos = ref(new Map<string, import('@/lib/types').Photo[]>());
async function loadIssuePhotos() {
  issuePhotos.value = await data.photosByIssue(openIssues.value.map((i) => i._id)).catch(() => new Map());
}

watch(issueOpen, (open) => {
  if (open) return;
  void gallery.value?.load(); // "Save to pool" may have changed inside the sheet
  void loadIssuePhotos();
});

const poolId = computed(() => String(route.params.id));
const pool = computed(() => data.poolById.get(poolId.value));
const customer = computed(() => (pool.value ? data.customerById.get(pool.value.customerId) : undefined));
const openIssues = computed(() => data.openIssues.filter((i) => i.poolId === poolId.value));

const readingLabel = (k: ReadingKey) => READINGS.find((r) => r.key === k)?.short ?? k;
const quadrantLabel = (i: Issue) => QUADRANTS.find((q) => q.key === deriveQuadrant(i))?.label ?? '';

function cellClass(k: ReadingKey, v: number | null | undefined) {
  const s = rateReading(k, v ?? null);
  return s === 'warn' ? 'bg-amber-2' : s === 'bad' ? 'bg-red-2' : '';
}

/** Oldest → newest for the chart. */
function trend(k: ReadingKey) {
  return [...visits.value]
    .reverse()
    .map((v) => v.readings[k])
    .filter((v): v is number => typeof v === 'number')
    .map((v) => ({ v }));
}

function openIssue(i: Issue) {
  selectedIssue.value = i;
  issueOpen.value = true;
}

watch(
  [pool, customer],
  () => {
    if (pool.value) ui.setTitle(customer.value?.name ?? 'Pool', `${pool.value.name} · overview`);
  },
  { immediate: true },
);

watch(() => [openIssues.value.map((i) => i._id).join(), data.version], () => void loadIssuePhotos(), { immediate: true });
// History may arrive after the screen opens (first load on a new phone).
watch(
  () => data.version,
  async () => {
    visits.value = await data.recentVisits(poolId.value, 10);
  },
);

onMounted(async () => {
  visits.value = await data.recentVisits(poolId.value, 10);
});
</script>

<style scoped>
.history th,
.history td {
  padding: 4px 6px;
}
</style>
