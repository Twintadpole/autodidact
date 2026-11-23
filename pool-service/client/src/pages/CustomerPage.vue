<template>
  <q-page class="q-pa-md column q-gutter-md">
    <Teleport defer to="#header-actions">
      <q-btn v-if="customer" flat round icon="edit" :aria-label="$t(`Edit customer`)" :to="`/customers/${customer._id}/edit`" data-test="edit-customer" />
    </Teleport>

    <div v-if="!customer" class="flex flex-center q-pa-xl">
      <q-spinner v-if="!data.loaded" size="40px" color="primary" />
      <div v-else class="text-grey-7">{{ $t(`Customer not found.`) }}</div>
    </div>
    <template v-else>
      <div class="row items-center q-gutter-sm">
        <q-badge :color="STATUS_COLOR[status]" :label="STATUS_LABEL[status]" class="text-body2 q-px-sm" data-test="customer-status-badge" />
        <span v-if="status !== 'current'" class="text-caption text-grey-7">{{ $t(`Not on the Route or Issues lists`) }}</span>
      </div>
      <ContactLinks :customer="customer" :address="customer.address" />
      <q-list v-if="billing.length" dense bordered class="bg-white rounded-borders" data-test="customer-billing">
        <q-item v-for="b in billing" :key="b.label">
          <q-item-section class="text-grey-7">{{ b.label }}</q-item-section>
          <q-item-section side class="text-grey-10">{{ b.value }}</q-item-section>
        </q-item>
      </q-list>
      <div v-if="customer.notes" class="text-body2 text-grey-8 q-px-sm"><q-icon name="info" /> {{ customer.notes }}</div>

      <div>
        <div class="row items-center justify-between q-mb-xs">
          <div class="text-subtitle1">{{ $t(`Pools`) }}</div>
          <q-btn flat dense no-caps color="primary" icon="add" :label="$t(`Add pool`)" :to="`/customers/${customer._id}/pools/new`" data-test="add-pool" />
        </div>
        <q-list v-if="pools.length" bordered separator class="bg-white rounded-borders">
          <q-item v-for="p in pools" :key="p._id" clickable :to="`/pools/${p._id}/overview`" :data-test="`pool-${p._id}`">
            <q-item-section avatar><q-icon name="pool" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label>{{ p.name }}<span v-if="!p.active" class="text-grey-6"> {{ $t(`(inactive)`) }}</span></q-item-label>
              <q-item-label caption>{{ poolCaption(p) }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat round color="primary" icon="assignment" :aria-label="$t(`Log visit`)" :to="`/pools/${p._id}`" @click.stop />
            </q-item-section>
          </q-item>
        </q-list>
        <div v-else class="text-grey-6 text-body2">{{ $t(`No pools yet.`) }}</div>
      </div>

      <div v-if="auth.isOwner" data-test="customer-invoices">
        <div class="row items-center justify-between q-mb-xs">
          <div class="text-subtitle1">{{ $t(`Invoices`) }}<span v-if="owed" class="text-negative text-body2"> · {{ money(owed) }} owed</span></div>
          <q-btn flat dense no-caps color="primary" icon="add" :label="$t(`New invoice`)" data-test="new-invoice" @click="newInvoice" />
        </div>
        <q-list v-if="custInvoices.length" bordered separator class="bg-white rounded-borders">
          <q-item v-for="i in custInvoices.slice(0, 6)" :key="i._id" clickable :to="`/invoices/${i._id}`" :data-test="`cust-invoice-${i.number}`">
            <q-item-section>
              <q-item-label>#{{ i.number }} · {{ periodLabel(i.period) || i.issueDate.slice(0, 10) }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-item-label class="text-grey-10">{{ money(invoiceTotal(i)) }}</q-item-label>
              <q-badge :color="STATE_COLOR[invoiceState(i)]" :label="STATE_LABEL[invoiceState(i)]" />
            </q-item-section>
          </q-item>
        </q-list>
        <div v-else class="text-grey-6 text-body2">{{ $t(`No invoices yet.`) }}</div>
      </div>

      <div>
        <div class="text-subtitle1 q-mb-xs">{{ $t(`Notes`) }}</div>
        <NotesList parent-type="customer" :parent-id="customer._id" />
      </div>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { locale, t } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import ContactLinks from '@/components/ContactLinks.vue';
import NotesList from '@/components/NotesList.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { DAY_LABELS } from '@/lib/format';
import { money, PAYMENT_LABEL, scheduleText, STATUS_COLOR, STATUS_LABEL } from '@/lib/customer';
import { customerStatus, invoiceState, invoiceTotal } from '@pool/shared';
import { periodLabel } from '@/lib/money';
import { STATE_COLOR, STATE_LABEL } from '@/lib/invoice';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { errorMessage } from '@/stores/api';
import { format, parseISO } from 'date-fns';
import type { Pool } from '@/lib/types';

defineOptions({ name: 'CustomerPage' });
const auth = useAuthStore();

const route = useRoute();
const data = useDataStore();
const ui = useUiStore();
const customer = computed(() => data.customerById.get(String(route.params.id)));
const pools = computed(() => data.pools.filter((p) => p.customerId === customer.value?._id));
const status = computed(() => (customer.value ? customerStatus(customer.value) : 'current'));
const custInvoices = computed(() => data.invoices.filter((i) => i.customerId === customer.value?._id));
const owed = computed(() => (customer.value ? (data.balanceByCustomer.get(customer.value._id) ?? 0) : 0));
const router = useRouter();
const $q = useQuasar();
async function newInvoice() {
  if (!customer.value) return;
  try {
    const inv = await data.createInvoice(customer.value._id);
    void router.push(`/invoices/${inv._id}`);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}

const day = (iso: string) => format(parseISO(iso.slice(0, 10)), 'MMM d, yyyy');
/** Only the billing details that are filled in. */
const billing = computed(() => {
  const c = customer.value;
  if (!c) return [];
  const rows: { label: string; value: string }[] = [];
  if (c.monthlyRate != null) rows.push({ label: t('Monthly rate'), value: money(c.monthlyRate) });
  if (c.paymentMethod) rows.push({ label: t('Usually pays by'), value: PAYMENT_LABEL[c.paymentMethod] });
  if (c.billingEmail) rows.push({ label: t('Billing email'), value: c.billingEmail });
  if (c.startDate) rows.push({ label: t('Service started'), value: day(c.startDate) });
  if (c.endDate) rows.push({ label: t('Service ended'), value: day(c.endDate) });
  if (c.distanceMiles != null) rows.push({ label: t('Distance from HQ'), value: t('{miles} mi', { miles: c.distanceMiles }) });
  return rows;
});

const poolCaption = (p: Pool) =>
  [scheduleText(p, DAY_LABELS), p.type === 'salt' ? t('Salt') : p.type === 'chlorine' ? t('Chlorine') : '', p.volumeGal ? t('{gal} gal', { gal: p.volumeGal.toLocaleString(locale.value) }) : '']
    .filter(Boolean)
    .join(' · ');

watch(
  customer,
  (c) => {
    if (c) ui.setTitle(c.name);
  },
  { immediate: true },
);
</script>
