<template>
  <q-page class="q-pa-md">
    <q-form class="column q-gutter-md" @submit.prevent="save">
      <div class="text-caption text-grey-7">{{ $t(`Shown on invoices and recaps. Everything is optional.`) }}</div>

      <div class="row items-center q-gutter-md">
        <div class="logo-box" data-test="business-logo">
          <img v-if="form.logoDataUrl" :src="form.logoDataUrl" alt="Logo" />
          <q-icon v-else name="image" size="40px" color="grey-5" />
        </div>
        <div class="column q-gutter-xs">
          <q-btn outline dense no-caps color="primary" icon="upload" :label="form.logoDataUrl ? $t('Change logo') : $t('Add logo')" @click="logoInput?.click()" />
          <q-btn v-if="form.logoDataUrl" flat dense no-caps color="grey-8" icon="close" :label="$t(`Remove`)" @click="form.logoDataUrl = ''" />
        </div>
        <input ref="logoInput" type="file" accept="image/*" class="hidden" data-test="business-logo-input" @change="onLogo" />
      </div>

      <q-input v-model="form.businessName" outlined :label="$t(`Business name`)" data-test="business-name" />
      <div class="row q-col-gutter-sm">
        <q-input v-model="form.phone" outlined dense :label="$t(`Phone`)" type="tel" class="col-6" data-test="business-phone" />
        <q-input v-model="form.email" outlined dense :label="$t(`Email`)" type="email" class="col-6" data-test="business-email" />
      </div>
      <div>
        <div class="text-subtitle2 q-mb-xs">{{ $t(`Address`) }}</div>
        <AddressFields v-model="form.address" />
      </div>
      <q-input v-model="form.paymentInstructions" outlined autogrow type="textarea" :label="$t(`Payment instructions (on every invoice)`)" :hint="$t(`e.g. Checks payable to … · Zelle: …`)" data-test="business-payment" />

      <div class="text-subtitle2">{{ $t(`Invoices`) }}</div>
      <div class="row q-col-gutter-sm">
        <q-select v-model="form.terms" outlined dense :label="$t(`Payment terms`)" emit-value map-options :options="termOptions" class="col-6" data-test="business-terms" />
        <q-input v-model="form.firstInvoiceNumber" outlined dense :label="$t(`First invoice number`)" type="number" inputmode="numeric" min="1" class="col-6" data-test="business-first-number" />
      </div>
      <q-input v-model="form.mileageRate" outlined dense :label="$t(`Rate per mile`)" prefix="$" type="number" inputmode="decimal" min="0" step="0.01" :hint="$t(`For mileage totals and each customer's mileage cost (e.g. the IRS standard rate)`)" data-test="business-mileage-rate" />
      <q-btn-toggle v-model="form.billingTiming" spread no-caps unelevated toggle-color="primary" color="grey-3" text-color="grey-9" :options="timingOptions" data-test="business-timing" />
      <div class="text-caption text-grey-7">{{ form.billingTiming === 'end' ? $t('Invoices made in December bill November.') : $t('Invoices made in November bill November.') }}</div>

      <q-btn type="submit" color="primary" unelevated size="lg" :label="$t(`Save`)" :loading="busy" data-test="business-save" />
    </q-form>
  </q-page>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import type { BillingTiming, InvoiceTerms } from '@pool/shared';
import AddressFields from '@/components/AddressFields.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { cleanAddress, numberOrNull } from '@/lib/customer';
import { TERMS_LABEL } from '@/lib/money';

defineOptions({ name: 'BusinessPage' });

const $q = useQuasar();
const router = useRouter();
const data = useDataStore();
const busy = ref(false);
const logoInput = ref<HTMLInputElement | null>(null);

const termOptions = (['receipt', 'net15', 'net30'] as const).map((value) => ({ label: TERMS_LABEL[value], value }));
const timingOptions = [
  { label: t('Bill at the start of the month'), value: 'start' },
  { label: t('Bill at the end'), value: 'end' },
];

const form = reactive({
  businessName: '',
  phone: '',
  email: '',
  address: { line1: '', line2: '', city: '', state: 'TX', zip: '' },
  paymentInstructions: '',
  logoDataUrl: '',
  terms: 'receipt' as InvoiceTerms,
  billingTiming: 'start' as BillingTiming,
  firstInvoiceNumber: '' as string | number,
  mileageRate: '' as string | number,
});

watch(
  () => data.settings,
  (s) => {
    if (!s) return;
    form.businessName = s.businessName ?? '';
    form.phone = s.phone ?? '';
    form.email = s.email ?? '';
    form.address = { line1: '', line2: '', city: '', state: '', zip: '', ...s.address };
    form.paymentInstructions = s.paymentInstructions ?? '';
    form.logoDataUrl = s.logoDataUrl ?? '';
    form.terms = s.terms ?? 'receipt';
    form.billingTiming = s.billingTiming ?? 'start';
    form.firstInvoiceNumber = s.firstInvoiceNumber ?? '';
    form.mileageRate = s.mileageRate ?? '';
  },
  { immediate: true },
);

/** Shrinks the logo to invoice size (max 400 px), keeping transparency. */
async function onLogo(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    form.logoDataUrl = canvas.toDataURL('image/png');
  } catch (err) {
    $q.notify({ type: 'negative', message: t("Couldn't read that image: {err}", { err: errorMessage(err) }) });
  }
}

async function save() {
  busy.value = true;
  try {
    const first = numberOrNull(form.firstInvoiceNumber);
    await data.saveSettings({
      businessName: form.businessName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: cleanAddress(form.address),
      paymentInstructions: form.paymentInstructions.trim(),
      logoDataUrl: form.logoDataUrl,
      terms: form.terms,
      billingTiming: form.billingTiming,
      firstInvoiceNumber: first && first >= 1 ? Math.round(first) : null,
      mileageRate: numberOrNull(form.mileageRate),
    });
    $q.notify({ message: t('Saved'), color: 'grey-8' });
    router.back();
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.logo-box {
  width: 96px;
  height: 96px;
  border: 1px solid #cfd8dc;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: white;
}
.logo-box img {
  max-width: 100%;
  max-height: 100%;
}
</style>
