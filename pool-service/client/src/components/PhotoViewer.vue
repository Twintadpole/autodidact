<template>
  <q-dialog :model-value="!!photo" maximized @update:model-value="(v: boolean) => !v && emit('close')">
    <q-card v-if="photo" class="bg-black text-white column no-wrap" data-test="photo-viewer">
      <q-bar class="bg-black">
        <div class="text-caption">{{ when }}</div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Close" @click="emit('close')" />
      </q-bar>
      <div class="col flex flex-center">
        <PhotoImg :photo-id="photo._id" plain class="viewer-img" />
      </div>
      <q-card-actions class="bg-black q-pa-md">
        <q-toggle
          :model-value="photo.savedToPool"
          color="positive"
          dark
          label="In pool gallery"
          data-test="viewer-save-to-pool"
          @update:model-value="(v: boolean) => emit('save-to-pool', v)"
        />
        <q-space />
        <q-btn flat color="red-3" icon="delete" label="Delete" @click="emit('delete')" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { format, parseISO } from 'date-fns';
import PhotoImg from '@/components/PhotoImg.vue';
import type { Photo } from '@/lib/types';

const props = defineProps<{ photo: Photo | null }>();
const emit = defineEmits<{ close: []; 'save-to-pool': [boolean]; delete: [] }>();
const when = computed(() => (props.photo ? format(parseISO(props.photo.takenAt), 'MMM d, yyyy h:mm a') : ''));
</script>

<style scoped>
.viewer-img {
  max-width: 100%;
  max-height: calc(100vh - 140px);
  object-fit: contain;
}
</style>
