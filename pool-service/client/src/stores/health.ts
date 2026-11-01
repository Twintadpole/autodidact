import { defineStore } from 'pinia';
import { ref } from 'vue';

/** Placeholder store: checks the API is reachable. Phase 4 replaces this with the sync store. */
export const useHealthStore = defineStore('health', () => {
  const status = ref<'unknown' | 'ok' | 'down'>('unknown');
  const checkedAt = ref<Date | null>(null);

  async function check() {
    try {
      const res = await fetch('/api/health', { credentials: 'same-origin' });
      status.value = res.ok ? 'ok' : 'down';
    } catch {
      status.value = 'down';
    }
    checkedAt.value = new Date();
  }

  return { status, checkedAt, check };
});
