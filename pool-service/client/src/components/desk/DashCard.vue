<template>
  <q-card flat bordered class="dash-card column no-wrap" :class="{ dragging }" :data-test="`card-${id}`">
    <!-- Title bar: drag it to move the card -->
    <div
      class="dash-head row items-center no-wrap q-pl-sm"
      :draggable="draggable"
      :title="draggable ? 'Drag to move' : undefined"
      @dragstart="onDragStart"
      @dragend="dragging = false"
    >
      <q-icon v-if="draggable" name="drag_indicator" color="grey-5" class="drag-handle" />
      <q-icon :name="icon" color="grey-7" class="q-ml-xs" />
      <div class="text-subtitle2 ellipsis q-ml-sm col">{{ title }}</div>
      <slot name="head" />
      <template v-if="!fullscreen">
        <q-btn flat round dense size="sm" icon="photo_size_select_large" aria-label="Card size and position" :data-test="`card-size-${id}`">
          <q-menu auto-close>
            <q-list dense style="min-width: 150px">
              <q-item v-for="s in CARD_SIZES" :key="s" clickable :active="s === size" :data-test="`size-${id}-${s}`" @click="emit('size', s)">
                <q-item-section>{{ SIZE_LABEL[s] }}</q-item-section>
              </q-item>
              <q-separator />
              <q-item clickable :data-test="`move-${id}-up`" @click="emit('move', -1)"><q-item-section>Move earlier</q-item-section></q-item>
              <q-item clickable :data-test="`move-${id}-down`" @click="emit('move', 1)"><q-item-section>Move later</q-item-section></q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <q-btn flat round dense size="sm" icon="open_in_full" aria-label="Full screen" :data-test="`card-full-${id}`" @click="emit('fullscreen')" />
        <q-btn flat round dense size="sm" icon="visibility_off" aria-label="Hide card" :data-test="`card-hide-${id}`" @click="emit('hide')" />
      </template>
    </div>
    <q-separator />
    <!-- Body: its real size decides how much the card shows -->
    <div ref="body" class="dash-body col">
      <slot v-if="box.width" :mode="mode" :width="box.width" :height="box.height" />
    </div>
  </q-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { CARD_SIZES, type CardSize } from '@pool/shared';
import { cardMode, SIZE_LABEL } from '@/lib/dashboard';

const props = withDefaults(defineProps<{ id: string; title: string; icon: string; size: CardSize; fullscreen?: boolean; draggable?: boolean }>(), { fullscreen: false, draggable: true });
const emit = defineEmits<{ size: [s: CardSize]; hide: []; fullscreen: []; dragstart: []; move: [by: number] }>();

const body = ref<HTMLDivElement | null>(null);
const box = reactive({ width: 0, height: 0 });
const mode = computed(() => (props.fullscreen ? 'l' : cardMode(box.width, box.height)));
let ro: ResizeObserver | undefined;
onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    box.width = Math.round(e!.contentRect.width);
    box.height = Math.round(e!.contentRect.height);
  });
  ro.observe(body.value!);
});
onBeforeUnmount(() => ro?.disconnect());

const dragging = ref(false);
function onDragStart(e: DragEvent) {
  dragging.value = true;
  e.dataTransfer?.setData('text/plain', props.id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  emit('dragstart');
}
</script>

<style scoped>
.dash-card {
  height: 100%;
  min-width: 0;
  background: #fcfcfb;
}
.dash-head {
  min-height: 38px;
  cursor: grab;
}
.dash-head:active {
  cursor: grabbing;
}
.dash-body {
  position: relative;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
}
.dragging {
  opacity: 0.45;
}
</style>
