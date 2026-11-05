<template>
  <q-page class="q-pa-md column q-gutter-md">
    <Teleport defer to="#header-actions">
      <q-btn v-if="poolId" flat round icon="add" aria-label="New issue" data-test="new-issue" @click="openNew" />
    </Teleport>

    <q-btn-toggle
      v-model="view"
      spread
      no-caps
      unelevated
      toggle-color="primary"
      color="grey-3"
      text-color="grey-9"
      data-test="issues-view"
      :options="[
        { label: 'Grid', value: 'grid', icon: 'grid_view' },
        { label: 'List', value: 'list', icon: 'list' },
      ]"
    />

    <div v-if="loading" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>

    <template v-else>
      <div v-if="!active.length" class="text-center text-grey-7 q-pa-md" data-test="no-issues">
        <q-icon name="task_alt" size="40px" color="positive" />
        <div>No open issues{{ poolId ? ' for this pool' : '' }}.</div>
      </div>

      <!-- Eisenhower grid -->
      <div v-else-if="view === 'grid'" class="quad-grid" data-test="issues-grid">
        <div v-for="q in quadrants" :key="q.key" class="quad" :class="`quad--${q.key}`" :data-test="`quad-${q.key}`">
          <div class="quad-title">{{ q.label }} <span class="text-grey-7">({{ q.items.length }})</span></div>
          <div v-for="i in q.items" :key="i._id" class="quad-item" :data-test="`issue-${i._id}`" @click="openIssue(i)">
            <div class="text-body2 text-weight-medium ellipsis-2-lines">{{ i.title }}</div>
            <div v-if="!poolId" class="text-caption text-grey-7 ellipsis">{{ poolName(i.poolId) }}</div>
          </div>
        </div>
      </div>

      <!-- Sorted list -->
      <q-list v-else bordered separator class="bg-white rounded-borders" data-test="issues-list">
        <q-item v-for="i in sortedActive" :key="i._id" clickable :data-test="`issue-${i._id}`" @click="openIssue(i)">
          <q-item-section avatar><q-icon :name="QUAD_ICON[deriveQuadrant(i)]" :color="QUAD_COLOR[deriveQuadrant(i)]" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ i.title }}</q-item-label>
            <q-item-label caption>
              {{ quadLabel(i) }}<span v-if="!poolId"> · {{ poolName(i.poolId) }}</span><span v-if="i.status === 'in_progress'"> · in progress</span>
            </q-item-label>
          </q-item-section>
          <q-item-section side class="text-caption">{{ shortDate(i.createdAt) }}</q-item-section>
        </q-item>
      </q-list>

      <!-- Postponed -->
      <q-expansion-item v-if="postponed.length" :label="`Postponed (${postponed.length})`" icon="schedule" header-class="text-grey-8" class="bg-white rounded-borders" dense-toggle data-test="postponed-section">
        <q-list separator>
          <q-item v-for="i in postponed" :key="i._id" clickable :data-test="`issue-${i._id}`" @click="openIssue(i)">
            <q-item-section>
              <q-item-label>{{ i.title }}</q-item-label>
              <q-item-label caption>Postponed {{ shortDate(i.postponedAt) }}<span v-if="!poolId"> · {{ poolName(i.poolId) }}</span></q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-expansion-item>

      <!-- Completed (pool view only) -->
      <q-expansion-item v-if="poolId && completed.length" :label="`Completed (${completed.length})`" icon="task_alt" header-class="text-grey-8" class="bg-white rounded-borders" data-test="completed-section">
        <q-list separator>
          <q-item v-for="i in completed" :key="i._id" clickable @click="openIssue(i)">
            <q-item-section>
              <q-item-label class="text-strike text-grey-7">{{ i.title }}</q-item-label>
              <q-item-label caption>Completed {{ shortDate(i.resolvedAt) }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-expansion-item>

      <q-btn v-if="poolId" outline color="orange-9" icon="add_alert" label="New issue" no-caps @click="openNew" />
    </template>

    <IssueSheet v-model="sheetOpen" :issue="selected" :pool-id="selected?.poolId ?? poolId ?? ''" @saved="reload" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { deriveQuadrant, QUADRANTS, type QuadrantKey } from '@pool/shared';
import IssueSheet from '@/components/IssueSheet.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { shortDate } from '@/lib/format';
import type { Issue } from '@/lib/types';

defineOptions({ name: 'IssuesPage' });

const QUAD_ICON: Record<QuadrantKey, string> = { do_now: 'priority_high', schedule: 'event', quick_fix: 'bolt', someday: 'hourglass_empty' };
const QUAD_COLOR: Record<QuadrantKey, string> = { do_now: 'negative', schedule: 'orange-8', quick_fix: 'primary', someday: 'grey-6' };
const QUAD_ORDER: QuadrantKey[] = ['do_now', 'schedule', 'quick_fix', 'someday'];

const route = useRoute();
const data = useDataStore();
const ui = useUiStore();
const view = ref<'grid' | 'list'>('grid');
const sheetOpen = ref(false);
const selected = ref<Issue | null>(null);
const poolIssueList = ref<Issue[]>([]);
const loading = ref(false);

const poolId = computed(() => (route.params.id ? String(route.params.id) : null));

/** From the bottom nav: every open issue. From a pool: that pool's issues, completed ones included. */
const all = computed(() => (poolId.value ? poolIssueList.value : data.openIssues));
const active = computed(() => all.value.filter((i) => i.status === 'open' || i.status === 'in_progress'));
const postponed = computed(() => all.value.filter((i) => i.status === 'postponed'));
const completed = computed(() => all.value.filter((i) => i.status === 'resolved').sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')));

const quadrants = computed(() =>
  QUADRANTS.map((q) => ({ ...q, items: active.value.filter((i) => deriveQuadrant(i) === q.key) })),
);
const sortedActive = computed(() =>
  [...active.value].sort((a, b) => QUAD_ORDER.indexOf(deriveQuadrant(a)) - QUAD_ORDER.indexOf(deriveQuadrant(b)) || a.createdAt.localeCompare(b.createdAt)),
);

const quadLabel = (i: Issue) => QUADRANTS.find((q) => q.key === deriveQuadrant(i))?.label ?? '';

function poolName(id: string) {
  const p = data.poolById.get(id);
  if (!p) return '';
  return `${data.customerById.get(p.customerId)?.name ?? ''} · ${p.name}`;
}

function openIssue(i: Issue) {
  selected.value = i;
  sheetOpen.value = true;
}

function openNew() {
  selected.value = null;
  sheetOpen.value = true;
}

async function reload() {
  if (!poolId.value) return;
  loading.value = poolIssueList.value.length === 0;
  try {
    poolIssueList.value = await data.poolIssues(poolId.value);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [poolId.value, data.loaded],
  () => {
    if (poolId.value) {
      const p = data.poolById.get(poolId.value);
      ui.setTitle('Issues', p ? poolName(p._id) : '');
    }
  },
  { immediate: true },
);

onMounted(reload);
</script>

<style scoped>
.quad-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.quad {
  border-radius: 8px;
  padding: 8px;
  min-height: 120px;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.quad-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
}
.quad-item {
  background: white;
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
.quad--do_now {
  background: #ffebee;
}
.quad--schedule {
  background: #fff3e0;
}
.quad--quick_fix {
  background: #e3f2fd;
}
.quad--someday {
  background: #f5f5f5;
}
</style>
