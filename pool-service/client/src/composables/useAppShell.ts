import { t } from '@/i18n';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useDataStore } from '@/stores/data';
import { useSyncStore } from '@/stores/sync';
import { requestPersistentStorage } from '@/offline/db';
import { errorMessage } from '@/stores/api';

/**
 * What both layouts (phone and desktop) do: load the local data, start syncing,
 * offer the refresh when a new version is out, and work out the sync chip.
 */
export function useAppShell() {
  const $q = useQuasar();
  const data = useDataStore();
  const sync = useSyncStore();
  const loadError = ref('');

  const chip = computed(() => {
    switch (sync.state) {
      case 'failed':
        return { label: t('{n} failed', { n: sync.failed }), color: 'negative', icon: 'sync_problem' };
      case 'offline':
        return { label: sync.pending ? `${t('Offline')} · ${sync.pending}` : t('Offline'), color: 'grey-7', icon: 'cloud_off' };
      case 'syncing':
      case 'waiting':
        return { label: t('{n} waiting', { n: sync.pending }), color: 'orange-8', icon: 'cloud_upload' };
      default:
        return { label: t('Synced'), color: 'positive', icon: 'cloud_done' };
    }
  });

  async function load(force = false) {
    loadError.value = '';
    try {
      await data.loadAll(force);
    } catch (err) {
      loadError.value = errorMessage(err);
    }
  }

  // A new version was deployed: offer a one-tap refresh (unsaved visit typing is kept as a draft).
  function onUpdateReady() {
    $q.notify({
      message: t('New version available'),
      icon: 'system_update',
      color: 'primary',
      timeout: 0,
      position: 'top',
      actions: [
        { label: t('Refresh'), color: 'white', handler: () => window.location.reload() },
        { label: t('Later'), color: 'white' },
      ],
    });
  }
  onMounted(() => {
    window.addEventListener('pool:update-ready', onUpdateReady);
    sync.start();
    void requestPersistentStorage();
    void load();
  });
  onBeforeUnmount(() => window.removeEventListener('pool:update-ready', onUpdateReady));

  return { chip, load, loadError };
}
