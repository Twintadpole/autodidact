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

    <div v-if="!data.loaded" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>

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
            <PhotoGrid v-if="photosOf(i).length" size="sm" class="q-mt-xs" :photos="photosOf(i).slice(0, 3)" :more="Math.max(0, photosOf(i).length - 3)" data-test="issue-strip" @open="openIssue(i)" />
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
            <PhotoGrid v-if="photosOf(i).length" size="sm" class="q-mt-xs" :photos="photosOf(i).slice(0, 3)" :more="Math.max(0, photosOf(i).length - 3)" data-test="issue-strip" @open="openIssue(i)" />
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
              <PhotoGrid v-if="photosOf(i).length" size="sm" class="q-mt-xs" :photos="photosOf(i).slice(0, 3)" :more="Math.max(0, photosOf(i).length - 3)" data-test="issue-strip" @open="openIssue(i)" />
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

    <IssueSheet v-model="sheetOpen" :issue="selected" :pool-id="selected?.poolId ?? poolId ?? ''" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { deriveQuadrant, QUADRANTS, type QuadrantKey } from '@pool/shared';
import IssueSheet from '@/components/IssueSheet.vue';
import PhotoGrid from '@/components/PhotoGrid.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { shortDate } from '@/lib/format';
import type { Issue, Photo } from '@/lib/types';

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

const poolId = computed(() => (route.params.id ? String(route.params.id) : null));

/** From the bottom nav: every open issue. From a pool: that pool's issues, completed ones included. */
/** Live from the phone's copy, so it updates as soon as a sync brings new issues. */
const all = computed(() => (poolId.value ? data.issues.filter((i) => i.poolId === poolId.value) : data.openIssues));
const active = computed(() => all.value.filter((i) => i.status === 'open' || i.status === 'in_progress'));
const postponed = computed(() => all.value.filter((i) => i.status === 'postponed'));
const completed = computed(() => all.value.filter((i) => i.status === 'resolved').sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')));

const quadrants = computed(() =>
  QUADRANTS.map((q) => ({ ...q, items: active.value.filter((i) => deriveQuadrant(i) === q.key) })),
);
const sortedActive = computed(() =>
  [...active.value].sort((a, b) => QUAD_ORDER.indexOf(deriveQuadrant(a)) - QUAD_ORDER.indexOf(deriveQuadrant(b)) || a.createdAt.localeCompare(b.createdAt)),
);

// Small photo strips under each issue
const issuePhotos = ref(new Map<string, Photo[]>());
const photosOf = (i: Issue) => issuePhotos.value.get(i._id) ?? [];
async function loadPhotos() {
  issuePhotos.value = await data.photosByIssue(all.value.map((i) => i._id)).catch(() => new Map());
}
watch(() => [all.value.map((i) => i._id).join(), data.version], loadPhotos, { immediate: true });
watch(sheetOpen, (open) => {
  if (!open) void loadPhotos();
});

const quadLabel = (i: Issue) => QUADRANTS.find((q) => q.key === deriveQuadrant(i))?.label ?? '';

const poolName = (id: string) => data.poolLabel(id);

function openIssue(i: Issue) {
  selected.value = i;
  sheetOpen.value = true;
}

function openNew() {
  selected.value = null;
  sheetOpen.value = true;
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
