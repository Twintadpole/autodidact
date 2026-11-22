<template>
  <!-- Customer fields, shared by the phone form and the desktop panel. Only the name is needed. -->
  <div class="column q-gutter-md">
    <q-input v-model="form.name" outlined :label="$t(`Name`)" :rules="[(v) => !!v?.trim() || $t('A name is needed')]" hide-bottom-space data-test="customer-name" />

    <q-btn-toggle v-model="form.status" spread no-caps unelevated toggle-color="primary" color="grey-3" text-color="grey-9" :options="STATUS_OPTIONS" data-test="customer-status" />

    <div>
      <div class="text-subtitle2 q-mb-xs">{{ $t(`Phones`) }}</div>
      <div v-for="(ph, i) in form.phones" :key="i" class="row no-wrap items-start q-gutter-x-sm q-mb-sm">
        <q-input v-model="ph.label" outlined dense :label="$t(`Label`)" style="width: 96px" />
        <q-input
          v-model="ph.number"
          outlined
          dense
          :label="$t(`Number`)"
          type="tel"
          inputmode="tel"
          class="col"
          :rules="[(v) => !v || !!normalizePhone(v) || $t('Use 10 digits, or + and country code')]"
          hide-bottom-space
          data-test="customer-phone"
        />
        <q-btn flat round dense icon="close" :aria-label="$t(`Remove phone`)" @click="form.phones.splice(i, 1)" />
      </div>
      <q-btn flat no-caps color="primary" icon="add" :label="$t(`Add phone`)" @click="form.phones.push({ label: 'mobile', number: '' })" />
    </div>

    <q-input v-model="form.email" outlined dense :label="$t(`Email`)" type="email" :rules="[(v) => !v?.trim() || looksLikeEmail(v) || $t('Check the email')]" hide-bottom-space data-test="customer-email" />

    <div>
      <div class="text-subtitle2 q-mb-xs">{{ $t(`Address`) }}</div>
      <AddressFields v-model="form.address" />
    </div>

    <q-input v-model="form.notes" outlined autogrow type="textarea" :label="$t(`Notes`)" />

    <div v-if="auth.isOwner">
      <div class="text-subtitle2 q-mb-xs">{{ $t(`Billing and service`) }}</div>
      <div class="row q-col-gutter-sm">
        <q-input v-model="form.monthlyRate" outlined dense :label="$t(`Monthly rate`)" prefix="$" type="number" inputmode="decimal" min="0" step="0.01" class="col-6" data-test="customer-rate" />
        <q-select v-model="form.paymentMethod" outlined dense :label="$t(`Usually pays by`)" emit-value map-options clearable :options="PAYMENT_OPTIONS" class="col-6" data-test="customer-payment" />
        <q-input v-model="form.billingEmail" outlined dense :label="$t(`Billing email (if different)`)" type="email" class="col-12" :rules="[(v) => !v?.trim() || looksLikeEmail(v) || $t('Check the email')]" hide-bottom-space data-test="customer-billing-email" />
        <q-input v-model="form.startDate" outlined dense stack-label :label="$t(`Service started`)" type="date" class="col-6" data-test="customer-start" />
        <q-input v-model="form.endDate" outlined dense stack-label :label="$t(`Service ended`)" type="date" class="col-6" data-test="customer-end" />
        <q-input v-model="form.distanceMiles" outlined dense :label="$t(`Distance from HQ`)" suffix="miles" type="number" inputmode="decimal" min="0" step="0.1" class="col-6" data-test="customer-distance" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AddressFields from '@/components/AddressFields.vue';
import { useAuthStore } from '@/stores/auth';
import { normalizePhone } from '@/lib/format';
import { looksLikeEmail, PAYMENT_OPTIONS, STATUS_OPTIONS } from '@/lib/customer';
import type { CustomerForm } from '@/lib/customerForm';

/** The parent's reactive form, edited in place. */
defineProps<{ form: CustomerForm }>();
/** Billing fields are the owner's (GPF item 3): a tech's phone never has them. */
const auth = useAuthStore();
</script>
