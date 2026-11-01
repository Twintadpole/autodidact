import type { RouteRecordRaw } from 'vue-router';

// Phase 3 adds: /login, /route, /pools/:id (visit), /pools/:id/overview,
// /issues, /customers, /customers/:id, /more.
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [{ path: '', component: () => import('@/pages/IndexPage.vue') }],
  },
  {
    path: '/:catchAll(.*)*',
    redirect: '/',
  },
];

export default routes;
