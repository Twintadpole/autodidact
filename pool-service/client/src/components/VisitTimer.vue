<template>
  <q-card flat bordered data-test="visit-timer">
    <q-card-section class="row items-center no-wrap q-py-sm">
      <q-icon name="timer" size="28px" :color="state === 'running' ? 'positive' : 'grey-7'" class="q-mr-sm" />
      <div class="col">
        <div class="text-h5 text-weight-medium timer-digits" data-test="timer-elapsed">{{ hms(seconds) }}</div>
        <div class="text-caption text-grey-7" data-test="timer-state">{{ stateLabel }}</div>
      </div>
      <q-btn flat round dense icon="edit_calendar" aria-label="Edit times" :disable="!timeLog.segments.length || busy" data-test="timer-edit" @click="emit('edit')" />
      <q-btn flat round dense icon="history" aria-label="Change history" data-test="timer-history" @click="emit('history')" />
    </q-card-section>
    <q-card-actions class="q-pt-none q-px-md q-pb-md row q-col-gutter-sm">
      <div v-if="state === 'idle'" class="col-12">
        <q-btn class="full-width" color="positive" unelevated size="lg" icon="play_arrow" label="Start" :loading="busy" data-test="timer-start" @click="emit('action', 'start')" />
      </div>
      <template v-else-if="state === 'running'">
        <div class="col-6"><q-btn class="full-width" color="orange-8" unelevated size="lg" icon="pause" label="Pause" :loading="busy" data-test="timer-pause" @click="emit('action', 'pause')" /></div>
        <div class="col-6"><q-btn class="full-width" color="negative" unelevated size="lg" icon="stop" label="Stop" :loading="busy" data-test="timer-stop" @click="emit('action', 'stop')" /></div>
      </template>
      <template v-else-if="state === 'paused'">
        <div class="col-6"><q-btn class="full-width" color="positive" unelevated size="lg" icon="play_arrow" label="Resume" :loading="busy" data-test="timer-resume" @click="emit('action', 'resume')" /></div>
        <div class="col-6"><q-btn class="full-width" color="negative" unelevated size="lg" icon="stop" label="Stop" :loading="busy" data-test="timer-stop" @click="emit('action', 'stop')" /></div>
      </template>
      <div v-else class="col-12">
        <q-btn class="full-width" outline color="primary" icon="play_arrow" label="Resume work" :loading="busy" data-test="timer-reopen" @click="emit('action', 'resume')" />
      </div>
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { timeLogSeconds, timeLogState } from '@pool/shared';
import { clock, hms } from '@/lib/time';
import type { TimeLog } from '@/lib/types';

export type TimerAction = 'start' | 'pause' | 'resume' | 'stop';

const props = defineProps<{ timeLog: TimeLog; busy?: boolean }>();
const emit = defineEmits<{ action: [TimerAction]; edit: []; history: [] }>();

const now = ref(new Date());
let tick: ReturnType<typeof setInterval> | undefined;
onMounted(() => (tick = setInterval(() => (now.value = new Date()), 1000)));
onBeforeUnmount(() => clearInterval(tick));

const state = computed(() => timeLogState(props.timeLog));
const seconds = computed(() => timeLogSeconds(props.timeLog, now.value));
const stateLabel = computed(() => {
  const segs = props.timeLog.segments;
  const first = segs[0];
  const last = segs[segs.length - 1];
  const pauses = Math.max(0, segs.length - 1);
  const pauseText = pauses ? ` · ${pauses} pause${pauses > 1 ? 's' : ''}` : '';
  switch (state.value) {
    case 'idle':
      return 'Not started';
    case 'running':
      return `Started ${clock(first?.start)}${pauseText}`;
    case 'paused':
      return `Paused at ${clock(last?.end)}${pauseText}`;
    default:
      return `${clock(first?.start)} – ${clock(last?.end)}${pauseText}`;
  }
});
</script>

<style scoped>
.timer-digits {
  font-variant-numeric: tabular-nums;
}
</style>
