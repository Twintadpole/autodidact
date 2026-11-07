import { defineRouter } from '#q-app';
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { onUnauthorized } from '@/stores/api';
import routes from './routes';

export default defineRouter(function ({ store }) {
  const router = createRouter({
    scrollBehavior: (_to, _from, saved) => saved ?? { left: 0, top: 0 },
    routes,
    // Plain URLs (/pools/<id>/overview). The server returns index.html for any non-API path,
    // and the service worker does the same offline, so deep links and reloads work.
    history: createWebHistory('/'),
  });

  const auth = useAuthStore(store);

  // Every screen except Login needs a session.
  router.beforeEach(async (to) => {
    if (to.meta.public) return true;
    try {
      if (await auth.ensureChecked()) return true;
    } catch {
      // Server unreachable: let the page load and show its own error.
      return true;
    }
    return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} };
  });

  onUnauthorized(() => {
    auth.expired();
    const current = router.currentRoute.value;
    if (!current.meta.public) void router.replace({ path: '/login', query: { next: current.fullPath } });
  });

  return router;
});
