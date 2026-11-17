<template>
  <q-page class="q-pa-md">
    <q-form class="column q-gutter-md" @submit.prevent="save">
      <q-input v-model="form.name" outlined label="Name" :rules="[(v) => !!v?.trim() || 'A name is needed']" hide-bottom-space data-test="customer-name" />

      <q-btn-toggle v-model="form.status" spread no-caps unelevated toggle-color="primary" color="grey-3" text-color="grey-9" :options="STATUS_OPTIONS" data-test="customer-status" />

      <div>
        <div class="text-subtitle2 q-mb-xs">Phones</div>
        <div v-for="(ph, i) in form.phones" :key="i" class="row no-wrap items-start q-gutter-x-sm q-mb-sm">
          <q-input v-model="ph.label" outlined dense label="Label" style="width: 96px" />
          <q-input
            v-model="ph.number"
            outlined
            dense
            label="Number"
            type="tel"
            inputmode="tel"
            class="col"
            :rules="[(v) => !v || !!normalizePhone(v) || 'Use 10 digits, or + and country code']"
            hide-bottom-space
            data-test="customer-phone"
          />
          <q-btn flat round dense icon="close" aria-label="Remove phone" @click="form.phones.splice(i, 1)" />
        </div>
        <q-btn flat no-caps color="primary" icon="add" label="Add phone" @click="form.phones.push({ label: 'mobile', number: '' })" />
      </div>

      <q-input v-model="form.email" outlined dense label="Email" type="email" :rules="[(v) => !v?.trim() || looksLikeEmail(v) || 'Check the email']" hide-bottom-space data-test="customer-email" />

      <div>
        <div class="text-subtitle2 q-mb-xs">Address</div>
        <AddressFields v-model="form.address" />
      </div>

      <q-input v-model="form.notes" outlined autogrow type="textarea" label="Notes" />

      <div>
        <div class="text-subtitle2 q-mb-xs">Billing and service</div>
        <div class="row q-col-gutter-sm">
          <q-input v-model="form.monthlyRate" outlined dense label="Monthly rate" prefix="$" type="number" inputmode="decimal" min="0" step="0.01" class="col-6" data-test="customer-rate" />
          <q-select v-model="form.paymentMethod" outlined dense label="Usually pays by" emit-value map-options clearable :options="PAYMENT_OPTIONS" class="col-6" data-test="customer-payment" />
          <q-input v-model="form.billingEmail" outlined dense label="Billing email (if different)" type="email" class="col-12" :rules="[(v) => !v?.trim() || looksLikeEmail(v) || 'Check the email']" hide-bottom-space data-test="customer-billing-email" />
          <q-input v-model="form.startDate" outlined dense stack-label label="Service started" type="date" class="col-6" data-test="customer-start" />
          <q-input v-model="form.endDate" outlined dense stack-label label="Service ended" type="date" class="col-6" data-test="customer-end" />
          <q-input v-model="form.distanceMiles" outlined dense label="Distance from HQ" suffix="miles" type="number" inputmode="decimal" min="0" step="0.1" class="col-6" data-test="customer-distance" />
        </div>
      </div>

      <q-btn type="submit" color="primary" unelevated size="lg" :label="isNew ? 'Add customer' : 'Save'" :loading="busy" data-test="customer-save" />
      <q-btn v-if="!isNew" flat color="negative" icon="delete" label="Delete customer" @click="remove" />
    </q-form>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import AddressFields from '@/components/AddressFields.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { formatPhone, normalizePhone } from '@/lib/format';
import { cleanAddress, dateInput, looksLikeEmail, numberOrNull, PAYMENT_OPTIONS, STATUS_OPTIONS } from '@/lib/customer';
import { useUiStore } from '@/stores/ui';
import { customerStatus, type CustomerStatus, type PaymentMethod } from '@pool/shared';
import type { Customer } from '@/lib/types';

defineOptions({ name: 'CustomerFormPage' });

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const data = useDataStore();
const busy = ref(false);

const id = computed(() => (route.params.id ? String(route.params.id) : null));
const isNew = computed(() => !id.value);

// A new customer gets the class of the list it was added from (e.g. Prospects).
const ui = useUiStore();
const form = reactive({
  name: '',
  status: (ui.customerFilter === 'all' ? 'current' : ui.customerFilter) as CustomerStatus,
  phones: [{ label: 'mobile', number: '' }] as { label: string; number: string }[],
  email: '',
  address: { line1: '', line2: '', city: '', state: 'TX', zip: '' },
  notes: '',
  monthlyRate: '' as string | number,
  paymentMethod: null as PaymentMethod | null,
  billingEmail: '',
  startDate: '',
  endDate: '',
  distanceMiles: '' as string | number,
});

watch(
  () => (id.value ? data.customerById.get(id.value) : undefined),
  (c) => {
    if (!c) return;
    form.name = c.name;
    form.phones = c.phones.map((p) => ({ label: p.label, number: formatPhone(p.number) }));
    form.email = c.email ?? '';
    form.address = { line1: '', line2: '', city: '', state: '', zip: '', ...c.address } as typeof form.address;
    form.notes = c.notes ?? '';
    form.status = customerStatus(c);
    form.monthlyRate = c.monthlyRate ?? '';
    form.paymentMethod = c.paymentMethod ?? null;
    form.billingEmail = c.billingEmail ?? '';
    form.startDate = dateInput(c.startDate);
    form.endDate = dateInput(c.endDate);
    form.distanceMiles = c.distanceMiles ?? '';
  },
  { immediate: true },
);

async function save() {
  const phones = form.phones
    .filter((p) => p.number.trim())
    .map((p) => ({ label: p.label.trim() || 'phone', number: normalizePhone(p.number) }));
  if (phones.some((p) => !p.number)) {
    $q.notify({ type: 'warning', message: 'Check the phone numbers.' });
    return;
  }
  if ([form.email, form.billingEmail].some((e) => e.trim() && !looksLikeEmail(e))) {
    $q.notify({ type: 'warning', message: 'Check the email address.' });
    return;
  }
  const address = cleanAddress(form.address);
  // Cleared Phase 7 fields are sent as null so the server clears them too.
  const body: Partial<Customer> = {
    name: form.name.trim(),
    phones: phones as Customer['phones'],
    ...(address ? { address } : {}),
    ...(form.email.trim() ? { email: form.email.trim() } : {}),
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    status: form.status,
    monthlyRate: numberOrNull(form.monthlyRate),
    paymentMethod: form.paymentMethod ?? null,
    billingEmail: form.billingEmail.trim() || null,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
    distanceMiles: numberOrNull(form.distanceMiles),
  };
  busy.value = true;
  try {
    const saved = await data.saveCustomer(id.value, body);
    if (isNew.value) await router.replace(`/customers/${saved._id}`);
    else router.back();
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}

function remove() {
  if (!id.value) return;
  $q.dialog({
    title: 'Delete customer?',
    message: 'Their pools are removed from the route too.',
    cancel: true,
    ok: { label: 'Delete', color: 'negative', unelevated: true },
  }).onOk(async () => {
    await data.deleteCustomer(id.value!);
    await router.replace('/customers');
  });
}
</script>
