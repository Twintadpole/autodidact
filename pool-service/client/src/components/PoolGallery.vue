<template>
  <div>
    <div v-if="!photos.length" class="text-grey-6 text-body2">No photos yet. Turn on “Save to pool” on an issue photo to keep it here.</div>
    <PhotoGrid v-else :photos="photos" data-test="pool-gallery" @open="(ph) => (viewing = ph)" />
    <PhotoViewer :photo="viewing" @close="viewing = null" @save-to-pool="setSaved" @delete="remove" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import PhotoGrid from '@/components/PhotoGrid.vue';
import PhotoViewer from '@/components/PhotoViewer.vue';
import { useDataStore } from '@/stores/data';
import type { Photo } from '@/lib/types';

const props = defineProps<{ poolId: string }>();
const emit = defineEmits<{ count: [number] }>();
const data = useDataStore();
const photos = ref<Photo[]>([]);
const viewing = ref<Photo | null>(null);

async function load() {
  photos.value = await data.listPhotos({ poolId: props.poolId, savedToPool: true }).catch(() => []);
  emit('count', photos.value.length);
}

async function setSaved(v: boolean) {
  if (!viewing.value) return;
  await data.patchPhoto(viewing.value._id, { savedToPool: v });
  viewing.value = { ...viewing.value, savedToPool: v };
  await load();
}

async function remove() {
  if (!viewing.value) return;
  await data.deletePhoto(viewing.value._id);
  viewing.value = null;
  await load();
}

watch(() => props.poolId, load);
watch(() => data.version, load); // photos arrived from the server
onMounted(load);
defineExpose({ load });
</script>
