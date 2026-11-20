import { defineRouter } from '#q-app';
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { onUnauthorized } from '@/stores/api';
import routes from './routes';
import { savedView } from '@/lib/view';

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
    // A computer set to the desktop view opens there (the phone's home is the Route).
    if (to.path === '/' && savedView() === 'desk' && auth.isOwner) return { path: '/desk' };
    let ok: boolean;
    try {
      ok = await auth.ensureChecked();
    } catch {
      // Server unreachable: let the page load and show its own error (owner screens stay the owner's).
      return to.matched.some((r) => r.meta.owner) && !auth.isOwner ? { path: '/' } : true;
    }
    if (ok) {
      // GPF item 3: a temporary password is changed first; owner-only screens send a tech home.
      if (auth.me?.mustChangePassword && to.name !== 'account') return { path: '/more/account', query: { change: '1' } };
      if (to.matched.some((r) => r.meta.owner) && !auth.isOwner) return { path: '/' };
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
