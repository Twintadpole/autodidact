import type { RouteRecordRaw } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /** No login needed. */
    public?: boolean;
    /** Header title (pages can override with a dynamic one). */
    title?: string;
    /** Show a back arrow instead of the tab title. */
    back?: boolean;
    /** Desktop view: keep a form width (screens borrowed from the phone). */
    narrow?: boolean;
    /** Owner only (GPF item 3): a tech is sent to the Route. */
    owner?: boolean;
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
      { path: 'pools/:id/visits/:visitId/recap', name: 'visit-recap', component: () => import('@/pages/VisitRecapPage.vue'), meta: { back: true, title: 'Visit recap' } },
      { path: 'pools/:id/issues', name: 'pool-issues', component: () => import('@/pages/IssuesPage.vue'), meta: { back: true } },
      { path: 'pools/:id/edit', name: 'pool-edit', component: () => import('@/pages/PoolFormPage.vue'), meta: { back: true, title: 'Edit pool' } },
      { path: 'customers/:customerId/pools/new', name: 'pool-new', component: () => import('@/pages/PoolFormPage.vue'), meta: { back: true, title: 'New pool' } },
      { path: 'issues', name: 'issues', component: () => import('@/pages/IssuesPage.vue'), meta: { title: 'Issues' } },
      { path: 'customers', name: 'customers', component: () => import('@/pages/CustomersPage.vue'), meta: { title: 'Customers' } },
      { path: 'customers/new', name: 'customer-new', component: () => import('@/pages/CustomerFormPage.vue'), meta: { back: true, title: 'New customer' } },
      { path: 'customers/:id', name: 'customer', component: () => import('@/pages/CustomerPage.vue'), meta: { back: true } },
      { path: 'customers/:id/edit', name: 'customer-edit', component: () => import('@/pages/CustomerFormPage.vue'), meta: { back: true, title: 'Edit customer' } },
      { path: 'more', name: 'more', component: () => import('@/pages/MorePage.vue'), meta: { title: 'More' } },
      { path: 'more/account', name: 'account', component: () => import('@/pages/AccountPage.vue'), meta: { back: true, title: 'My account' } },
      { path: 'more/team', name: 'team', component: () => import('@/pages/TeamPage.vue'), meta: { back: true, title: 'Team', owner: true } },
      { path: 'more/sync', name: 'sync', component: () => import('@/pages/SyncPage.vue'), meta: { back: true, title: 'Sync' } },
      { path: 'more/invoices', name: 'invoices', component: () => import('@/pages/InvoicesPage.vue'), meta: { back: true, title: 'Invoices', owner: true } },
      { path: 'invoices/:id', name: 'invoice', component: () => import('@/pages/InvoicePage.vue'), meta: { back: true, title: 'Invoice', owner: true } },
      { path: 'more/money', name: 'money', component: () => import('@/pages/MoneyPage.vue'), meta: { back: true, title: 'Money', owner: true } },
      { path: 'more/money/new/:kind', name: 'money-new', component: () => import('@/pages/LedgerEntryPage.vue'), meta: { back: true, owner: true } },
      { path: 'more/money/:id', name: 'money-entry', component: () => import('@/pages/LedgerEntryPage.vue'), meta: { back: true, owner: true } },
      { path: 'more/business', name: 'business', component: () => import('@/pages/BusinessPage.vue'), meta: { back: true, title: 'Business details', owner: true } },
      { path: 'more/help/:topic?', name: 'help', component: () => import('@/pages/HelpPage.vue'), meta: { back: true, title: 'Help' } },
      { path: 'more/feedback', name: 'feedback', component: () => import('@/pages/FeedbackPage.vue'), meta: { back: true, title: 'Send feedback' } },
      { path: 'more/chemicals', name: 'chemicals', component: () => import('@/pages/ChemicalsPage.vue'), meta: { back: true, title: 'Chemicals', owner: true } },
    ],
  },
  // Desktop view (Phase 7D): side menu and tables. Phone screens stay as they are.
  {
    path: '/desk',
    component: () => import('@/layouts/DeskLayout.vue'),
    // The desktop view is the owner's (money tables, dashboard, import, team).
    meta: { owner: true },
    children: [
      { path: '', name: 'desk', component: () => import('@/pages/desk/DeskHomePage.vue'), meta: { title: 'Dashboard' } },
      { path: 'route', name: 'desk-route', component: () => import('@/pages/desk/DeskRoutePage.vue'), meta: { title: 'Route' } },
      { path: 'customers', name: 'desk-customers', component: () => import('@/pages/desk/DeskCustomersPage.vue'), meta: { title: 'Customers' } },
      { path: 'import', name: 'desk-import', component: () => import('@/pages/desk/DeskImportPage.vue'), meta: { title: 'Import customers & pools' } },
      { path: 'invoices', name: 'desk-invoices', component: () => import('@/pages/desk/DeskInvoicesPage.vue'), meta: { title: 'Invoices' } },
      { path: 'payments', name: 'desk-payments', component: () => import('@/pages/desk/DeskPaymentsPage.vue'), meta: { title: 'Payments' } },
      { path: 'money', name: 'desk-money', component: () => import('@/pages/desk/DeskLedgerPage.vue'), meta: { title: 'Expenses & income' } },
      { path: 'mileage', name: 'desk-mileage', component: () => import('@/pages/desk/DeskLedgerPage.vue'), props: { mileage: true }, meta: { title: 'Mileage' } },
      { path: 'visits', name: 'desk-visits', component: () => import('@/pages/desk/DeskVisitsPage.vue'), meta: { title: 'Visits' } },
      { path: 'chemicals', name: 'desk-chemicals', component: () => import('@/pages/desk/DeskChemicalsPage.vue'), meta: { title: 'Chemicals' } },
      { path: 'team', name: 'desk-team', component: () => import('@/pages/TeamPage.vue'), meta: { title: 'Team', narrow: true } },
      { path: 'help/:topic?', name: 'desk-help', component: () => import('@/pages/HelpPage.vue'), meta: { title: 'Help', narrow: true } },
      { path: 'feedback', name: 'desk-feedback', component: () => import('@/pages/FeedbackPage.vue'), meta: { title: 'Send feedback', narrow: true } },
      { path: 'business', name: 'desk-business', component: () => import('@/pages/BusinessPage.vue'), meta: { title: 'Business details', narrow: true } },
    ],
  },
  { path: '/:catchAll(.*)*', redirect: '/' },
];

export default routes;
