<template>
  <q-page class="q-pa-md">
    <q-form class="column q-gutter-md" @submit.prevent="save">
      <CustomerFields :form="form" />

      <q-btn type="submit" color="primary" unelevated size="lg" :label="isNew ? 'Add customer' : 'Save'" :loading="busy" data-test="customer-save" />
      <q-btn v-if="!isNew && auth.isOwner" flat color="negative" icon="delete" label="Delete customer" @click="remove" />
    </q-form>
  </q-page>
</template>

<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import CustomerFields from '@/components/CustomerFields.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { blankCustomerForm, customerFromForm, customerToForm } from '@/lib/customerForm';
import { useUiStore } from '@/stores/ui';

defineOptions({ name: 'CustomerFormPage' });
const auth = useAuthStore();

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const data = useDataStore();
const busy = ref(false);

const id = computed(() => (route.params.id ? String(route.params.id) : null));
const isNew = computed(() => !id.value);

// A new customer gets the class of the list it was added from (e.g. Prospects).
const ui = useUiStore();
const form = reactive(blankCustomerForm(ui.customerFilter === 'all' ? 'current' : ui.customerFilter));

watch(
  () => (id.value ? data.customerById.get(id.value) : undefined),
  (c) => {
    if (c) Object.assign(form, customerToForm(c));
  },
  { immediate: true },
);

async function save() {
  const result = customerFromForm(form);
  if ('error' in result) {
    $q.notify({ type: 'warning', message: result.error });
    return;
  }
  const body = result.body;
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
