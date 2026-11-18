<template>
  <q-page class="q-pa-md column q-gutter-md">
    <q-list bordered separator class="bg-white rounded-borders">
      <q-item clickable to="/more/money" data-test="more-money">
        <q-item-section avatar><q-icon name="account_balance_wallet" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>Money</q-item-label>
          <q-item-label caption>This month: profit {{ money(monthSum.profit) }}</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="chevron_right" /></q-item-section>
      </q-item>
      <q-item clickable to="/more/invoices" data-test="more-invoices">
        <q-item-section avatar><q-icon name="request_quote" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>Invoices</q-item-label>
          <q-item-label caption>{{ owed ? `${money(owed)} owed` : 'Nothing owed' }}</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="chevron_right" /></q-item-section>
      </q-item>
      <q-item clickable to="/more/business" data-test="more-business">
        <q-item-section avatar><q-icon name="storefront" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>Business details</q-item-label>
          <q-item-label caption>{{ data.settings?.businessName || 'Name, logo, payment instructions' }}</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="chevron_right" /></q-item-section>
      </q-item>
      <q-item clickable to="/more/chemicals" data-test="more-chemicals">
        <q-item-section avatar><q-icon name="science" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>Chemicals</q-item-label>
          <q-item-label caption>{{ data.activeChemicals.length }} active</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="chevron_right" /></q-item-section>
      </q-item>
      <q-item data-test="backup-status">
        <q-item-section avatar><q-icon name="backup" :color="backupColor" /></q-item-section>
        <q-item-section>
          <q-item-label>Last backup</q-item-label>
          <q-item-label caption>{{ backupText }}</q-item-label>
        </q-item-section>
      </q-item>
      <q-item clickable to="/more/sync" data-test="more-sync">
        <q-item-section avatar><q-icon name="sync" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>Sync</q-item-label>
          <q-item-label caption>{{ syncCaption }}</q-item-label>
        </q-item-section>
        <q-item-section side><q-icon name="chevron_right" /></q-item-section>
      </q-item>
    </q-list>

    <q-btn outline color="grey-8" icon="logout" label="Log out" data-test="logout" @click="logout" />

    <div class="text-center text-caption text-grey-6" data-test="app-version">Pool Service v{{ version }} · built {{ builtAt }}</div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useAuthStore } from '@/stores/auth';
import { useDataStore } from '@/stores/data';
import { money } from '@/lib/customer';
import { moneySummary, periodRange } from '@/lib/report';
import { api } from '@/stores/api';
import { useSyncStore } from '@/stores/sync';

defineOptions({ name: 'MorePage' });

const router = useRouter();
const auth = useAuthStore();
const data = useDataStore();
const monthSum = computed(() => {
  const r = periodRange('thisMonth');
  return moneySummary(data.invoices, data.ledger, r.from, r.to, data.settings?.mileageRate);
});
const owed = computed(() => Math.round([...data.balanceByCustomer.values()].reduce((a, b) => a + b, 0) * 100) / 100);
const lastBackupAt = ref<string | null | undefined>(undefined);
const sync = useSyncStore();
const version = __APP_VERSION__;
const builtAt = new Date(__BUILT_AT__).toLocaleDateString();
const syncCaption = computed(() =>
  sync.failed ? `${sync.failed} change(s) need attention` : sync.pending ? `${sync.pending} change(s) waiting to upload` : 'Everything is uploaded',
);

const backupText = computed(() => {
  if (lastBackupAt.value === undefined) return 'Checking…';
  if (lastBackupAt.value === 'offline') return 'Needs a connection to check';
  if (!lastBackupAt.value) return 'No backup yet (runs nightly at 03:17 server time)';
  const d = parseISO(lastBackupAt.value);
  return `${formatDistanceToNow(d, { addSuffix: true })} · ${d.toLocaleString()}`;
});
const backupColor = computed(() => {
  if (!lastBackupAt.value || lastBackupAt.value === 'offline') return 'grey-6';
  const ageHours = (Date.now() - parseISO(lastBackupAt.value).getTime()) / 3_600_000;
  return ageHours < 36 ? 'positive' : 'negative';
});

async function logout() {
  await auth.logout();
  await router.replace('/login');
}

onMounted(async () => {
  try {
    lastBackupAt.value = (await api<{ lastBackupAt: string | null }>('/system/status')).lastBackupAt;
  } catch {
    lastBackupAt.value = 'offline';
  }
});
</script>
