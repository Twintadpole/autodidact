<template>
  <q-page class="q-pa-md">
    <q-form class="column q-gutter-md" @submit.prevent="save">
      <LedgerFields :form="form" :kind="kind" :existing="existing" />

      <q-btn type="submit" color="primary" unelevated size="lg" label="Save" :loading="busy" data-test="entry-save" />
      <q-btn v-if="existing" flat color="negative" icon="delete" label="Delete" no-caps data-test="entry-delete" @click="remove" />
    </q-form>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import type { LedgerKind } from '@pool/shared';
import LedgerFields from '@/components/LedgerFields.vue';
import { blankLedgerForm, ledgerFromForm, ledgerToForm } from '@/lib/ledgerForm';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { errorMessage } from '@/stores/api';

defineOptions({ name: 'LedgerEntryPage' });

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const data = useDataStore();
const ui = useUiStore();
const busy = ref(false);

const existing = computed(() => (route.params.id ? data.ledger.find((e) => e._id === String(route.params.id)) : undefined));
const kind = computed<LedgerKind>(() => existing.value?.kind ?? ((route.params.kind as LedgerKind) || 'expense'));
const TITLES: Record<LedgerKind, string> = { expense: 'Expense', income: 'Other income', mileage: 'Miles' };

const form = reactive(blankLedgerForm());

watch(
  existing,
  (e) => {
    ui.setTitle(`${e ? 'Edit' : 'New'} ${TITLES[kind.value].toLowerCase()}`);
    if (e) Object.assign(form, ledgerToForm(e));
  },
  { immediate: true },
);

async function save() {
  const doc = ledgerFromForm(form, kind.value, existing.value);
  busy.value = true;
  try {
    const saved = await data.saveLedger(doc);
    if (saved.billToCustomer && saved.invoiceId && (!existing.value || existing.value.invoiceId !== saved.invoiceId)) {
      const inv = data.invoiceById.get(saved.invoiceId);
      $q.notify({ type: 'positive', message: inv ? `Added to draft invoice #${inv.number}` : 'Added to their invoice' });
    }
    router.back();
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}

function remove() {
  const e = existing.value;
  if (!e) return;
  $q.dialog({ title: `Delete this ${TITLES[e.kind].toLowerCase()}?`, cancel: true, ok: { label: 'Delete', color: 'negative', unelevated: true } }).onOk(async () => {
    await data.deleteLedger(e._id);
    router.back();
  });
}
</script>
