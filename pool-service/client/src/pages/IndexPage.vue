<template>
  <q-page padding>
    <q-card flat bordered>
      <q-card-section>
        <div class="text-h6">Scaffold is running</div>
        <div class="text-body2 text-grey-8">
          The Route list, visit cards and issues arrive in Phase 3. This page only checks that the API is reachable.
        </div>
      </q-card-section>
      <q-card-section class="row items-center q-gutter-sm">
        <q-chip :color="chipColor" text-color="white" :icon="chipIcon">API: {{ health.status }}</q-chip>
        <q-btn flat color="primary" label="Check again" @click="health.check()" />
      </q-card-section>
      <q-card-section>
        <div class="text-caption text-grey-7">Readings configured: {{ readingLabels }}</div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { READINGS } from '@pool/shared';
import { useHealthStore } from '@/stores/health';

defineOptions({ name: 'IndexPage' });

const health = useHealthStore();
const readingLabels = READINGS.map((r) => r.short).join(', ');
const chipColor = computed(() => ({ ok: 'positive', down: 'negative', unknown: 'grey' })[health.status]);
const chipIcon = computed(() => ({ ok: 'cloud_done', down: 'cloud_off', unknown: 'cloud_queue' })[health.status]);

onMounted(() => void health.check());
</script>
