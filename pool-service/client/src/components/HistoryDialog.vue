<template>
  <q-dialog :model-value="modelValue" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <q-card style="width: 100%; max-width: 520px" data-test="history-dialog">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">{{ title }}</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup />
      </q-card-section>
      <q-card-section>
        <div v-if="loading" class="flex flex-center q-pa-md"><q-spinner color="primary" /></div>
        <div v-else-if="!entries.length" class="text-grey-7">No changes recorded yet.</div>
        <q-timeline v-else color="primary" layout="dense">
          <q-timeline-entry v-for="e in entries" :key="e._id" :subtitle="when(e.at)" :icon="ICON[e.action]" data-test="history-entry">
            <div class="text-weight-medium">{{ ACTION[e.action] }} <span class="text-caption text-grey-7">· {{ e.source === 'sync' ? 'from the phone' : 'in the app' }}</span></div>
            <div v-if="e.note" class="text-body2">{{ e.note }}</div>
            <div v-for="(c, i) in e.changes" :key="i" class="text-body2">
              <span class="text-grey-8">{{ label(c.path) }}:</span> {{ show(c.path, c.from) }} → <b>{{ show(c.path, c.to) }}</b>
            </div>
          </q-timeline-entry>
        </q-timeline>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { format, parseISO } from 'date-fns';
import { READINGS } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { clock } from '@/lib/time';
import type { AuditEntry, TimeSegment } from '@/lib/types';

const props = defineProps<{ modelValue: boolean; collection: string; docId: string; title?: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const data = useDataStore();
const entries = ref<AuditEntry[]>([]);
const loading = ref(false);

const ACTION = { create: 'Created', update: 'Changed', delete: 'Deleted', bulk: 'Bulk change' } as const;
const ICON = { create: 'add', update: 'edit', delete: 'delete', bulk: 'done_all' } as const;
const LABELS: Record<string, string> = {
  'timeLog.segments': 'Times',
  'timeLog.finished': 'Timer stopped',
  notes: 'Note',
  doses: 'Doses',
  visitedAt: 'Visit date',
  ...Object.fromEntries(READINGS.map((r) => [`readings.${r.key}`, r.label])),
};

const when = (iso: string) => format(parseISO(iso), 'MMM d, h:mm:ss a');
const label = (path: string) => LABELS[path] ?? path.replace(/^tasks\./, '').replace(/\./g, ' › ');

function show(path: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '–';
  if (path === 'timeLog.segments' && Array.isArray(v)) {
    return (v as TimeSegment[]).map((s) => `${clock(s.start)}–${s.end ? clock(s.end) : 'running'}`).join(', ') || 'none';
  }
  if (path === 'doses' && Array.isArray(v)) {
    return (v as { chemicalId: string; amount: number; unit: string }[])
      .map((d) => `${data.chemicalById.get(d.chemicalId)?.name ?? '?'} ${d.amount} ${d.unit}`)
      .join(', ') || 'none';
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return format(parseISO(v), 'MMM d, h:mm a');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    loading.value = true;
    try {
      entries.value = await data.history(props.collection, props.docId);
    } finally {
      loading.value = false;
    }
  },
);
</script>
