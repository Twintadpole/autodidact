<template>
  <q-page class="q-pa-md column q-gutter-md">
    <Teleport defer to="#header-actions">
      <q-btn v-if="visit" flat round icon="history" aria-label="Change history" data-test="detail-history" @click="historyOpen = true" />
    </Teleport>

    <div v-if="loading" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>
    <div v-else-if="!visit" class="text-center text-grey-7 q-pa-lg">This visit isn’t on this phone and the server can’t be reached.</div>
    <template v-else>
      <VisitCard :visit="visit" readonly :title="title" data-test="visit-detail" />

      <!-- Step through this pool's visits -->
      <div class="row q-col-gutter-sm">
        <div class="col-6">
          <q-btn class="full-width" outline color="primary" icon="chevron_left" label="Older" no-caps :disable="!older" :to="older ? `/pools/${poolId}/visits/${older._id}` : undefined" replace data-test="older-visit" />
        </div>
        <div class="col-6">
          <q-btn class="full-width" outline color="primary" icon-right="chevron_right" label="Newer" no-caps :disable="!newer" :to="newer ? `/pools/${poolId}/visits/${newer._id}` : undefined" replace data-test="newer-visit" />
        </div>
      </div>
      <q-btn flat color="primary" icon="pool" :label="`Back to ${poolTitle}`" no-caps :to="`/pools/${poolId}/overview`" data-test="back-to-pool" />

      <HistoryDialog v-model="historyOpen" collection="visits" :doc-id="visit._id" title="Visit history" />
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { isToday, parseISO } from 'date-fns';
import VisitCard from '@/components/VisitCard.vue';
import HistoryDialog from '@/components/HistoryDialog.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import type { Visit } from '@/lib/types';

defineOptions({ name: 'VisitDetailPage' });

const route = useRoute();
const data = useDataStore();
const ui = useUiStore();
const poolId = computed(() => String(route.params.id));
const visitId = computed(() => String(route.params.visitId));
const visit = ref<Visit | undefined>();
const all = ref<Visit[]>([]);
const loading = ref(true);
const historyOpen = ref(false);

const index = computed(() => all.value.findIndex((v) => v._id === visitId.value));
const newer = computed(() => (index.value > 0 ? all.value[index.value - 1] : undefined));
const older = computed(() => (index.value >= 0 ? all.value[index.value + 1] : undefined));
const title = computed(() => (visit.value && isToday(parseISO(visit.value.visitedAt)) ? 'Today’s visit' : 'Visit'));
const poolTitle = computed(() => data.poolLabel(poolId.value));

async function load() {
  loading.value = !visit.value;
  const [v, list] = await Promise.all([data.getVisit(visitId.value), data.recentVisits(poolId.value, 100)]);
  visit.value = v;
  all.value = list;
  loading.value = false;
}

watch(visitId, load, { immediate: true });
// flush 'post': runs after the layout clears the title on navigation (Older/Newer reuse this page).
watch(
  [() => data.poolById.get(poolId.value), () => route.fullPath],
  ([p]) => p && ui.setTitle(data.customerById.get(p.customerId)?.name ?? 'Visit', data.poolName(p) ? `${data.poolName(p)} · visit` : 'Visit'),
  { immediate: true, flush: 'post' },
);
</script>
