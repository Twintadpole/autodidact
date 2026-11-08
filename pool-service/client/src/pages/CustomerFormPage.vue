<template>
  <q-page class="q-pa-md">
    <q-form class="column q-gutter-md" @submit.prevent="save">
      <q-input v-model="form.name" outlined label="Name" :rules="[(v) => !!v?.trim() || 'Required']" hide-bottom-space data-test="customer-name" />

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

      <q-input v-model="form.email" outlined dense label="Email (optional)" type="email" />

      <div>
        <div class="text-subtitle2 q-mb-xs">Address</div>
        <AddressFields v-model="form.address" required />
      </div>

      <q-input v-model="form.notes" outlined autogrow type="textarea" label="Notes (optional)" />

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
import type { Customer } from '@/lib/types';

defineOptions({ name: 'CustomerFormPage' });

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const data = useDataStore();
const busy = ref(false);

const id = computed(() => (route.params.id ? String(route.params.id) : null));
const isNew = computed(() => !id.value);

const form = reactive({
  name: '',
  phones: [{ label: 'mobile', number: '' }] as { label: string; number: string }[],
  email: '',
  address: { line1: '', line2: '', city: '', state: 'TX', zip: '' },
  notes: '',
});

watch(
  () => (id.value ? data.customerById.get(id.value) : undefined),
  (c) => {
    if (!c) return;
    form.name = c.name;
    form.phones = c.phones.map((p) => ({ label: p.label, number: formatPhone(p.number) }));
    form.email = c.email ?? '';
    form.address = { line2: '', ...c.address } as typeof form.address;
    form.notes = c.notes ?? '';
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
  const a = form.address;
  const body: Partial<Customer> = {
    name: form.name.trim(),
    phones: phones as Customer['phones'],
    address: { line1: a.line1.trim(), city: a.city.trim(), state: a.state.trim(), zip: a.zip.trim(), ...(a.line2.trim() ? { line2: a.line2.trim() } : {}) },
    ...(form.email.trim() ? { email: form.email.trim() } : {}),
    ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
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
