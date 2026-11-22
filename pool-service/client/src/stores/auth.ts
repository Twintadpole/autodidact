import { setLanguage, t } from '@/i18n';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Me, TeamMember } from '@pool/shared';
import { api, ApiError } from './api';

/**
 * Who is signed in (GPF item 3). Remembered on the device so the app opens with no signal and
 * knows the role offline. The phone's copy of the data belongs to that person: when someone
 * else signs in, it is cleared first (see LoginPage / lib/session.ts).
 */
const KEY = 'pool.loggedIn';
const ME_KEY = 'pool.me';
const TEAM_KEY = 'pool.team';
const store = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // private mode: just ask the server each time
    }
  },
};

export const useAuthStore = defineStore('auth', () => {
  const loggedIn = ref(false);
  const checked = ref(false);
  const me = ref<Me | null>(store.get<Me>(ME_KEY));
  const team = ref<TeamMember[]>(store.get<TeamMember[]>(TEAM_KEY) ?? []);
  /** Owner unless known otherwise (an app from before accounts was the owner's). */
  const isOwner = computed(() => (me.value?.role ?? 'owner') === 'owner');
  const techs = computed(() => team.value.filter((m) => m.active));
  const memberName = (id: string | null | undefined) => (id ? (team.value.find((m) => m._id === id)?.name ?? t('Someone')) : '');

  function setMe(m: Me | null) {
    me.value = m;
    store.set(ME_KEY, m);
    // GPF item 5: the person's language follows them to any device.
    if (m?.language) void setLanguage(m.language);
  }
  function setTeam(list: TeamMember[] | undefined) {
    if (!list) return;
    team.value = list;
    store.set(TEAM_KEY, list);
  }
  const remember = (v: boolean) => store.set(KEY, v ? 1 : null);
  const remembered = () => store.get<number>(KEY) === 1;

  /**
   * Asks the server once whether the session cookie is valid. With no signal,
   * trusts the last answer: the cookie lasts 90 days, and if it has expired the
   * outbox simply waits and the login screen appears once the server answers.
   */
  async function ensureChecked(): Promise<boolean> {
    if (checked.value) return loggedIn.value;
    try {
      const r = await api<{ me: Me; team: TeamMember[] }>('/auth/me');
      setMe(r.me);
      setTeam(r.team);
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

  async function login(email: string, password: string, rememberDevice: boolean): Promise<Me> {
    const r = await api<{ me: Me }>('/auth/login', { method: 'POST', body: { email, password, remember: rememberDevice } });
    setMe(r.me);
    loggedIn.value = true;
    checked.value = false; // fetch the team on the next check
    remember(true);
    return r.me;
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    loggedIn.value = false;
    remember(false);
  }

  /** Called when any request comes back 401 (session expired). */
  function expired() {
    loggedIn.value = false;
    checked.value = true;
    remember(false);
  }

  function passwordChanged() {
    if (me.value) setMe({ ...me.value, mustChangePassword: false });
  }

  return { loggedIn, checked, me, team, isOwner, techs, memberName, setMe, setTeam, ensureChecked, login, logout, expired, passwordChanged };
});
