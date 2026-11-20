<template>
  <q-dialog :model-value="modelValue" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <q-card style="width: 100%; max-width: 480px" data-test="time-edit">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">Edit times</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup />
      </q-card-section>
      <q-card-section class="text-caption text-grey-7 q-pb-sm">
        Each row is a stretch of work; gaps between rows are pauses. Every change is kept in the visit's history.
      </q-card-section>
      <q-card-section class="q-gutter-sm q-pt-none">
        <div v-for="(seg, i) in rows" :key="i" class="row no-wrap items-center q-gutter-x-sm" data-test="time-row">
          <q-input v-model="seg.start" type="datetime-local" dense outlined label="Start" class="col" :data-test="`time-start-${i}`" />
          <q-input v-model="seg.end" type="datetime-local" dense outlined :label="i === rows.length - 1 ? 'End (blank = running)' : 'End'" class="col" :data-test="`time-end-${i}`" />
          <q-btn flat round dense icon="delete" color="grey-7" aria-label="Remove" @click="rows.splice(i, 1)" />
        </div>
        <q-btn flat dense no-caps color="primary" icon="add" label="Add a time block" @click="addRow" />
        <q-banner v-if="error" dense class="bg-red-1 text-negative" data-test="time-error">{{ error }}</q-banner>
        <div class="text-body2">Total: <b>{{ totalLabel }}</b></div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" v-close-popup />
        <q-btn color="primary" unelevated label="Save times" data-test="time-save" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { timeLogSchema, timeLogSeconds } from '@pool/shared';
import { fromLocalInput, humanDuration, toLocalInput } from '@/lib/time';
import type { TimeLog } from '@/lib/types';

const props = defineProps<{ modelValue: boolean; timeLog: TimeLog }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; save: [TimeLog] }>();

const rows = ref<{ start: string; end: string }[]>([]);
const error = ref('');

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    error.value = '';
    rows.value = props.timeLog.segments.map((s) => ({ start: toLocalInput(s.start), end: toLocalInput(s.end) }));
  },
);

const parsed = computed(() =>
  rows.value.map((r) => ({ start: fromLocalInput(r.start), end: fromLocalInput(r.end) })),
);
const totalLabel = computed(() =>
  humanDuration(timeLogSeconds({ segments: parsed.value.filter((s): s is { start: string; end: string | null } => !!s.start) })),
);

function addRow() {
  const last = rows.value[rows.value.length - 1];
  const start = last?.end || last?.start || toLocalInput(new Date().toISOString());
  rows.value.push({ start, end: start });
}

function save() {
  error.value = '';
  if (parsed.value.some((s) => !s.start)) {
    error.value = 'Every row needs a start time.';
    return;
  }
  const anyRunning = parsed.value.some((s) => !s.end);
  const candidate = { segments: parsed.value, finished: props.timeLog.finished && !anyRunning };
  const result = timeLogSchema.safeParse(candidate);
  if (!result.success) {
    error.value = result.error.issues[0]?.message ?? 'These times don’t add up.';
    return;
  }
  emit('save', {
    finished: candidate.finished,
    segments: result.data.segments.map((s) => ({ start: s.start.toISOString(), end: s.end ? s.end.toISOString() : null })),
  });
  emit('update:modelValue', false);
}
</script>
