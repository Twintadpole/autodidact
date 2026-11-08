/*
 * Service worker (Workbox InjectManifest mode).
 *
 * - Precaches the app shell so the app opens with no signal.
 * - Background Sync: when the outbox has packages and the app is closed,
 *   Chrome wakes this worker once there is signal and it sends them.
 * - Photo thumbnails are cached (they never change), so galleries work offline.
 * - Every other API call is network-only: data lives in the app's IndexedDB.
 */
import { clientsClaim } from 'workbox-core';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { SYNC_TAG, syncNow } from '../../src/offline/engine';

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

void self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  ({ url, request }) => request.method === 'GET' && /^\/api\/photos\/[^/]+\/thumb$/.test(url.pathname),
  new CacheFirst({ cacheName: 'photo-thumbs', // Cast: workbox's own types disagree under exactOptionalPropertyTypes.
    plugins: [new ExpirationPlugin({ maxEntries: 800 }) as unknown as import('workbox-core').WorkboxPlugin] }),
);

if (import.meta.env.QUASAR_PROD) {
  // SPA navigation fallback to the cached index.html, except API and SW files.
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL(import.meta.env.QUASAR_PWA_FALLBACK_HTML), {
      denylist: [/^\/api\//, new RegExp(import.meta.env.QUASAR_PWA_SERVICE_WORKER_REGEX), /workbox-(.)*\.js$/],
    }),
  );
}

interface SyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener('sync', (event: Event) => {
  const e = event as SyncEvent;
  if (e.tag !== SYNC_TAG) return;
  e.waitUntil(
    syncNow({ force: true }).then((r) => {
      // Rejecting tells Chrome to try again later (it backs off on its own).
      if (r.remaining > 0) throw new Error(`${r.remaining} package(s) still waiting`);
    }),
  );
});
