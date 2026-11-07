<template>
  <q-page class="q-pa-md column q-gutter-md">
    <q-list bordered separator class="bg-white rounded-borders">
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
      <q-item>
        <q-item-section avatar><q-icon name="sync" color="grey-6" /></q-item-section>
        <q-item-section>
          <q-item-label>Offline sync</q-item-label>
          <q-item-label caption>Coming in Phase 4. For now the app needs signal to save.</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>

    <q-btn outline color="grey-8" icon="logout" label="Log out" data-test="logout" @click="logout" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useAuthStore } from '@/stores/auth';
import { useDataStore } from '@/stores/data';
import { api } from '@/stores/api';

defineOptions({ name: 'MorePage' });

const router = useRouter();
const auth = useAuthStore();
const data = useDataStore();
const lastBackupAt = ref<string | null | undefined>(undefined);

const backupText = computed(() => {
  if (lastBackupAt.value === undefined) return 'Checking…';
  if (!lastBackupAt.value) return 'No backup yet (runs nightly at 03:17 server time)';
  const d = parseISO(lastBackupAt.value);
  return `${formatDistanceToNow(d, { addSuffix: true })} · ${d.toLocaleString()}`;
});
const backupColor = computed(() => {
  if (!lastBackupAt.value) return 'grey-6';
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
    lastBackupAt.value = null;
  }
});
</script>
