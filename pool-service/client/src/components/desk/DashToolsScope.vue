<template>
  <slot />
</template>

<script setup lang="ts">
import { provideDashTools, type DashTools } from '@/composables/useDashTools';

/** Gives the card inside it these full-screen tools (and only that card). */
const props = defineProps<{ tools: DashTools }>();
provideDashTools(props.tools);
</script>
