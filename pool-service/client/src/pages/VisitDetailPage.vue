<template>
  <q-page class="q-pa-md column q-gutter-md">
    <Teleport defer to="#header-actions">
      <q-btn v-if="visit && auth.isOwner" flat round icon="history" :aria-label="$t(`Change history`)" data-test="detail-history" @click="historyOpen = true" />
    </Teleport>

    <div v-if="loading" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>
    <div v-else-if="!visit" class="text-center text-grey-7 q-pa-lg">{{ $t(`This visit isn’t on this phone and the server can’t be reached.`) }}</div>
    <template v-else>
      <VisitCard :visit="visit" readonly :title="title" data-test="visit-detail" />

      <!-- Owner only: never on invoices or recaps -->
      <div v-if="chemCost != null" class="row items-center text-body2 text-grey-8 q-px-sm" data-test="visit-chem-cost">
        <q-icon name="lock" size="16px" class="q-mr-xs" /> {{ $t(`Chemical cost (only you see this):`) }} <b class="q-ml-xs">{{ money(chemCost) }}</b>
      </div>
      <q-btn color="primary" outline icon="forward_to_inbox" :label="visit.recapSentAt ? $t('Send recap again') : $t('Send recap')" no-caps :to="`/pools/${poolId}/visits/${visit._id}/recap`" data-test="send-recap" />
      <div v-if="visit.recapSentAt" class="text-caption text-positive text-center">Recap sent {{ new Date(visit.recapSentAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) }}</div>

      <!-- Step through this pool's visits -->
      <div class="row q-col-gutter-sm">
        <div class="col-6">
          <q-btn class="full-width" outline color="primary" icon="chevron_left" :label="$t(`Older`)" no-caps :disable="!older" :to="older ? `/pools/${poolId}/visits/${older._id}` : undefined" replace data-test="older-visit" />
        </div>
        <div class="col-6">
          <q-btn class="full-width" outline color="primary" icon-right="chevron_right" :label="$t(`Newer`)" no-caps :disable="!newer" :to="newer ? `/pools/${poolId}/visits/${newer._id}` : undefined" replace data-test="newer-visit" />
        </div>
      </div>
      <q-btn flat color="primary" icon="pool" :label="`Back to ${poolTitle}`" no-caps :to="`/pools/${poolId}/overview`" data-test="back-to-pool" />

      <HistoryDialog v-model="historyOpen" collection="visits" :doc-id="visit._id" :title="$t(`Visit history`)" />
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { locale, t } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { isToday, parseISO } from 'date-fns';
import VisitCard from '@/components/VisitCard.vue';
import HistoryDialog from '@/components/HistoryDialog.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import type { Visit } from '@/lib/types';
import { visitChemicalCost } from '@/lib/money';
import { money } from '@/lib/customer';

defineOptions({ name: 'VisitDetailPage' });
const auth = useAuthStore();

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
const title = computed(() => (visit.value && isToday(parseISO(visit.value.visitedAt)) ? t('Today’s visit') : t('Visit')));
const poolTitle = computed(() => data.poolLabel(poolId.value));
const chemCost = computed(() => (visit.value ? visitChemicalCost(visit.value) : null));

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
  ([p]) => p && ui.setTitle(data.customerById.get(p.customerId)?.name ?? t('Visit'), data.poolName(p) ? t('{pool} · visit', { pool: data.poolName(p) }) : t('Visit')),
  { immediate: true, flush: 'post' },
);
</script>
