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
      <div class="text-caption text-grey-7 q-mb-xs">After chemicals, mileage (estimate) and expenses for them. Lowest first.</div>
      <div v-if="hoursError" class="text-body2 text-grey-7" data-test="customer-hours-error">{{ hoursError }}</div>
      <div v-else-if="hours && !hours.rows.length" class="text-body2 text-grey-7">No visits or billing in this period.</div>
      <q-list v-else-if="hours" bordered separator class="bg-white rounded-borders">
        <q-item v-for="r in hours.rows" :key="r.customerId" clickable :data-test="`hours-${r.customerId}`" @click="detail = r">
          <q-item-section>
            <q-item-label>{{ r.name }}</q-item-label>
            <q-item-label caption>{{ r.visits }} visit{{ r.visits === 1 ? '' : 's' }} · {{ r.hours }} h{{ r.estimatedVisits ? ' (some estimated)' : '' }} · profit {{ money(r.profit) }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-item-label class="text-weight-bold" :class="r.perHour != null && r.perHour < 0 ? 'text-negative' : 'text-grey-10'">{{ r.perHour != null ? `${money(r.perHour)}/h` : '—' }}</q-item-label>
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

    <!-- Breakdown -->
    <q-dialog :model-value="!!detail" @update:model-value="(v: boolean) => !v && (detail = null)">
      <q-card v-if="detail" style="min-width: 300px" data-test="hours-detail">
        <q-card-section class="text-h6">{{ detail.name }}</q-card-section>
        <q-list dense>
          <q-item><q-item-section>Billed</q-item-section><q-item-section side>{{ money(detail.billed) }}</q-item-section></q-item>
          <q-item><q-item-section>Chemicals</q-item-section><q-item-section side>− {{ money(detail.chemicalCost) }}</q-item-section></q-item>
          <q-item><q-item-section>Mileage (estimate)</q-item-section><q-item-section side>− {{ money(detail.mileageCost) }}</q-item-section></q-item>
          <q-item><q-item-section>Expenses for them</q-item-section><q-item-section side>− {{ money(detail.expenses) }}</q-item-section></q-item>
          <q-separator />
          <q-item class="text-weight-bold"><q-item-section>Profit</q-item-section><q-item-section side class="text-grey-10">{{ money(detail.profit) }}</q-item-section></q-item>
          <q-item><q-item-section>Hours on site</q-item-section><q-item-section side>{{ detail.hours }} h</q-item-section></q-item>
          <q-item class="text-weight-bold"><q-item-section>Per hour</q-item-section><q-item-section side class="text-grey-10">{{ detail.perHour != null ? money(detail.perHour) : '—' }}</q-item-section></q-item>
        </q-list>
        <q-card-section class="text-caption text-grey-7 q-gutter-y-xs">
          <div>{{ detail.visits }} visit{{ detail.visits === 1 ? '' : 's' }}: {{ detail.timedVisits }} timed{{ detail.estimatedVisits ? `, ${detail.estimatedVisits} at the pool's average time` : '' }}.</div>
          <div v-if="detail.rateMonths.length">No invoice for {{ detail.rateMonths.map(periodLabel).join(', ') }}: counted their monthly rate.</div>
          <div v-if="detail.unpricedDoses">{{ detail.unpricedDoses }} dose{{ detail.unpricedDoses === 1 ? '' : 's' }} without a chemical price (counted as $0).</div>
          <div v-if="detail.missingMileage">No distance from HQ or no rate per mile, so mileage counted as $0.</div>
        </q-card-section>
        <q-card-actions align="right"><q-btn flat label="Close" v-close-popup /></q-card-actions>
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

interface HoursRow {
  customerId: string;
  name: string;
  visits: number;
  timedVisits: number;
  estimatedVisits: number;
  hours: number;
  billed: number;
  chemicalCost: number;
  mileageCost: number;
  expenses: number;
  profit: number;
  perHour: number | null;
  unpricedDoses: number;
  missingMileage: boolean;
  rateMonths: string[];
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
