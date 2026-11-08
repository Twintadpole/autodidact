import type { RouteRecordRaw } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /** No login needed. */
    public?: boolean;
    /** Header title (pages can override with a dynamic one). */
    title?: string;
    /** Show a back arrow instead of the tab title. */
    back?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('@/pages/LoginPage.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'route', component: () => import('@/pages/RoutePage.vue'), meta: { title: 'Route' } },
      { path: 'pools/:id', name: 'visit', component: () => import('@/pages/VisitPage.vue'), meta: { back: true } },
      { path: 'pools/:id/overview', name: 'overview', component: () => import('@/pages/PoolOverviewPage.vue'), meta: { back: true } },
      { path: 'pools/:id/visits', name: 'pool-visits', component: () => import('@/pages/PoolVisitsPage.vue'), meta: { back: true } },
      { path: 'pools/:id/visits/:visitId', name: 'visit-detail', component: () => import('@/pages/VisitDetailPage.vue'), meta: { back: true } },
      { path: 'pools/:id/issues', name: 'pool-issues', component: () => import('@/pages/IssuesPage.vue'), meta: { back: true } },
      { path: 'pools/:id/edit', name: 'pool-edit', component: () => import('@/pages/PoolFormPage.vue'), meta: { back: true, title: 'Edit pool' } },
      { path: 'customers/:customerId/pools/new', name: 'pool-new', component: () => import('@/pages/PoolFormPage.vue'), meta: { back: true, title: 'New pool' } },
      { path: 'issues', name: 'issues', component: () => import('@/pages/IssuesPage.vue'), meta: { title: 'Issues' } },
      { path: 'customers', name: 'customers', component: () => import('@/pages/CustomersPage.vue'), meta: { title: 'Customers' } },
      { path: 'customers/new', name: 'customer-new', component: () => import('@/pages/CustomerFormPage.vue'), meta: { back: true, title: 'New customer' } },
      { path: 'customers/:id', name: 'customer', component: () => import('@/pages/CustomerPage.vue'), meta: { back: true } },
      { path: 'customers/:id/edit', name: 'customer-edit', component: () => import('@/pages/CustomerFormPage.vue'), meta: { back: true, title: 'Edit customer' } },
      { path: 'more', name: 'more', component: () => import('@/pages/MorePage.vue'), meta: { title: 'More' } },
      { path: 'more/sync', name: 'sync', component: () => import('@/pages/SyncPage.vue'), meta: { back: true, title: 'Sync' } },
      { path: 'more/chemicals', name: 'chemicals', component: () => import('@/pages/ChemicalsPage.vue'), meta: { back: true, title: 'Chemicals' } },
    ],
  },
  { path: '/:catchAll(.*)*', redirect: '/' },
];

export default routes;
