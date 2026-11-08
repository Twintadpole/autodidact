<template>
  <div class="photo-grid" :class="`photo-grid--${size}`" data-test="photo-grid">
    <div v-for="ph in photos" :key="ph._id" class="tile">
      <button type="button" class="tile-img" :aria-label="`Open photo`" data-test="photo-tile" @click.stop="emit('open', ph)">
        <PhotoImg :photo-id="ph._id" thumb />
      </button>
      <slot name="below" :photo="ph" />
    </div>
    <div v-for="n in pending" :key="`pending-${n}`" class="tile">
      <div class="tile-img tile-pending"><q-spinner color="primary" size="24px" /></div>
    </div>
    <div v-if="more" class="tile">
      <div class="tile-img tile-more">+{{ more }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import PhotoImg from '@/components/PhotoImg.vue';
import type { Photo } from '@/lib/types';

/**
 * Square photo tiles in a tidy grid. size "md" = 3 per row (galleries, issue
 * sheet); "sm" = small inline strip (issue lists).
 */
withDefaults(defineProps<{ photos: Photo[]; size?: 'sm' | 'md'; pending?: number; more?: number }>(), { size: 'md', pending: 0, more: 0 });
const emit = defineEmits<{ open: [Photo] }>();
</script>

<style scoped>
.photo-grid {
  display: grid;
  gap: 8px;
}
.photo-grid--md {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.photo-grid--sm {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.photo-grid--sm .tile {
  width: 52px;
  flex: 0 0 52px;
}
.tile {
  min-width: 0;
}
.tile-img {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  padding: 0;
  border: 0;
  border-radius: 8px;
  overflow: hidden;
  background: #eceff1;
  cursor: pointer;
}
.tile-img :deep(img) {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tile-pending,
.tile-more {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}
.tile-more {
  font-weight: 600;
  color: #455a64;
}
.photo-grid--sm .tile-img {
  border-radius: 6px;
}
</style>
