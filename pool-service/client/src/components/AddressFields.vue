<template>
  <div class="q-gutter-sm">
    <q-input v-model="model.line1" outlined dense :label="$t(`Street address`)" :rules="required ? [req] : []" hide-bottom-space data-test="addr-line1" />
    <q-input v-model="model.line2" outlined dense :label="$t(`Apt / suite`)" />
    <div class="row q-col-gutter-sm">
      <q-input v-model="model.city" outlined dense :label="$t(`City`)" class="col-6" :rules="required ? [req] : []" hide-bottom-space data-test="addr-city" />
      <q-input v-model="model.state" outlined dense :label="$t(`State`)" class="col-2" :rules="required ? [req] : []" hide-bottom-space data-test="addr-state" />
      <q-input v-model="model.zip" outlined dense :label="$t(`ZIP`)" inputmode="numeric" class="col-4" :rules="required ? [req] : []" hide-bottom-space data-test="addr-zip" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
const model = defineModel<{ line1: string; line2: string; city: string; state: string; zip: string }>({ required: true });
defineProps<{ required?: boolean }>();
const req = (v: string) => !!v?.trim() || t('Required');
</script>
