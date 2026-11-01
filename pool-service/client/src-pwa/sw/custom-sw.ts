/*
 * Service worker (Workbox InjectManifest mode).
 *
 * Phase 1: precache the app shell so the app opens with no signal.
 * API calls are never cached: they are network-only and, from Phase 4 on,
 * every write goes through the IndexedDB outbox (+ Background Sync).
 */
import { clientsClaim } from 'workbox-core';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

void self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

if (import.meta.env.QUASAR_PROD) {
  // SPA navigation fallback to the cached index.html, except API and SW files.
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL(import.meta.env.QUASAR_PWA_FALLBACK_HTML), {
      denylist: [/^\/api\//, new RegExp(import.meta.env.QUASAR_PWA_SERVICE_WORKER_REGEX), /workbox-(.)*\.js$/],
    }),
  );
}
