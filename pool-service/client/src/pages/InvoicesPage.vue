<template>
  <q-page class="q-pa-md column q-gutter-md">
    <div class="row q-col-gutter-sm">
      <div class="col-6">
        <q-card flat bordered class="q-pa-sm text-center">
          <div class="text-caption text-grey-7">Owed</div>
          <div class="text-h6" data-test="invoices-owed">{{ money(owed) }}</div>
        </q-card>
      </div>
      <div class="col-6">
        <q-card flat bordered class="q-pa-sm text-center">
          <div class="text-caption text-grey-7">Overdue</div>
          <div class="text-h6" :class="overdue ? 'text-negative' : ''" data-test="invoices-overdue">{{ money(overdue) }}</div>
        </q-card>
      </div>
    </div>

    <div class="row no-wrap q-gutter-sm items-center">
      <q-select v-model="period" outlined dense emit-value map-options :options="periodOptions" class="col" data-test="invoices-period" />
      <q-btn color="primary" unelevated no-caps icon="post_add" label="Create invoices" :loading="creating" data-test="create-monthly" @click="createMonthly" />
    </div>
    <div class="text-caption text-grey-7 q-mt-none">
      Drafts for current customers with a monthly rate who don't have a {{ periodLabel(period) }} invoice yet ({{ dueCount }}).
    </div>

    <q-btn-toggle v-model="filter" spread no-caps unelevated dense toggle-color="primary" color="grey-3" text-color="grey-9" :options="filterOptions" data-test="invoices-filter" />

    <div v-if="!shown.length" class="text-center text-grey-7 q-pa-md">No invoices here.</div>
    <q-list v-else bordered separator class="bg-white rounded-borders" data-test="invoice-list">
      <q-item v-for="i in shown" :key="i._id" clickable :to="`/invoices/${i._id}`" :data-test="`invoice-${i.number}`">
        <q-item-section>
          <q-item-label>#{{ i.number }} · {{ data.customerById.get(i.customerId)?.name ?? 'Customer' }}</q-item-label>
          <q-item-label caption>{{ periodLabel(i.period) || shortDay(i.issueDate) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-item-label class="text-weight-medium text-grey-10">{{ money(invoiceTotal(i)) }}</q-item-label>
          <q-badge :color="STATE_COLOR[invoiceState(i)]" :label="STATE_LABEL[invoiceState(i)]" />
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useRouter } from 'vue-router';
import { customerStatus, invoiceBalance, invoiceState, invoiceTotal } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { money } from '@/lib/customer';
import { periodLabel, periodOf } from '@/lib/money';
import { STATE_COLOR, STATE_LABEL } from '@/lib/invoice';

defineOptions({ name: 'InvoicesPage' });

const $q = useQuasar();
const router = useRouter();
const data = useDataStore();
const creating = ref(false);
const filter = ref<'unpaid' | 'draft' | 'paid' | 'all'>('unpaid');
const period = ref(data.defaultPeriod());

const now = new Date();
const periodOptions = [-1, 0, 1].map((d) => {
  const p = periodOf(new Date(now.getFullYear(), now.getMonth() + d, 1));
  return { label: periodLabel(p), value: p };
});

const states = computed(() => data.invoices.map((i) => ({ i, s: invoiceState(i) })));
const sum = (list: typeof states.value) => Math.round(list.reduce((t, x) => t + invoiceBalance(x.i), 0) * 100) / 100;
const owed = computed(() => sum(states.value.filter((x) => x.s === 'sent' || x.s === 'overdue')));
const overdue = computed(() => sum(states.value.filter((x) => x.s === 'overdue')));

const filterOptions = computed(() => {
  const n = (f: (s: string) => boolean) => states.value.filter((x) => f(x.s)).length;
  return [
    { label: `Unpaid ${n((s) => s === 'sent' || s === 'overdue')}`, value: 'unpaid' },
    { label: `Drafts ${n((s) => s === 'draft')}`, value: 'draft' },
    { label: `Paid ${n((s) => s === 'paid')}`, value: 'paid' },
    { label: `All ${states.value.length}`, value: 'all' },
  ];
});
const shown = computed(() =>
  states.value
    .filter(({ s }) => (filter.value === 'all' ? true : filter.value === 'unpaid' ? s === 'sent' || s === 'overdue' : s === filter.value))
    .map((x) => x.i),
);

const dueCount = computed(() => {
  const billed = new Set(data.invoices.filter((i) => i.period === period.value && i.status !== 'void').map((i) => i.customerId));
  return data.customers.filter((c) => customerStatus(c) === 'current' && (c.monthlyRate ?? 0) > 0 && !billed.has(c._id)).length;
});

const shortDay = (d: string) => new Date(d.slice(0, 10) + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

async function createMonthly() {
  if (!dueCount.value) {
    $q.notify({ message: `Everyone with a monthly rate already has a ${periodLabel(period.value)} invoice.`, color: 'grey-8' });
    return;
  }
  creating.value = true;
  try {
    const made = await data.createMonthlyInvoices(period.value);
    $q.notify({ type: 'positive', message: `${made.length} draft invoice${made.length === 1 ? '' : 's'} for ${periodLabel(period.value)}` });
    filter.value = 'draft';
    if (made.length === 1) void router.push(`/invoices/${made[0]!._id}`);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    creating.value = false;
  }
}
</script>
