<template>
  <div class="column no-wrap full-height" data-test="owed-card">
    <div class="row items-end q-gutter-x-lg">
      <div>
        <div class="hero" data-test="owed-total">{{ money(total) }}</div>
        <div class="hero-sub">owed on {{ open.length }} invoice{{ open.length === 1 ? '' : 's' }}</div>
      </div>
      <div class="hero-sub" :class="{ 'text-negative text-weight-medium': overdue > 0 }" data-test="owed-overdue">
        <q-icon v-if="overdue > 0" name="warning" /> {{ overdue > 0 ? `${money(overdue)} overdue` : 'Nothing overdue' }}
      </div>
    </div>

    <div v-if="mode !== 's' && total > 0" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
      <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
        <EChart :option="option" label="Money owed by how late it is" />
      </div>
      <!-- Who owes, oldest first -->
      <q-list v-if="mode === 'l'" dense separator :class="side ? 'side-list scroll' : 'q-mt-sm'" data-test="owed-list">
        <q-item v-for="c in byCustomer" :key="c.customerId" clickable class="q-px-xs" @click="router.push('/desk/invoices')">
          <q-item-section>
            <q-item-label>{{ c.name }}</q-item-label>
            <q-item-label caption>{{ c.count }} invoice{{ c.count === 1 ? '' : 's' }} · {{ c.late > 0 ? `${c.late} days late` : 'not due yet' }}</q-item-label>
          </q-item-section>
          <q-item-section side class="text-grey-10 text-weight-medium">{{ money(c.balance) }}</q-item-section>
        </q-item>
      </q-list>
    </div>
    <div v-else-if="mode !== 's'" class="text-grey-7 q-mt-md">Nobody owes you anything right now.</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { invoiceBalance, invoiceState } from '@pool/shared';
import EChart from '@/components/desk/EChart.vue';
import { useDataStore } from '@/stores/data';
import { money } from '@/lib/customer';
import { localDate } from '@/lib/money';
import { AGE_RAMP, base, barEnd, categoryAxis, compactMoney, valueAxis } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const router = useRouter();
const side = computed(() => props.mode === 'l' && props.width >= 760);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Sent and overdue invoices with something still to pay, and how many days past due each is. */
const open = computed(() => {
  const today = new Date(localDate(new Date()) + 'T12:00');
  return data.invoices
    .filter((i) => ['sent', 'overdue'].includes(invoiceState(i)) && invoiceBalance(i) > 0)
    .map((i) => {
      const due = new Date((i.dueDate ?? i.issueDate).slice(0, 10) + 'T12:00');
      return { i, balance: invoiceBalance(i), late: Math.max(0, Math.round((today.getTime() - due.getTime()) / 86_400_000)) };
    });
});
const total = computed(() => r2(open.value.reduce((t, x) => t + x.balance, 0)));
const overdue = computed(() => r2(open.value.filter((x) => invoiceState(x.i) === 'overdue').reduce((t, x) => t + x.balance, 0)));

const BUCKETS = [
  { label: 'Not late', test: (d: number) => d === 0 },
  { label: '1–30 days', test: (d: number) => d >= 1 && d <= 30 },
  { label: '31–60', test: (d: number) => d > 30 && d <= 60 },
  { label: '61–90', test: (d: number) => d > 60 && d <= 90 },
  { label: '90+', test: (d: number) => d > 90 },
];
const buckets = computed(() => BUCKETS.map((b) => r2(open.value.filter((x) => b.test(x.late)).reduce((t, x) => t + x.balance, 0))));

const byCustomer = computed(() => {
  const m = new Map<string, { customerId: string; name: string; balance: number; count: number; late: number }>();
  for (const x of open.value) {
    const id = x.i.customerId;
    const row = m.get(id) ?? { customerId: id, name: data.customerById.get(id)?.name ?? 'Customer', balance: 0, count: 0, late: 0 };
    row.balance = r2(row.balance + x.balance);
    row.count++;
    row.late = Math.max(row.late, x.late);
    m.set(id, row);
  }
  return [...m.values()].sort((a, b) => b.late - a.late || b.balance - a.balance);
});

const option = computed(() => ({
  ...base,
  grid: { top: 8, left: 8, right: 8, bottom: 4, containLabel: true },
  tooltip: { ...base.tooltip, trigger: 'item', valueFormatter: (v: number) => money(v) },
  xAxis: categoryAxis(BUCKETS.map((b) => b.label)),
  yAxis: valueAxis(compactMoney),
  series: [
    {
      name: 'Owed',
      type: 'bar',
      barMaxWidth: 36,
      // Light = recent, dark = oldest (one hue, ordered).
      data: buckets.value.map((v, i) => ({ value: v, itemStyle: { ...barEnd(), color: AGE_RAMP[i] } })),
      label: { show: true, position: 'top', color: '#52514e', formatter: (p: { value: number }) => (p.value ? compactMoney(p.value) : '') },
    },
  ],
}));
</script>

<style scoped>
.chart-box {
  min-height: 130px;
}
.chart-fixed {
  height: 220px;
  flex: none;
}
.side-list {
  width: 320px;
  flex: none;
  max-height: 100%;
}
</style>
