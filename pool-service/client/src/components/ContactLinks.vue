<template>
  <q-list bordered separator class="bg-white rounded-borders">
    <q-item v-for="(ph, i) in customer.phones" :key="i" data-test="phone-row">
      <q-item-section avatar><q-icon name="phone" color="primary" /></q-item-section>
      <q-item-section>
        <q-item-label>{{ formatPhone(ph.number) }}</q-item-label>
        <q-item-label caption>{{ ph.label }}</q-item-label>
      </q-item-section>
      <q-item-section side class="row no-wrap">
        <q-btn round flat color="primary" icon="call" :href="telHref(ph.number)" aria-label="Call" data-test="tel-link" />
        <q-btn round flat color="primary" icon="sms" :href="smsHref(ph.number)" aria-label="Text" data-test="sms-link" />
      </q-item-section>
    </q-item>
    <q-item v-if="address" clickable tag="a" :href="mapsUrl(address)" target="_blank" data-test="maps-link">
      <q-item-section avatar><q-icon name="directions" color="primary" /></q-item-section>
      <q-item-section>
        <q-item-label>{{ addressText(address) }}</q-item-label>
        <q-item-label caption>Navigate with Google Maps</q-item-label>
      </q-item-section>
    </q-item>
    <q-item v-if="customer.email" clickable tag="a" :href="`mailto:${customer.email}`">
      <q-item-section avatar><q-icon name="email" color="primary" /></q-item-section>
      <q-item-section>{{ customer.email }}</q-item-section>
    </q-item>
  </q-list>
</template>

<script setup lang="ts">
import { addressText, formatPhone, mapsUrl, smsHref, telHref } from '@/lib/format';
import type { Address, Customer } from '@/lib/types';

defineProps<{ customer: Customer; address: Address | undefined }>();
</script>
