<template>
  <q-page class="q-pa-md">
    <!-- Placeholder figures until the card dashboard (next segment). -->
    <div class="row q-col-gutter-md">
      <div v-for="t in tiles" :key="t.label" class="col-12 col-sm-6 col-md-4 col-lg-3">
        <q-card flat bordered class="cursor-pointer full-height" :data-test="`desk-tile-${t.key}`" @click="router.push(t.to)">
          <q-card-section>
            <div class="text-caption text-grey-7">{{ t.label }}</div>
            <div class="text-h5" :class="t.color">{{ t.value }}</div>
            <div class="text-caption text-grey-7">{{ t.note }}</div>
          </q-card-section>
        </q-card>
      </div>
    </div>
    <div class="text-caption text-grey-6 q-mt-lg">The card dashboard (show, hide, resize and full screen) comes in the next update.</div>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { invoiceBalance, invoiceState, routeSlot } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { money } from '@/lib/customer';
import { moneySummary, periodRange } from '@/lib/report';

defineOptions({ name: 'DeskHomePage' });

const router = useRouter();
const data = useDataStore();

const tiles = computed(() => {
  const today = new Date();
  const due = data.routePools.filter((p) => ['weekly', 'once'].includes(routeSlot(p, today).kind));
  const done = due.filter((p) => p.week.done).length;
  const r = periodRange('thisMonth');
  const month = moneySummary(data.invoices, data.ledger, r.from, r.to, data.settings?.mileageRate);
  const overdue = data.invoices.filter((i) => invoiceState(i) === 'overdue').reduce((t, i) => t + invoiceBalance(i), 0);
  const issues = data.openIssues.filter((i) => i.status !== 'postponed');
  return [
    { key: 'route', label: 'This week', value: `${done} / ${due.length}`, note: 'pools done', to: '/desk/route', color: '' },
    { key: 'owed', label: 'Owed to you', value: money(month.owed), note: overdue ? `${money(Math.round(overdue * 100) / 100)} overdue` : 'nothing overdue', to: '/desk/invoices', color: overdue ? 'text-negative' : '' },
    { key: 'profit', label: 'Profit this month', value: money(month.profit), note: `${money(month.income.total)} in · ${money(month.runningCosts)} running costs`, to: '/desk/money', color: '' },
    { key: 'issues', label: 'Open issues', value: String(issues.length), note: `${issues.filter((i) => i.urgent && i.important).length} do now`, to: '/issues', color: '' },
  ];
});
</script>
