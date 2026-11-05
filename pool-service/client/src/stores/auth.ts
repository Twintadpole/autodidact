import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, ApiError } from './api';

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false);
  const checked = ref(false);

  /** Asks the server once whether the session cookie is valid. */
  async function ensureChecked(): Promise<boolean> {
    if (checked.value) return loggedIn.value;
    try {
      await api('/auth/me');
      loggedIn.value = true;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
      loggedIn.value = false;
    }
    checked.value = true;
    return loggedIn.value;
  }

  async function login(password: string, remember: boolean) {
    await api('/auth/login', { method: 'POST', body: { password, remember } });
    loggedIn.value = true;
    checked.value = true;
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    loggedIn.value = false;
  }

  /** Called when any request comes back 401 (session expired). */
  function expired() {
    loggedIn.value = false;
    checked.value = true;
  }

  return { loggedIn, checked, ensureChecked, login, logout, expired };
});
