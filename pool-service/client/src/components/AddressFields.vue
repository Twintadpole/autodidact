<template>
  <div class="q-gutter-sm">
    <q-input v-model="model.line1" outlined dense label="Street address" :rules="required ? [req] : []" hide-bottom-space data-test="addr-line1" />
    <q-input v-model="model.line2" outlined dense label="Apt / suite (optional)" />
    <div class="row q-col-gutter-sm">
      <q-input v-model="model.city" outlined dense label="City" class="col-6" :rules="required ? [req] : []" hide-bottom-space data-test="addr-city" />
      <q-input v-model="model.state" outlined dense label="State" class="col-2" :rules="required ? [req] : []" hide-bottom-space data-test="addr-state" />
      <q-input v-model="model.zip" outlined dense label="ZIP" inputmode="numeric" class="col-4" :rules="required ? [req] : []" hide-bottom-space data-test="addr-zip" />
    </div>
  </div>
</template>

<script setup lang="ts">
const model = defineModel<{ line1: string; line2: string; city: string; state: string; zip: string }>({ required: true });
defineProps<{ required?: boolean }>();
const req = (v: string) => !!v?.trim() || 'Required';
</script>
