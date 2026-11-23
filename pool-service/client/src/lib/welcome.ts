import { ref } from 'vue';

/**
 * Beta onboarding. The welcome screens show once, right after someone's first login (when they
 * have just chosen their own password). The owner's "Getting started" card can be hidden per person.
 */
const WELCOME = 'pool.welcome';
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      // private mode
    }
  },
};
/** True while the welcome screens are due (shown by WelcomeDialog in either layout). */
export const welcomeOpen = ref(store.get(WELCOME) === '1');
export function queueWelcome() {
  store.set(WELCOME, '1');
  welcomeOpen.value = true;
}
export function welcomeDone() {
  store.set(WELCOME, null);
  welcomeOpen.value = false;
}

const hiddenKey = (userId: string | undefined) => `pool.gettingStarted.hidden.${userId ?? 'owner'}`;
export const gettingStartedHidden = (userId?: string) => store.get(hiddenKey(userId)) === '1';
export const hideGettingStarted = (userId?: string, hidden = true) => store.set(hiddenKey(userId), hidden ? '1' : null);

/** Steps the person ticked by hand (e.g. "Add your techs" when they work alone). */
const tickedKey = (userId: string | undefined) => `pool.gettingStarted.ticked.${userId ?? 'owner'}`;
export function tickedSteps(userId?: string): string[] {
  try {
    const v = JSON.parse(store.get(tickedKey(userId)) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
export const saveTickedSteps = (userId: string | undefined, ids: string[]) => store.set(tickedKey(userId), ids.length ? JSON.stringify(ids) : null);

/** Running as an installed app (from the home-screen icon). */
export const installed = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
