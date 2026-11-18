<template>
  <q-layout view="hHh Lpr fFf" class="desk">
    <q-header elevated>
      <q-toolbar class="q-px-sm">
        <q-btn flat round icon="menu" aria-label="Menu" data-test="desk-menu-toggle" @click="menuOpen = !menuOpen" />
        <q-toolbar-title class="ellipsis q-pl-sm">
          <span data-test="page-title">{{ ui.title || route.meta.title || 'Pool Service' }}</span>
          <span v-if="ui.subtitle" class="text-caption q-ml-sm header-sub">{{ ui.subtitle }}</span>
        </q-toolbar-title>
        <div id="header-actions" class="row no-wrap items-center q-mr-sm" />
        <q-chip clickable dense :color="chip.color" text-color="white" :icon="chip.icon" class="q-mr-sm" data-test="sync-chip" @click="router.push('/more/sync')">
          {{ chip.label }}
        </q-chip>
        <q-btn flat no-caps icon="smartphone" label="Phone view" data-test="phone-view" @click="toPhone" />
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
              <q-badge :color="doNowCount ? 'negative' : 'orange-8'" :label="`${openCount} issues`" />
            </q-item-section>
          </q-item>
        </template>
      </q-list>
    </q-drawer>

    <q-page-container>
      <q-banner v-if="loadError" class="bg-red-1 text-negative" dense>
        <template #avatar><q-icon name="cloud_off" /></template>
        {{ loadError }}
        <template #action><q-btn flat label="Retry" @click="load(true)" /></template>
      </q-banner>
      <!-- Keyed: Expenses & income and Mileage share one screen component. -->
      <router-view :key="route.path" />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { useAppShell } from '@/composables/useAppShell';
import { saveView } from '@/lib/view';

defineOptions({ name: 'DeskLayout' });

const MENU = [
  { key: 'home', to: '/desk', icon: 'dashboard', label: 'Dashboard' },
  { key: 'route', to: '/desk/route', icon: 'checklist', label: 'Route', gap: true },
  { key: 'customers', to: '/desk/customers', icon: 'people', label: 'Customers' },
  { key: 'visits', to: '/desk/visits', icon: 'event_note', label: 'Visits' },
  { key: 'invoices', to: '/desk/invoices', icon: 'request_quote', label: 'Invoices', gap: true },
  { key: 'payments', to: '/desk/payments', icon: 'payments', label: 'Payments' },
  { key: 'money', to: '/desk/money', icon: 'account_balance_wallet', label: 'Expenses & income' },
  { key: 'mileage', to: '/desk/mileage', icon: 'directions_car', label: 'Mileage' },
  { key: 'chemicals', to: '/desk/chemicals', icon: 'science', label: 'Chemicals', gap: true },
  { key: 'business', to: '/desk/business', icon: 'storefront', label: 'Business details' },
];

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const data = useDataStore();
const { chip, load, loadError } = useAppShell();
const menuOpen = ref(true);

const activeIssues = computed(() => data.openIssues.filter((i) => i.status !== 'postponed'));
const openCount = computed(() => activeIssues.value.length);
const doNowCount = computed(() => activeIssues.value.filter((i) => i.urgent && i.important).length);

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
</style>
