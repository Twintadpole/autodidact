<template>
  <img v-if="src" :src="src" alt="Photo" loading="lazy" decoding="async" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { db } from '@/offline/db';
import { photoUrl, thumbUrl } from '@/lib/photos';

/**
 * A plain <img> for a photo: from the phone's own storage while it is still
 * waiting to upload, otherwise from the server (thumbnails are cached for
 * offline use). Sizing is up to the parent (see PhotoGrid).
 */
const props = defineProps<{ photoId: string; thumb?: boolean }>();

const src = ref('');
let objectUrl = '';

async function resolve() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = '';
  const local = await db.photoBlobs.get(props.photoId);
  if (local) {
    objectUrl = URL.createObjectURL(local.blob);
    src.value = objectUrl;
  } else {
    src.value = props.thumb ? thumbUrl(props.photoId) : photoUrl(props.photoId);
  }
}

watch(() => [props.photoId, props.thumb], resolve, { immediate: true });
onBeforeUnmount(() => objectUrl && URL.revokeObjectURL(objectUrl));
</script>
