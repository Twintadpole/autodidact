<template>
  <q-page class="q-pa-md column q-gutter-md">
    <q-card flat bordered>
      <q-card-section class="row items-center no-wrap">
        <q-icon :name="statusIcon" :color="statusColor" size="32px" class="q-mr-md" />
        <div class="col">
          <div class="text-subtitle1 text-weight-medium" data-test="sync-status">{{ statusText }}</div>
          <div class="text-caption text-grey-7">
            Last download from the server: {{ sync.lastPullAt ? when(sync.lastPullAt) : 'never' }}
          </div>
        </div>
      </q-card-section>
      <q-card-actions>
        <q-btn color="primary" unelevated icon="sync" label="Sync now" :loading="sync.syncing" data-test="sync-now" @click="syncNow" />
      </q-card-actions>
    </q-card>

    <div>
      <div class="text-subtitle1 q-mb-xs">Waiting to upload ({{ sync.outbox.length }})</div>
      <div v-if="!sync.outbox.length" class="text-grey-7 text-body2">Nothing waiting. Everything on this phone is on the server.</div>
      <q-list v-else bordered separator class="bg-white rounded-borders" data-test="outbox">
        <q-item v-for="row in sync.outbox" :key="row.id" data-test="outbox-row">
          <q-item-section avatar>
            <q-icon :name="row.status === 'failed' ? 'error' : 'schedule'" :color="row.status === 'failed' ? 'negative' : 'orange-8'" />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ row.summary }}</q-item-label>
            <q-item-label caption>
              {{ when(row.createdAt) }}<span v-if="row.photoIds.length"> · {{ row.photoIds.length }} photo</span>
              <span v-if="row.attempts"> · tried {{ row.attempts }}×</span>
            </q-item-label>
            <q-item-label v-if="row.lastError" caption :class="row.status === 'failed' ? 'text-negative' : ''">{{ row.lastError }}</q-item-label>
          </q-item-section>
          <q-item-section side class="row no-wrap">
            <q-btn flat round dense icon="replay" color="primary" aria-label="Retry" @click="retry(row.id)" />
            <q-btn flat round dense icon="delete" color="grey-7" aria-label="Discard" @click="discard(row)" />
          </q-item-section>
        </q-item>
      </q-list>
    </div>

    <q-expansion-item icon="build" label="Advanced" header-class="text-grey-8" class="bg-white rounded-borders">
      <q-card>
        <q-card-section class="text-body2">
          <b>Reload from server</b> replaces this phone's copy with what's on the server. Use it if something looks wrong after
          discarding a change. Only possible when nothing is waiting to upload.
        </q-card-section>
        <q-card-actions>
          <q-btn outline color="primary" label="Reload from server" :disable="sync.outbox.length > 0" @click="reload" />
        </q-card-actions>
      </q-card>
    </q-expansion-item>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useQuasar } from 'quasar';
import { format, parseISO } from 'date-fns';
import { useSyncStore } from '@/stores/sync';
import type { OutboxRow } from '@/offline/db';

defineOptions({ name: 'SyncPage' });

const $q = useQuasar();
const sync = useSyncStore();
const when = (iso: string) => format(parseISO(iso), 'MMM d, h:mm a');

const statusText = computed(() => {
  switch (sync.state) {
    case 'failed':
      return `${sync.failed} change(s) were refused by the server`;
    case 'offline':
      return sync.pending ? `No connection · ${sync.pending} change(s) saved on this phone` : 'No connection · nothing waiting';
    case 'syncing':
    case 'waiting':
      return `${sync.pending} change(s) waiting to upload`;
    default:
      return 'Everything is uploaded';
  }
});
const statusIcon = computed(() => ({ failed: 'sync_problem', offline: 'cloud_off', syncing: 'cloud_upload', waiting: 'cloud_upload', synced: 'cloud_done' })[sync.state]);
const statusColor = computed(() => ({ failed: 'negative', offline: 'grey-7', syncing: 'orange-8', waiting: 'orange-8', synced: 'positive' })[sync.state]);

async function syncNow() {
  await sync.kick({ force: true });
  await sync.loadOutbox();
}

async function retry(id: string) {
  await sync.retry(id);
}

function discard(row: OutboxRow) {
  $q.dialog({
    title: 'Discard this change?',
    message: `“${row.summary}” will never reach the server. This can't be undone.`,
    cancel: true,
    ok: { label: 'Discard', color: 'negative', unelevated: true },
  }).onOk(() => void sync.discard(row.id));
}

function reload() {
  $q.dialog({ title: 'Reload from server?', message: "This phone's copy is replaced with the server's.", cancel: true }).onOk(async () => {
    try {
      await sync.reloadFromServer();
      $q.notify({ message: 'Reloaded', color: 'grey-8' });
    } catch (err) {
      $q.notify({ type: 'negative', message: err instanceof Error ? err.message : String(err) });
    }
  });
}

// Keep the list current while syncing happens in the background.
watch(() => [sync.pending, sync.failed], () => void sync.loadOutbox());
onMounted(() => void sync.loadOutbox());
</script>
