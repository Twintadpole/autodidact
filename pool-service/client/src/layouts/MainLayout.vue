<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated>
      <q-toolbar class="q-px-sm">
        <q-btn v-if="route.meta.back" flat round icon="arrow_back" aria-label="Back" data-test="back" @click="goBack" />
        <q-toolbar-title class="ellipsis" :class="route.meta.back ? 'q-pl-xs' : 'q-pl-sm'">
          <div class="ellipsis" data-test="page-title">{{ ui.title || route.meta.title || 'Pool Service' }}</div>
          <div v-if="ui.subtitle" class="text-caption ellipsis header-sub">{{ ui.subtitle }}</div>
        </q-toolbar-title>
        <!-- Sync status: tap for the Sync screen -->
        <q-chip
          clickable
          dense
          :color="chip.color"
          text-color="white"
          :icon="chip.icon"
          class="q-mr-xs"
          data-test="sync-chip"
          @click="router.push('/more/sync')"
        >
          {{ chip.label }}
        </q-chip>
        <!-- Pages put their buttons here with <Teleport defer to="#header-actions"> -->
        <div id="header-actions" class="row no-wrap items-center" />
      </q-toolbar>
    </q-header>

    <q-page-container class="page-container">
      <q-banner v-if="loadError" class="bg-red-1 text-negative" dense>
        <template #avatar><q-icon name="cloud_off" /></template>
        {{ loadError }}
        <template #action><q-btn flat label="Retry" @click="load(true)" /></template>
      </q-banner>
      <router-view />
    </q-page-container>

    <q-footer bordered class="bg-white text-grey-8">
      <q-tabs dense no-caps active-color="primary" indicator-color="transparent" class="bottom-nav">
        <q-route-tab to="/" exact icon="checklist" label="Route" data-test="tab-route" />
        <q-route-tab to="/customers" icon="people" label="Customers" data-test="tab-customers" />
        <q-route-tab to="/issues" icon="report_problem" label="Issues" data-test="tab-issues">
          <q-badge v-if="openCount" :color="doNowCount ? 'negative' : 'orange-8'" floating data-test="issues-badge">{{ openCount }}</q-badge>
        </q-route-tab>
        <q-route-tab to="/more" icon="more_horiz" label="More" data-test="tab-more" />
      </q-tabs>
    </q-footer>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useRoute, useRouter } from 'vue-router';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { useSyncStore } from '@/stores/sync';
import { requestPersistentStorage } from '@/offline/db';
import { errorMessage } from '@/stores/api';

defineOptions({ name: 'MainLayout' });

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const data = useDataStore();
const loadError = ref('');
const sync = useSyncStore();

const chip = computed(() => {
  switch (sync.state) {
    case 'failed':
      return { label: `${sync.failed} failed`, color: 'negative', icon: 'sync_problem' };
    case 'offline':
      return { label: sync.pending ? `Offline · ${sync.pending}` : 'Offline', color: 'grey-7', icon: 'cloud_off' };
    case 'syncing':
    case 'waiting':
      return { label: `${sync.pending} waiting`, color: 'orange-8', icon: 'cloud_upload' };
    default:
      return { label: 'Synced', color: 'positive', icon: 'cloud_done' };
  }
});

// Badge: every open issue (postponed ones are parked, so not counted); red when any is "Do now".
const activeIssues = computed(() => data.openIssues.filter((i) => i.status !== 'postponed'));
const openCount = computed(() => activeIssues.value.length);
const doNowCount = computed(() => activeIssues.value.filter((i) => i.urgent && i.important).length);

async function load(force = false) {
  loadError.value = '';
  try {
    await data.loadAll(force);
  } catch (err) {
    loadError.value = errorMessage(err);
  }
}

function goBack() {
  if (window.history.state?.back) router.back();
  else void router.push('/');
}

watch(
  () => route.fullPath,
  () => ui.setTitle(''),
);

// A new version was deployed: offer a one-tap refresh (unsaved visit typing is kept as a draft).
function onUpdateReady() {
  $q.notify({
    message: 'New version available',
    icon: 'system_update',
    color: 'primary',
    timeout: 0,
    position: 'top',
    actions: [
      { label: 'Refresh', color: 'white', handler: () => window.location.reload() },
      { label: 'Later', color: 'white' },
    ],
  });
}
onMounted(() => window.addEventListener('pool:update-ready', onUpdateReady));
onBeforeUnmount(() => window.removeEventListener('pool:update-ready', onUpdateReady));

onMounted(() => {
  sync.start();
  void requestPersistentStorage();
  void load();
});
</script>

<style scoped>
/* On a computer, keep screens a readable width (the desktop layout comes in Phase 7). */
.page-container :deep(.q-page) {
  max-width: 760px;
  margin-left: auto;
  margin-right: auto;
}
.header-sub {
  opacity: 0.85;
  line-height: 1.1;
}
.bottom-nav :deep(.q-tab) {
  min-height: 56px;
}
</style>
