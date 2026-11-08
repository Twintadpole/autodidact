/*
 * Registers the service worker (offline app shell + background sync) and lets
 * the app know when a new version has been deployed, so it can offer
 * "New version available · Refresh" instead of needing a full app restart.
 */
import { register } from 'register-service-worker';

const CHECK_EVERY_MS = 30 * 60 * 1000;

register(import.meta.env.QUASAR_SERVICE_WORKER_FILE, {
  registered(registration) {
    // Look for a new version every 30 minutes and whenever the app comes back to the screen.
    setInterval(() => void registration.update().catch(() => undefined), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
    });
  },

  updated() {
    // The new version is installed; the page still runs the old one until it reloads.
    window.dispatchEvent(new CustomEvent('pool:update-ready'));
  },

  error(err) {
    console.error('Service worker registration failed', err);
  },
});
