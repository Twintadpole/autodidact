import { ref, watch, type Ref } from 'vue';
import { errorMessage } from '@/stores/api';

/**
 * A server report for a dashboard card, remembered on this device: with no connection the card shows
 * the last figures it loaded, with the time they're from.
 */
export function useCachedReport<T>(key: Ref<string>, fetcher: () => Promise<T>) {
  const data = ref<T | null>(null) as Ref<T | null>;
  const fetchedAt = ref<string | null>(null);
  const loading = ref(false);
  /** Set when the latest try failed (the remembered figures, if any, are still shown). */
  const error = ref('');
  const storeKey = () => `pool:dash:${key.value}`;

  function readCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey()) ?? 'null') as { at: string; data: T } | null;
      data.value = saved?.data ?? null;
      fetchedAt.value = saved?.at ?? null;
    } catch {
      data.value = null;
      fetchedAt.value = null;
    }
  }

  async function reload() {
    loading.value = true;
    try {
      const fresh = await fetcher();
      data.value = fresh;
      fetchedAt.value = new Date().toISOString();
      error.value = '';
      try {
        localStorage.setItem(storeKey(), JSON.stringify({ at: fetchedAt.value, data: fresh }));
      } catch {
        // storage full: the figures just aren't remembered
      }
    } catch (err) {
      error.value = errorMessage(err);
    } finally {
      loading.value = false;
    }
  }

  watch(
    key,
    () => {
      readCache();
      void reload();
    },
    { immediate: true },
  );

  return { data, fetchedAt, loading, error, reload };
}
