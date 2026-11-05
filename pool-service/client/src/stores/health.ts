import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, ApiError } from './api';

/**
 * Temporary store behind the skeleton test page: health, login state and the
 * end-to-end sync test. Phase 3 replaces it with the real auth/data stores.
 */
export const useHealthStore = defineStore('health', () => {
  const status = ref<'unknown' | 'ok' | 'down'>('unknown');
  const mongo = ref(false);
  const checkedAt = ref<Date | null>(null);
  const loggedIn = ref(false);

  async function check() {
    try {
      const h = await api<{ ok: boolean; mongo: boolean }>('/health');
      status.value = h.ok ? 'ok' : 'down';
      mongo.value = h.mongo;
    } catch {
      status.value = 'down';
      mongo.value = false;
    }
    try {
      await api('/auth/me');
      loggedIn.value = true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) loggedIn.value = false;
    }
    checkedAt.value = new Date();
  }

  async function login(password: string, remember: boolean) {
    await api('/auth/login', { method: 'POST', body: { password, remember } });
    loggedIn.value = true;
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    loggedIn.value = false;
  }

  return { status, mongo, checkedAt, loggedIn, check, login, logout };
});
