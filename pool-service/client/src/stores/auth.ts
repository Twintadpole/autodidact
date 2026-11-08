import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, ApiError } from './api';

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false);
  const checked = ref(false);

  /** Remembered across app restarts so the app opens with no signal. */
  const KEY = 'pool.loggedIn';
  const remember = (v: boolean) => {
    try {
      if (v) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      // private mode: just ask the server each time
    }
  };
  const remembered = () => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  };

  /**
   * Asks the server once whether the session cookie is valid. With no signal,
   * trusts the last answer: the cookie lasts 90 days, and if it has expired the
   * outbox simply waits and the login screen appears once the server answers.
   */
  async function ensureChecked(): Promise<boolean> {
    if (checked.value) return loggedIn.value;
    try {
      await api('/auth/me');
      loggedIn.value = true;
      remember(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        loggedIn.value = false;
        remember(false);
      } else if (remembered()) {
        loggedIn.value = true; // offline: open the app from the phone's copy
        return true; // check again next time
      } else {
        throw err;
      }
    }
    checked.value = true;
    return loggedIn.value;
  }

  async function login(password: string, remember: boolean) {
    await api('/auth/login', { method: 'POST', body: { password, remember } });
    loggedIn.value = true;
    checked.value = true;
    rememberLogin(true);
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    loggedIn.value = false;
    rememberLogin(false);
  }

  /** Called when any request comes back 401 (session expired). */
  function expired() {
    loggedIn.value = false;
    checked.value = true;
    rememberLogin(false);
  }
  const rememberLogin = remember;

  return { loggedIn, checked, ensureChecked, login, logout, expired };
});
