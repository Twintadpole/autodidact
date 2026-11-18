<template>
  <!-- Expense, other income or mileage fields, shared by the phone screen and the desktop panel. -->
  <div class="column q-gutter-md">
    <q-input v-model="form.date" outlined stack-label label="Date" type="date" data-test="entry-date" />

    <!-- Expense / income -->
    <template v-if="kind !== 'mileage'">
      <q-input v-model="form.amount" outlined label="Amount" prefix="$" type="number" inputmode="decimal" min="0" step="0.01" autofocus data-test="entry-amount" />
      <q-select
        v-if="kind === 'expense'"
        v-model="form.category"
        outlined
        label="Category"
        emit-value
        map-options
        clearable
        use-input
        fill-input
        hide-selected
        new-value-mode="add-unique"
        input-debounce="0"
        :options="categoryOptions"
        hint="Pick one, or type your own"
        data-test="entry-category"
        @new-value="addCategory"
      />
      <q-input v-if="kind === 'expense'" v-model="form.vendor" outlined label="Vendor" hint="e.g. Leslie's, Home Depot, QT" data-test="entry-vendor" />
      <q-select
        v-model="form.customerId"
        outlined
        :label="kind === 'income' ? 'From customer' : 'For customer'"
        emit-value
        map-options
        clearable
        use-input
        input-debounce="0"
        :options="customerOptions"
        :hint="kind === 'expense' ? 'Counts against this customer’s profit' : ''"
        data-test="entry-customer"
        @filter="filterCustomers"
      />
      <template v-if="billable">
        <q-toggle v-model="form.billToCustomer" label="Add to their invoice" data-test="entry-bill" />
        <q-input v-if="form.billToCustomer" v-model="form.billedAmount" outlined dense label="Bill the customer" prefix="$" type="number" inputmode="decimal" min="0" step="0.01" hint="Starts at what you paid; add a markup if you like" data-test="entry-billed" />
        <div v-if="linkedInvoice && linkedInvoice.status !== 'draft'" class="text-caption text-grey-7">Already on invoice #{{ linkedInvoice.number }} ({{ linkedInvoice.status }}); changes here don't change that invoice.</div>
      </template>
    </template>

    <!-- Mileage -->
    <template v-else>
      <q-input v-model="form.miles" outlined label="Miles driven" type="number" inputmode="decimal" min="0" step="0.1" autofocus data-test="entry-miles" />
      <div class="text-caption text-grey-7 q-mt-xs">Or use the odometer:</div>
      <div class="row q-col-gutter-sm q-mt-none">
        <q-input v-model="form.odometerStart" outlined dense label="Start" type="number" inputmode="decimal" class="col-6" data-test="entry-odo-start" />
        <q-input v-model="form.odometerEnd" outlined dense label="End" type="number" inputmode="decimal" class="col-6" data-test="entry-odo-end" />
      </div>
    </template>

    <q-input v-model="form.note" outlined autogrow type="textarea" label="Note" data-test="entry-note" />

    <!-- Receipt -->
    <div v-if="kind === 'expense'">
      <div class="row items-center q-gutter-sm">
        <div class="text-subtitle2">Receipt</div>
        <q-space />
        <q-btn outline dense no-caps color="primary" icon="photo_camera" label="Camera" @click="cameraInput?.click()" />
        <q-btn outline dense no-caps color="primary" icon="photo_library" label="Gallery" @click="galleryInput?.click()" />
      </div>
      <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onReceipt" />
      <input ref="galleryInput" type="file" accept="image/*" class="hidden" data-test="entry-receipt-input" @change="onReceipt" />
      <div v-if="form.receiptDataUrl" class="q-mt-sm relative-position receipt" data-test="entry-receipt">
        <img :src="form.receiptDataUrl" alt="Receipt" />
        <q-btn round dense color="grey-8" icon="close" size="sm" class="absolute-top-right q-ma-xs" aria-label="Remove receipt" @click="form.receiptDataUrl = ''" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { EXPENSE_CATEGORIES, type LedgerKind } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { numberOrNull } from '@/lib/customer';
import { odometerMiles } from '@/lib/report';
import { canBill, type LedgerForm } from '@/lib/ledgerForm';
import type { Ledger } from '@/lib/types';

/** The parent's reactive form, edited in place. */
const props = defineProps<{ form: LedgerForm; kind: LedgerKind; existing?: Ledger | undefined }>();

const $q = useQuasar();
const data = useDataStore();
const cameraInput = ref<HTMLInputElement | null>(null);
const galleryInput = ref<HTMLInputElement | null>(null);

// Category list: suggestions plus any of the owner's own already used.
const own = computed(() => [...new Set(data.ledger.map((e) => e.category).filter((c): c is string => !!c && !EXPENSE_CATEGORIES.some((x) => x.key === c)))]);
const categoryOptions = computed(() => [...EXPENSE_CATEGORIES.map((c) => ({ label: c.label, value: c.key as string })), ...own.value.map((c) => ({ label: c, value: c }))]);
function addCategory(val: string, done: (v: string, mode: 'add-unique') => void) {
  if (val.trim()) done(val.trim(), 'add-unique');
}

const allCustomers = computed(() => data.customers.map((c) => ({ label: c.name, value: c._id })));
const customerOptions = ref(allCustomers.value);
function filterCustomers(val: string, update: (fn: () => void) => void) {
  update(() => {
    const q = val.toLowerCase();
    customerOptions.value = allCustomers.value.filter((o) => o.label.toLowerCase().includes(q));
  });
}

const billable = computed(() => canBill(props.kind, props.form));
const linkedInvoice = computed(() => (props.existing?.invoiceId ? data.invoiceById.get(props.existing.invoiceId) : undefined));
// The billed amount starts at what was paid.
watch(
  () => props.form.amount,
  (a, old) => {
    if (props.form.billedAmount === '' || String(props.form.billedAmount) === String(old)) props.form.billedAmount = a;
  },
);
// Odometer readings fill in the miles.
watch(
  () => [props.form.odometerStart, props.form.odometerEnd],
  () => {
    const m = odometerMiles(numberOrNull(props.form.odometerStart), numberOrNull(props.form.odometerEnd));
    if (m != null) props.form.miles = m;
  },
);

/** Shrinks a receipt photo so it can be stored with the entry (about 100–300 KB). */
async function onReceipt(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    for (const [max, q] of [
      [1400, 0.7],
      [1000, 0.6],
      [800, 0.5],
    ] as const) {
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', q);
      if (url.length < 850_000 || max === 800) {
        props.form.receiptDataUrl = url;
        break;
      }
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: `Couldn't read that photo (${errorMessage(err)}). If it's a HEIC photo, use the Camera button.` });
  }
}
</script>

<style scoped>
.receipt img {
  max-width: 100%;
  max-height: 320px;
  border-radius: 8px;
  border: 1px solid #cfd8dc;
}
</style>
