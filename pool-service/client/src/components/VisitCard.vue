<template>
  <q-card flat bordered :class="readonly ? 'visit-card--previous' : 'visit-card--current'" :data-test="readonly ? 'previous-visit' : 'current-visit'">
    <q-card-section class="row items-center justify-between q-pb-sm">
      <div>
        <div class="text-subtitle1 text-weight-medium">{{ title }}</div>
        <div class="text-caption text-grey-7">{{ dateLabel }}</div>
        <div v-if="readonly && timeSummary" class="text-body2 text-grey-8" data-test="prev-duration">
          <q-icon name="timer" class="q-mr-xs" />{{ timeSummary }}
        </div>
      </div>
      <slot name="actions" />
    </q-card-section>

    <!-- Readings -->
    <q-card-section class="q-pt-none">
      <div class="text-overline text-grey-7">Readings</div>
      <div class="readings-grid">
        <template v-for="r in readings" :key="r.key">
          <div v-if="!readonly" class="reading-cell">
            <q-input
              :model-value="visit.readings[r.key] ?? null"
              type="number"
              inputmode="decimal"
              :step="r.step"
              :label="r.short"
              :suffix="r.unit"
              dense
              outlined
              hide-bottom-space
              :bg-color="bg(r.key)"
              :data-test="`reading-${r.key}`"
              @update:model-value="(v) => setReading(r.key, v)"
            />
          </div>
          <div v-else class="reading-cell reading-ro" :class="`reading-${status(r.key)}`" :data-test="`prev-reading-${r.key}`">
            <div class="text-caption text-grey-7">{{ r.short }}</div>
            <div class="text-body1 text-weight-medium">
              {{ fmtNumber(visit.readings[r.key]) }}<span v-if="visit.readings[r.key] != null && r.unit" class="text-caption text-grey-7"> {{ r.unit }}</span>
            </div>
          </div>
        </template>
      </div>
    </q-card-section>

    <!-- Doses -->
    <q-card-section class="q-pt-none">
      <div class="row items-center justify-between">
        <div class="text-overline text-grey-7">Doses</div>
        <slot name="dose-actions" />
      </div>
      <div v-if="readonly">
        <div v-if="!visit.doses.length" class="text-grey-6 text-body2">None</div>
        <div v-for="(d, i) in visit.doses" :key="i" class="row justify-between text-body2 q-py-xs" data-test="prev-dose">
          <span>{{ chemicalName(d.chemicalId) }}</span>
          <span class="text-weight-medium">{{ fmtNumber(d.amount) }} {{ d.unit }}</span>
        </div>
      </div>
      <div v-else class="column q-gutter-sm">
        <div v-for="(d, i) in visit.doses" :key="i" class="row no-wrap items-center q-gutter-x-sm" data-test="dose-row">
          <q-select
            :model-value="d.chemicalId"
            :options="chemicalOptions"
            emit-value
            map-options
            dense
            outlined
            label="Chemical"
            class="col"
            data-test="dose-chemical"
            @update:model-value="(id: string) => setChemical(i, id)"
          />
          <q-input v-model.number="d.amount" type="number" inputmode="decimal" dense outlined label="Amt" style="width: 74px" data-test="dose-amount" />
          <q-select v-model="d.unit" :options="UNITS as unknown as string[]" dense outlined style="width: 84px" data-test="dose-unit" />
          <q-btn flat round dense icon="close" aria-label="Remove dose" @click="visit.doses.splice(i, 1)" />
        </div>
        <q-btn flat no-caps color="primary" icon="add" label="Add dose" class="self-start" data-test="add-dose" @click="addDose" />
      </div>
    </q-card-section>

    <!-- Tasks + notes (current visit only) -->
    <template v-if="!readonly">
      <q-card-section class="q-pt-none">
        <div class="text-overline text-grey-7">Tasks</div>
        <div class="row">
          <q-checkbox v-for="t in EDIT_TASKS" :key="t.key" v-model="visit.tasks[t.key]" :label="t.label" class="col-6" :data-test="`task-${t.key}`" />
        </div>
      </q-card-section>
      <q-card-section class="q-pt-none">
        <q-input v-model="visit.notes" type="textarea" autogrow outlined label="Visit note" data-test="visit-note" />
      </q-card-section>
    </template>
    <template v-else>
      <q-card-section v-if="doneTasks.length" class="q-pt-none">
        <div class="text-overline text-grey-7">Tasks</div>
        <div class="row q-gutter-xs" data-test="prev-tasks">
          <q-chip v-for="t in doneTasks" :key="t" dense square icon="check" color="green-1" text-color="green-9" class="q-ml-none">{{ t }}</q-chip>
        </div>
      </q-card-section>
      <q-card-section v-if="visit.notes" class="q-pt-none text-body2 text-grey-8">
        <q-icon name="notes" class="q-mr-xs" />{{ visit.notes }}
      </q-card-section>
    </template>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { READINGS, rateReading, timeLogSeconds, UNITS, type ReadingKey, type Unit } from '@pool/shared';
import { clock, humanDuration } from '@/lib/time';
import { useDataStore } from '@/stores/data';
import { fmtNumber, longDate } from '@/lib/format';
import type { Tasks, Visit } from '@/lib/types';

const props = defineProps<{ visit: Visit; readonly?: boolean; title: string }>();

const data = useDataStore();
const readings = READINGS;

const TASKS: { key: keyof Tasks; label: string }[] = [
  { key: 'brushed', label: 'Brushed' },
  { key: 'skimmed', label: 'Skimmed' },
  { key: 'vacuumed', label: 'Vacuumed' },
  { key: 'skimmerBaskets', label: 'Skimmer baskets' },
  { key: 'pumpBasket', label: 'Pump basket' },
  { key: 'filterCleaned', label: 'Filter cleaned' },
  // Old combined task: shown on older visits only, not offered for new ones.
  { key: 'basketsEmptied', label: 'Baskets emptied' },
];
const EDIT_TASKS = TASKS.filter((t) => t.key !== 'basketsEmptied');

const dateLabel = computed(() => longDate(props.visit.visitedAt));
const doneTasks = computed(() => TASKS.filter((t) => props.visit.tasks?.[t.key]).map((t) => t.label));
/** "9:05 AM – 9:42 AM · 1 pause (5 min) · 32 min on site" */
const timeSummary = computed(() => {
  const segs = props.visit.timeLog?.segments ?? [];
  if (!segs.length) return '';
  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  const parts = [`${clock(first.start)} – ${last.end ? clock(last.end) : 'not stopped'}`];
  const gaps = segs.slice(1).map((s, i) => (new Date(s.start).getTime() - new Date(segs[i]!.end ?? s.start).getTime()) / 1000);
  if (gaps.length) {
    const total = gaps.reduce((a, b) => a + Math.max(0, b), 0);
    parts.push(`${gaps.length} pause${gaps.length > 1 ? 's' : ''} (${humanDuration(total)})`);
  }
  parts.push(`${humanDuration(timeLogSeconds(props.visit.timeLog))} on site`);
  return parts.join(' · ');
});

const chemicalOptions = computed(() => data.activeChemicals.map((c) => ({ label: c.name, value: c._id })));

function chemicalName(id: string) {
  return data.chemicalById.get(id)?.name ?? 'Unknown chemical';
}

function status(key: ReadingKey) {
  return rateReading(key, props.visit.readings[key] ?? null);
}

/** Amber / red tint for out-of-range values while typing. */
function bg(key: ReadingKey) {
  const s = status(key);
  return s === 'warn' ? 'amber-2' : s === 'bad' ? 'red-2' : undefined;
}

function setReading(key: string, v: string | number | null) {
  // eslint-disable-next-line vue/no-mutating-props -- the parent owns this draft object and passes it in for editing
  props.visit.readings[key] = v === '' || v === null ? null : Number(v);
}

function setChemical(i: number, id: string) {
  const dose = props.visit.doses[i];
  if (!dose) return;
  dose.chemicalId = id;
  const chem = data.chemicalById.get(id);
  if (chem) dose.unit = chem.defaultUnit;
}

function addDose() {
  const first = data.activeChemicals[0];
  // eslint-disable-next-line vue/no-mutating-props
  props.visit.doses.push({ chemicalId: first?._id ?? '', amount: 1, unit: (first?.defaultUnit ?? 'lb') as Unit });
}
</script>

<style scoped>
.readings-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.reading-ro {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  padding: 4px 8px;
}
.reading-warn {
  background: #fff3c4;
}
.reading-bad {
  background: #ffcdd2;
}
.visit-card--previous {
  background: #fafafa;
}
</style>
