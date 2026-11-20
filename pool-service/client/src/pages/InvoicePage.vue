<template>
  <q-page class="q-pa-md">
    <InvoiceEditor :id="id" @deleted="router.back()" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import InvoiceEditor from '@/components/InvoiceEditor.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';

defineOptions({ name: 'InvoicePage' });

const route = useRoute();
const router = useRouter();
const data = useDataStore();
const ui = useUiStore();
const id = computed(() => String(route.params.id));

watch(
  () => data.invoiceById.get(id.value),
  (i) => {
    if (i) ui.setTitle(`Invoice #${i.number}`, data.customerById.get(i.customerId)?.name ?? '');
  },
  { immediate: true },
);
</script>
