<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated>
      <q-toolbar class="q-px-sm">
        <q-btn v-if="route.meta.back" flat round icon="arrow_back" :aria-label="$t(`Back`)" data-test="back" @click="goBack" />
        <q-toolbar-title class="ellipsis" :class="route.meta.back ? 'q-pl-xs' : 'q-pl-sm'">
          <div class="ellipsis" data-test="page-title">{{ ui.title || (route.meta.title ? $t(route.meta.title) : appName) }}</div>
          <div v-if="ui.subtitle" class="text-caption ellipsis header-sub">{{ ui.subtitle }}</div>
        </q-toolbar-title>
        <!-- Help for this screen (beta) -->
        <q-btn v-if="!onHelp" flat round dense icon="help_outline" :aria-label="$t(`Help`)" data-test="help-button" @click="openHelp" />
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
        <template #action><q-btn flat :label="$t(`Retry`)" @click="load(true)" /></template>
      </q-banner>
      <router-view />
    </q-page-container>

    <q-footer bordered class="bg-white text-grey-8">
      <q-tabs dense no-caps active-color="primary" indicator-color="transparent" class="bottom-nav">
        <q-route-tab to="/" exact icon="checklist" :label="$t(`Route`)" data-test="tab-route" />
        <q-route-tab to="/customers" icon="people" :label="$t(`Customers`)" data-test="tab-customers" />
        <q-route-tab to="/issues" icon="report_problem" :label="$t(`Issues`)" data-test="tab-issues">
          <q-badge v-if="openCount" :color="doNowCount ? 'negative' : 'orange-8'" floating data-test="issues-badge">{{ openCount }}</q-badge>
        </q-route-tab>
        <q-route-tab to="/more" icon="more_horiz" :label="$t(`More`)" data-test="tab-more" />
      </q-tabs>
    </q-footer>
  </q-layout>
</template>

<script setup lang="ts">
import { appName, refreshBranding } from '@/lib/branding';
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { useAppShell } from '@/composables/useAppShell';
import { topicForScreen } from '@/lib/help';

defineOptions({ name: 'MainLayout' });
void refreshBranding();

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const data = useDataStore();
const { chip, load, loadError } = useAppShell();

// Badge: every open issue (postponed ones are parked, so not counted); red when any is "Do now".
const activeIssues = computed(() => data.openIssues.filter((i) => i.status !== 'postponed'));
const openCount = computed(() => activeIssues.value.length);
const doNowCount = computed(() => activeIssues.value.filter((i) => i.urgent && i.important).length);

const onHelp = computed(() => route.name === 'help' || route.name === 'feedback');
function openHelp() {
  const topic = topicForScreen(route.name);
  void router.push({ name: 'help', ...(topic && { params: { topic } }), query: { from: route.fullPath } });
}

function goBack() {
  if (window.history.state?.back) router.back();
  else void router.push('/');
}

watch(
  () => route.fullPath,
  () => ui.setTitle(''),
);
</script>

<style scoped>
/* On a computer, keep screens a readable width (the desktop view is under More → Desktop view). */
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
