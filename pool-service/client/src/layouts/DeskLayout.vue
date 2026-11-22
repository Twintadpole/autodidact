<template>
  <q-layout view="hHh Lpr fFf" class="desk">
    <q-header elevated>
      <q-toolbar class="q-px-sm">
        <q-btn flat round icon="menu" :aria-label="$t(`Menu`)" data-test="desk-menu-toggle" @click="menuOpen = !menuOpen" />
        <q-toolbar-title class="ellipsis q-pl-sm">
          <span data-test="page-title">{{ ui.title || (route.meta.title ? $t(route.meta.title) : appName) }}</span>
          <span v-if="ui.subtitle" class="text-caption q-ml-sm header-sub">{{ ui.subtitle }}</span>
        </q-toolbar-title>
        <div id="header-actions" class="row no-wrap items-center q-mr-sm" />
        <q-chip clickable dense :color="chip.color" text-color="white" :icon="chip.icon" class="q-mr-sm" data-test="sync-chip" @click="router.push('/more/sync')">
          {{ chip.label }}
        </q-chip>
        <q-btn flat no-caps icon="smartphone" :label="$q.screen.gt.xs ? $t('Phone view') : undefined" :aria-label="$t(`Phone view`)" data-test="phone-view" @click="toPhone" />
      </q-toolbar>
    </q-header>

    <q-drawer v-model="menuOpen" show-if-above side="left" bordered :width="232" :breakpoint="700" class="bg-grey-1">
      <q-list padding data-test="desk-menu">
        <template v-for="item in MENU" :key="item.to">
          <q-separator v-if="item.gap" spaced />
          <q-item clickable :to="item.to" :exact="item.to === '/desk'" active-class="desk-active" :data-test="`desk-nav-${item.key}`">
            <q-item-section avatar><q-icon :name="item.icon" /></q-item-section>
            <q-item-section>{{ item.label }}</q-item-section>
            <q-item-section v-if="item.key === 'route' && openCount" side>
              <q-badge :color="doNowCount ? 'negative' : 'orange-8'" :label="`${openCount} issue${openCount === 1 ? '' : 's'}`" />
            </q-item-section>
          </q-item>
        </template>
        <q-separator spaced />
        <q-item clickable :disable="exportingAll" data-test="desk-export-all" @click="exportAll">
          <q-item-section avatar><q-icon name="download" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ $t(`Export everything`) }}</q-item-label>
            <q-item-label caption>{{ $t(`One Excel file`) }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="exportingAll" side><q-spinner size="18px" /></q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <!-- Screens borrowed from the phone (Business details) keep a form width. -->
    <q-page-container :class="{ 'desk-narrow': route.meta.narrow }">
      <q-banner v-if="loadError" class="bg-red-1 text-negative" dense>
        <template #avatar><q-icon name="cloud_off" /></template>
        {{ loadError }}
        <template #action><q-btn flat :label="$t(`Retry`)" @click="load(true)" /></template>
      </q-banner>
      <!-- Keyed: Expenses & income and Mileage share one screen component. -->
      <router-view :key="route.path" />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { appName, refreshBranding } from '@/lib/branding';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { useAppShell } from '@/composables/useAppShell';
import { saveView } from '@/lib/view';
import { exportEverything } from '@/lib/exportTable';
import { errorMessage } from '@/stores/api';
import { useQuasar } from 'quasar';

defineOptions({ name: 'DeskLayout' });
void refreshBranding();

const MENU = [
  { key: 'home', to: '/desk', icon: 'dashboard', label: t('Dashboard') },
  { key: 'route', to: '/desk/route', icon: 'checklist', label: t('Route'), gap: true },
  { key: 'customers', to: '/desk/customers', icon: 'people', label: t('Customers') },
  { key: 'visits', to: '/desk/visits', icon: 'event_note', label: t('Visits') },
  { key: 'invoices', to: '/desk/invoices', icon: 'request_quote', label: t('Invoices'), gap: true },
  { key: 'payments', to: '/desk/payments', icon: 'payments', label: t('Payments') },
  { key: 'money', to: '/desk/money', icon: 'account_balance_wallet', label: t('Expenses & income') },
  { key: 'mileage', to: '/desk/mileage', icon: 'directions_car', label: t('Mileage') },
  { key: 'chemicals', to: '/desk/chemicals', icon: 'science', label: t('Chemicals'), gap: true },
  { key: 'team', to: '/desk/team', icon: 'groups', label: t('Team') },
  { key: 'business', to: '/desk/business', icon: 'storefront', label: t('Business details') },
];

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const data = useDataStore();
const { chip, load, loadError } = useAppShell();
// Closed to start with: on a computer `show-if-above` shows it anyway; on a phone it opens from ☰.
const menuOpen = ref(false);

const activeIssues = computed(() => data.openIssues.filter((i) => i.status !== 'postponed'));
const openCount = computed(() => activeIssues.value.length);
const doNowCount = computed(() => activeIssues.value.filter((i) => i.urgent && i.important).length);

const $q = useQuasar();
const exportingAll = ref(false);
async function exportAll() {
  exportingAll.value = true;
  try {
    await exportEverything();
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    exportingAll.value = false;
  }
}

function toPhone() {
  saveView('phone');
  void router.push('/');
}

watch(
  () => route.fullPath,
  () => ui.setTitle(''),
);
</script>

<style scoped>
.desk-narrow :deep(.q-page) {
  max-width: 820px;
}
.header-sub {
  opacity: 0.85;
}
.desk :deep(.desk-active) {
  color: var(--q-primary);
  background: rgba(25, 118, 210, 0.08);
  font-weight: 500;
}
</style>

<style>
/* Quick-entry row above a desktop table. */
.quick-row {
  background: #f8fafb;
  border: 1px dashed #cfd8dc;
  border-radius: 6px;
  padding: 6px 8px;
  margin-left: 0;
  margin-top: 0;
}
/* On a phone the quick-entry fields stack, one per line. */
@media (max-width: 599px) {
  .quick-row > * {
    flex: 1 1 100% !important;
    width: auto !important;
    max-width: none !important;
    margin-left: 0 !important;
  }
  .quick-row > .q-icon {
    display: none;
  }
}
</style>
