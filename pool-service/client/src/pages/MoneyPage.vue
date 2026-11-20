<template>
  <q-page class="q-pa-md column q-gutter-md">
    <q-btn-toggle v-model="period" spread no-caps unelevated dense toggle-color="primary" color="grey-3" text-color="grey-9" :options="periodOptions" data-test="money-period" />

    <!-- Totals -->
    <div class="row q-col-gutter-sm">
      <div class="col-4"><q-card flat bordered class="q-pa-sm text-center"><div class="text-caption text-grey-7">Income</div><div class="text-subtitle1 text-weight-medium" data-test="money-income">{{ money(sum.income.total) }}</div></q-card></div>
      <div class="col-4"><q-card flat bordered class="q-pa-sm text-center"><div class="text-caption text-grey-7">Expenses</div><div class="text-subtitle1 text-weight-medium" data-test="money-expenses">{{ money(sum.runningCosts) }}</div></q-card></div>
      <div class="col-4">
        <q-card flat bordered class="q-pa-sm text-center"><div class="text-caption text-grey-7">Profit</div><div class="text-subtitle1 text-weight-bold" :class="sum.profit < 0 ? 'text-negative' : 'text-positive'" data-test="money-profit">{{ money(sum.profit) }}</div></q-card>
      </div>
    </div>
    <q-list dense bordered class="bg-white rounded-borders">
      <q-item><q-item-section class="text-grey-7">Invoice payments received</q-item-section><q-item-section side class="text-grey-10">{{ money(sum.income.payments) }}</q-item-section></q-item>
      <q-item v-if="sum.income.other"><q-item-section class="text-grey-7">Other income</q-item-section><q-item-section side class="text-grey-10">{{ money(sum.income.other) }}</q-item-section></q-item>
      <q-item v-if="sum.capital" data-test="money-capital"><q-item-section class="text-grey-7">Capital purchases (tools), not in expenses</q-item-section><q-item-section side class="text-grey-10">{{ money(sum.capital) }}</q-item-section></q-item>
      <q-item data-test="money-miles">
        <q-item-section class="text-grey-7">Miles driven</q-item-section>
        <q-item-section side class="text-grey-10">{{ sum.miles.toLocaleString() }} mi{{ sum.mileageValue != null ? ` · ${money(sum.mileageValue)}` : '' }}</q-item-section>
      </q-item>
      <q-item clickable to="/more/invoices"><q-item-section class="text-grey-7">Still owed (all unpaid invoices)</q-item-section><q-item-section side class="text-grey-10" data-test="money-owed">{{ money(sum.owed) }}</q-item-section></q-item>
    </q-list>
    <div v-if="data.settings?.mileageRate == null" class="text-caption text-grey-7">Set your rate per mile in <router-link to="/more/business">Business details</router-link> to see mileage in dollars.</div>

    <div class="row q-col-gutter-sm">
      <div class="col-4"><q-btn class="full-width" color="primary" unelevated no-caps icon="receipt_long" label="Expense" to="/more/money/new/expense" data-test="add-expense" /></div>
      <div class="col-4"><q-btn class="full-width" color="primary" outline no-caps icon="add_card" label="Income" to="/more/money/new/income" data-test="add-income" /></div>
      <div class="col-4"><q-btn class="full-width" color="primary" outline no-caps icon="directions_car" label="Miles" to="/more/money/new/mileage" data-test="add-miles" /></div>
    </div>

    <!-- Expenses by category -->
    <div v-if="sum.expenses.length">
      <div class="text-subtitle1 q-mb-xs">Expenses by category</div>
      <q-list dense bordered separator class="bg-white rounded-borders" data-test="money-categories">
        <q-item v-for="c in sum.expenses" :key="c.key"><q-item-section>{{ c.label }}</q-item-section><q-item-section side class="text-grey-10">{{ money(c.amount) }}</q-item-section></q-item>
      </q-list>
    </div>

    <!-- What each customer earns per hour -->
    <div data-test="customer-hours">
      <div class="row items-center justify-between q-mb-xs">
        <div class="text-subtitle1">What you earn per hour, by customer</div>
        <q-btn flat round dense icon="refresh" aria-label="Refresh" :loading="hoursLoading" @click="loadHours" />
      </div>
      <div class="text-caption text-grey-7 q-mb-xs">Each month: billed − the month's chemicals − mileage − expenses for them, ÷ hours on site. Lowest first.</div>
      <div v-if="hoursError" class="text-body2 text-grey-7" data-test="customer-hours-error">{{ hoursError }}</div>
      <div v-else-if="hours && !hours.rows.length" class="text-body2 text-grey-7">No visits or billing in this period.</div>
      <q-list v-else-if="hours" bordered separator class="bg-white rounded-borders">
        <q-item v-for="r in hours.rows" :key="r.customerId" clickable :data-test="`hours-${r.customerId}`" @click="openCustomer(r)">
          <q-item-section>
            <q-item-label>{{ r.name }}</q-item-label>
            <q-item-label caption>{{ r.visitCount }} visit{{ r.visitCount === 1 ? '' : 's' }} · {{ r.hours }} h · profit {{ money(r.profit) }}{{ r.months.length > 1 ? ` · ${r.months.length} months` : '' }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-item-label class="text-weight-bold" :class="r.perHour != null && r.perHour < 0 ? 'text-negative' : 'text-grey-10'">{{ r.perHour != null ? `${money(r.perHour)}/h` : '—' }}</q-item-label>
            <q-badge v-if="r.inProgress" color="orange-7" label="In progress" />
          </q-item-section>
        </q-item>
      </q-list>
    </div>

    <!-- Entries in the period -->
    <div>
      <div class="text-subtitle1 q-mb-xs">Entries</div>
      <div v-if="!entries.length" class="text-body2 text-grey-7">Nothing entered for {{ PERIOD_LABEL[period].toLowerCase() }}.</div>
      <q-list v-else bordered separator class="bg-white rounded-borders" data-test="money-entries">
        <q-item v-for="e in entries" :key="e._id" clickable :to="`/more/money/${e._id}`" :data-test="`entry-${e._id}`">
          <q-item-section avatar><q-icon :name="ICON[e.kind]" :color="e.kind === 'income' ? 'positive' : 'primary'" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ entryTitle(e) }}</q-item-label>
            <q-item-label caption>{{ shortDay(e.date) }}{{ e.customerId ? ` · ${data.customerById.get(e.customerId)?.name ?? ''}` : '' }}{{ e.receiptDataUrl ? ' · receipt' : '' }}{{ e.invoiceId ? ' · on invoice' : '' }}</q-item-label>
          </q-item-section>
          <q-item-section side class="text-grey-10">{{ e.kind === 'mileage' ? `${e.miles ?? 0} mi` : money(e.amount ?? 0) }}</q-item-section>
        </q-item>
      </q-list>
    </div>

    <!-- Breakdown: months (year views), then one month with its visits -->
    <q-dialog :model-value="!!detail" @update:model-value="(v: boolean) => !v && closeDetail()">
      <q-card v-if="detail" style="min-width: 320px; max-width: 520px" class="full-width" data-test="hours-detail">
        <q-card-section class="row items-center no-wrap q-pb-none">
          <q-btn v-if="month && detail.months.length > 1" flat round dense icon="arrow_back" aria-label="All months" @click="month = null" />
          <div class="col" style="min-width: 0">
            <div class="text-h6 ellipsis">{{ detail.name }}</div>
            <div v-if="month" class="text-subtitle2 text-grey-7" data-test="month-title">{{ periodLabel(month.month) }}</div>
          </div>
          <q-space />
          <q-badge v-if="month" :color="month.complete ? 'positive' : 'orange-7'" :label="month.complete ? 'Final' : 'In progress'" data-test="month-state" />
        </q-card-section>

        <!-- Months of the period -->
        <q-list v-if="!month" separator class="q-mt-sm" data-test="hours-months">
          <q-item v-for="m in detail.months" :key="m.month" clickable :data-test="`month-${m.month}`" @click="month = m">
            <q-item-section>
              <q-item-label>{{ periodLabel(m.month) }}</q-item-label>
              <q-item-label caption>{{ m.visits.length }} visit{{ m.visits.length === 1 ? '' : 's' }} · {{ m.hours }} h · profit {{ money(m.profit) }}{{ m.complete ? '' : ' · in progress' }}</q-item-label>
            </q-item-section>
            <q-item-section side class="text-weight-bold text-grey-10">{{ m.perHour != null ? `${money(m.perHour)}/h` : '—' }}</q-item-section>
          </q-item>
          <q-item class="text-weight-bold"><q-item-section>Average over the period</q-item-section><q-item-section side class="text-grey-10">{{ detail.perHour != null ? `${money(detail.perHour)}/h` : '—' }}</q-item-section></q-item>
        </q-list>

        <!-- One month -->
        <template v-else>
          <q-list dense class="q-mt-sm" data-test="month-breakdown">
            <q-item><q-item-section>Billed{{ month.billedFromRate ? ' (monthly rate)' : '' }}</q-item-section><q-item-section side>{{ money(month.billed) }}</q-item-section></q-item>
            <q-item><q-item-section>Chemicals (whole month)</q-item-section><q-item-section side>− {{ money(month.chemicalCost) }}</q-item-section></q-item>
            <q-item><q-item-section>Mileage (estimate)</q-item-section><q-item-section side>− {{ money(month.mileageCost) }}</q-item-section></q-item>
            <q-item><q-item-section>Expenses for them</q-item-section><q-item-section side>− {{ money(month.expenses) }}</q-item-section></q-item>
            <q-separator />
            <q-item class="text-weight-bold"><q-item-section>Profit for the month</q-item-section><q-item-section side class="text-grey-10">{{ money(month.profit) }}</q-item-section></q-item>
            <q-item><q-item-section>Hours on site ({{ month.visits.length }} visit{{ month.visits.length === 1 ? '' : 's' }})</q-item-section><q-item-section side>{{ month.hours }} h</q-item-section></q-item>
            <q-item class="text-weight-bold"><q-item-section>Average per hour</q-item-section><q-item-section side class="text-grey-10" data-test="month-per-hour">{{ month.perHour != null ? `${money(month.perHour)}/h` : '—' }}</q-item-section></q-item>
          </q-list>
          <q-markup-table v-if="month.visits.length" flat dense separator="horizontal" class="q-mx-md" data-test="month-visits">
            <thead>
              <tr><th class="text-left">Visit</th><th class="text-right">Time</th><th class="text-right">$/h</th></tr>
            </thead>
            <tbody>
              <tr v-for="v in month.visits" :key="v.visitId">
                <td class="text-left">{{ shortDay(v.date) }}<span v-if="v.timeFrom && v.timeFrom !== 'timer'" class="text-grey-6"> ({{ v.timeFrom === 'pool' ? 'pool avg' : 'all-pools avg' }})</span></td>
                <td class="text-right">{{ v.minutes != null ? `${v.minutes} min` : '—' }}</td>
                <td class="text-right">{{ v.perHour != null ? money(v.perHour) : '—' }}</td>
              </tr>
            </tbody>
          </q-markup-table>
          <q-card-section class="text-caption text-grey-7 q-gutter-y-xs">
            <div>Each visit: the month's profit split equally across its visits, ÷ that visit's time.</div>
            <div v-if="!month.complete">This month isn't over: chemicals and visits are still being added.</div>
            <div v-if="month.unpricedDoses">{{ month.unpricedDoses }} dose{{ month.unpricedDoses === 1 ? '' : 's' }} without a chemical price (counted as $0).</div>
            <div v-if="month.missingMileage">No distance from HQ or no rate per mile, so mileage counted as $0.</div>
          </q-card-section>
        </template>
        <q-card-actions align="right"><q-btn flat label="Close" @click="closeDetail" /></q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { categoryLabel, type LedgerKind } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { api, errorMessage } from '@/stores/api';
import { money } from '@/lib/customer';
import { periodLabel } from '@/lib/money';
import { moneySummary, PERIOD_LABEL, periodRange, type PeriodKey } from '@/lib/report';
import type { Ledger } from '@/lib/types';

defineOptions({ name: 'MoneyPage' });

interface VisitRow {
  visitId: string;
  date: string;
  minutes: number | null;
  timeFrom: 'timer' | 'pool' | 'all' | null;
  perHour: number | null;
}
interface MonthRow {
  month: string;
  complete: boolean;
  billed: number;
  billedFromRate: boolean;
  chemicalCost: number;
  unpricedDoses: number;
  mileageCost: number;
  missingMileage: boolean;
  expenses: number;
  profit: number;
  hours: number;
  perHour: number | null;
  visits: VisitRow[];
}
interface HoursRow {
  customerId: string;
  name: string;
  months: MonthRow[];
  profit: number;
  hours: number;
  perHour: number | null;
  visitCount: number;
  estimatedVisits: number;
  inProgress: boolean;
}

const data = useDataStore();
const period = ref<PeriodKey>('thisMonth');
const periodOptions = (Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => ({ label: PERIOD_LABEL[k], value: k }));
const range = computed(() => periodRange(period.value));
const sum = computed(() => moneySummary(data.invoices, data.ledger, range.value.from, range.value.to, data.settings?.mileageRate));
const entries = computed(() => data.ledger.filter((e) => e.date >= range.value.from && e.date <= range.value.to));

const ICON: Record<LedgerKind, string> = { expense: 'receipt_long', income: 'add_card', mileage: 'directions_car' };
const entryTitle = (e: Ledger) =>
  e.kind === 'mileage' ? `Miles${e.note ? ` · ${e.note}` : ''}` : e.kind === 'income' ? `Income${e.note ? ` · ${e.note}` : ''}` : [categoryLabel(e.category), e.vendor].filter(Boolean).join(' · ');
const shortDay = (d: string) => new Date(`${d}T12:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Per-customer hours come from the server (it has every visit; the phone keeps recent ones).
const hours = ref<{ rows: HoursRow[] } | null>(null);
const hoursError = ref('');
const hoursLoading = ref(false);
const detail = ref<HoursRow | null>(null);
const month = ref<MonthRow | null>(null);
/** One month opens straight to its breakdown; more months show the list first. */
function openCustomer(r: HoursRow) {
  detail.value = r;
  month.value = r.months.length === 1 ? r.months[0]! : null;
}
function closeDetail() {
  detail.value = null;
  month.value = null;
}
async function loadHours() {
  hoursLoading.value = true;
  hoursError.value = '';
  try {
    const { from, to } = range.value;
    hours.value = await api(`/reports/customer-hours?from=${from}&to=${to}&tzOffsetMin=${new Date().getTimezoneOffset()}`);
  } catch (err) {
    hours.value = null;
    hoursError.value = `Needs a connection (it uses every visit, and the phone keeps only recent ones). ${errorMessage(err)}`;
  } finally {
    hoursLoading.value = false;
  }
}
watch(period, () => void loadHours(), { immediate: true });
</script>
