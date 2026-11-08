<template>
  <img v-if="plain && src" :src="src" v-bind="$attrs" alt="Photo" />
  <q-img v-else-if="src" :src="src" :ratio="ratio" v-bind="$attrs" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { db } from '@/offline/db';
import { photoUrl, thumbUrl } from '@/lib/photos';

/**
 * Shows a photo from the phone's own storage while it is still waiting to
 * upload, otherwise from the server (thumbnails are cached for offline use).
 */
const props = defineProps<{ photoId: string; thumb?: boolean; ratio?: number; plain?: boolean }>();
defineOptions({ inheritAttrs: false });

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
