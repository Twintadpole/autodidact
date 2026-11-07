<template>
  <div>
    <div v-if="!photos.length" class="text-grey-6 text-body2">
      No photos yet. Turn on “Save to pool” on an issue photo to keep it here.
    </div>
    <div v-else class="gallery" data-test="pool-gallery">
      <q-img
        v-for="ph in photos"
        :key="ph._id"
        :src="thumbUrl(ph._id)"
        ratio="1"
        class="rounded-borders cursor-pointer"
        data-test="gallery-photo"
        @click="viewing = ph"
      />
    </div>
    <PhotoViewer :photo="viewing" @close="viewing = null" @save-to-pool="setSaved" @delete="remove" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import PhotoViewer from '@/components/PhotoViewer.vue';
import { useDataStore } from '@/stores/data';
import { thumbUrl } from '@/lib/photos';
import type { Photo } from '@/lib/types';

const props = defineProps<{ poolId: string }>();
const data = useDataStore();
const photos = ref<Photo[]>([]);
const viewing = ref<Photo | null>(null);

async function load() {
  photos.value = await data.listPhotos({ poolId: props.poolId, savedToPool: true }).catch(() => []);
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
onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.gallery {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
</style>
