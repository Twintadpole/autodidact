<template>
  <div class="column no-wrap full-height" data-test="owed-card">
    <div class="row items-end q-gutter-x-lg">
      <div>
        <div class="hero" data-test="owed-total">{{ fmt(total) }}</div>
        <div class="hero-sub">owed on {{ open.length }} invoice{{ open.length === 1 ? '' : 's' }}</div>
      </div>
      <div class="hero-sub" :class="{ 'text-negative text-weight-medium': overdue > 0 }" data-test="owed-overdue">
        <q-icon v-if="overdue > 0" name="warning" /> {{ overdue > 0 ? `${fmt(overdue)} overdue` : $t('Nothing overdue') }}
      </div>
    </div>

    <div v-if="mode !== 's' && total > 0" class="col q-mt-sm" :class="side ? 'row no-wrap q-gutter-x-md' : 'column no-wrap'">
      <div class="chart-box" :class="mode === 'l' && !side ? 'chart-fixed' : 'col'">
        <EChart :option="option" :label="$t(`Money owed by how late it is`)" />
      </div>
      <!-- Who owes, oldest first -->
      <CardTable
        v-if="mode === 'l'"
        name="owed-by-customer"
        :columns="columns"
        :rows="tableRows"
        clickable
        :class="side ? 'side-list scroll' : 'q-mt-sm'"
        test-id="owed-list"
        @row="router.push('/desk/invoices')"
      />
    </div>
    <div v-else-if="mode !== 's'" class="text-grey-7 q-mt-md">{{ $t(`Nobody owes you anything right now.`) }}</div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { invoiceBalance, invoiceState } from '@pool/shared';
import EChart from '@/components/desk/EChart.vue';
import { useDataStore } from '@/stores/data';
import CardTable, { type CardColumn } from '@/components/desk/CardTable.vue';
import { formatMoney, useDashTools } from '@/composables/useDashTools';
import { localDate } from '@/lib/money';
import { AGE_RAMP, base, barEnd, categoryAxis, compactMoney, valueAxis } from '@/lib/chartTheme';
import type { CardMode } from '@/lib/dashboard';

const props = defineProps<{ mode: CardMode; width: number }>();
const data = useDataStore();
const router = useRouter();
const tools = useDashTools();
const fmt = (v: number) => formatMoney(v, tools.format);
const side = computed(() => props.mode === 'l' && props.width >= 760);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Sent and overdue invoices with something still to pay, and how many days past due each is. */
const open = computed(() => {
  const today = new Date(localDate(new Date()) + 'T12:00');
  return data.invoices
    .filter((i) => ['sent', 'overdue'].includes(invoiceState(i)) && invoiceBalance(i) > 0 && (!tools.customerId || i.customerId === tools.customerId))
    .map((i) => {
      const due = new Date((i.dueDate ?? i.issueDate).slice(0, 10) + 'T12:00');
      return { i, balance: invoiceBalance(i), late: Math.max(0, Math.round((today.getTime() - due.getTime()) / 86_400_000)) };
    });
});
const total = computed(() => r2(open.value.reduce((t, x) => t + x.balance, 0)));
const overdue = computed(() => r2(open.value.filter((x) => invoiceState(x.i) === 'overdue').reduce((t, x) => t + x.balance, 0)));

const BUCKETS = [
  { label: t('Not late'), test: (d: number) => d === 0 },
  { label: t('1–30 days'), test: (d: number) => d >= 1 && d <= 30 },
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

const columns: CardColumn[] = [
  { key: 'customer', label: t('Customer') },
  { key: 'invoices', label: t('Invoices'), align: 'right' },
  { key: 'late', label: t('Days late'), align: 'right' },
  { key: 'balance', label: t('Owed'), align: 'right', money: true },
];
const tableRows = computed(() => byCustomer.value.map((c) => ({ customer: c.name, invoices: c.count, late: c.late > 0 ? c.late : t('not due'), balance: c.balance })));

const option = computed(() => ({
  ...base,
  grid: { top: 8, left: 8, right: 8, bottom: 4, containLabel: true },
  tooltip: { ...base.tooltip, trigger: 'item', valueFormatter: fmt },
  xAxis: categoryAxis(BUCKETS.map((b) => b.label)),
  yAxis: valueAxis(compactMoney),
  series: [
    {
      name: t('Owed'),
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
