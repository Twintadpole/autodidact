<template>
  <!-- Edit panel that slides in from the right; the table stays in view behind it. -->
  <q-dialog :model-value="modelValue" position="right" full-height :maximized="$q.screen.lt.sm" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <q-card class="side-panel column no-wrap" data-test="side-panel">
      <q-card-section class="row items-center no-wrap q-py-sm bg-grey-2">
        <div class="text-h6 ellipsis col" data-test="side-panel-title">{{ title }}</div>
        <slot name="head" />
        <q-btn flat round dense icon="close" aria-label="Close" v-close-popup />
      </q-card-section>
      <q-separator />
      <q-card-section class="col scroll">
        <slot />
      </q-card-section>
      <template v-if="slots.actions">
        <q-separator />
        <q-card-actions align="right" class="q-pa-md">
          <slot name="actions" />
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { useSlots } from 'vue';
import { useQuasar } from 'quasar';

defineProps<{ modelValue: boolean; title: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();
const slots = useSlots();
const $q = useQuasar();
</script>

<style scoped>
.side-panel {
  width: 460px;
  max-width: 100vw;
  height: 100%;
}
</style>
