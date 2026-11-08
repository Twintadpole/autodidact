<template>
  <q-page class="q-pa-md column q-gutter-md" style="padding-bottom: 96px">
    <div v-if="!pool" class="flex flex-center q-pa-xl">
      <q-spinner v-if="data.loading || !data.loaded" size="40px" color="primary" />
      <div v-else class="text-grey-7">Pool not found.</div>
    </div>

    <template v-else>
      <!-- Header: quick links, access notes, pinned notes -->
      <div class="row q-col-gutter-sm">
        <div class="col-6">
          <q-btn class="full-width" outline color="primary" icon="info" label="Overview" no-caps :to="`/pools/${pool._id}/overview`" data-test="open-overview" />
        </div>
        <div class="col-6">
          <q-btn class="full-width" outline color="orange-9" icon="report_problem" no-caps :label="`Issues (${openIssues.length})`" :to="`/pools/${pool._id}/issues`" data-test="open-issues" />
        </div>
      </div>

      <q-banner v-if="pool.accessNotes || pinnedNotes.length" rounded class="bg-amber-1 text-grey-9" data-test="access-notes">
        <template #avatar><q-icon name="key" color="amber-9" /></template>
        <div v-if="pool.accessNotes" class="text-weight-medium">{{ pool.accessNotes }}</div>
        <div v-for="n in pinnedNotes" :key="n._id" class="text-body2"><q-icon name="push_pin" size="xs" /> {{ n.body }}</div>
      </q-banner>

      <q-card flat bordered>
        <q-item tag="label" class="q-py-md">
          <q-item-section>
            <q-item-label class="text-weight-medium">Done this week</q-item-label>
            <q-item-label caption>Same checkmark as the Route list</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-toggle :model-value="pool.week.done" color="positive" size="lg" data-test="done-toggle" @update:model-value="toggleDone" />
          </q-item-section>
        </q-item>
      </q-card>

      <div v-if="loadingVisits" class="flex flex-center q-pa-lg"><q-spinner size="32px" color="primary" /></div>
      <template v-else-if="draft">
        <!-- Time on site -->
        <VisitTimer
          :time-log="draft.timeLog!"
          :busy="saving"
          @action="onTimer"
          @edit="timeEditOpen = true"
          @history="historyOpen = true"
        />

        <!-- Current visit (editable) -->
        <VisitCard :visit="draft" :title="editingExisting ? 'Today’s visit (saved)' : 'This visit'" />

        <!-- Previous visit (read-only) -->
        <VisitCard v-if="previous" :visit="previous" readonly title="Previous visit">
          <template #dose-actions>
            <q-btn
              v-if="previous.doses.length"
              flat
              dense
              no-caps
              color="primary"
              icon="content_copy"
              label="Same as last time"
              data-test="same-as-last"
              @click="copyDoses"
            />
          </template>
        </VisitCard>
        <q-card v-else flat bordered class="q-pa-md text-grey-7 text-center" data-test="no-previous">No previous visit yet.</q-card>
      </template>

      <q-btn outline color="orange-9" icon="add_alert" label="Add issue" no-caps data-test="add-issue" @click="issueOpen = true" />

      <!-- Sticky save -->
      <q-page-sticky position="bottom" expand class="save-bar">
        <div class="full-width q-pa-sm bg-white save-bar-inner">
          <q-btn
            color="primary"
            unelevated
            size="lg"
            class="full-width"
            icon="save"
            :label="dirty ? 'Save visit' : editingExisting ? 'Saved' : 'Nothing to save yet'"
            :disable="!dirty || !hasContent"
            :loading="saving"
            data-test="save-visit"
            @click="save('manual')"
          />
        </div>
      </q-page-sticky>

      <IssueSheet v-model="issueOpen" :pool-id="pool._id" @saved="onIssueSaved" />
      <TimeEditDialog v-if="draft" v-model="timeEditOpen" :time-log="draft.timeLog!" @save="onTimesEdited" />
      <HistoryDialog v-if="draft" v-model="historyOpen" collection="visits" :doc-id="draft._id" title="Visit history" />
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute } from 'vue-router';
import { useQuasar } from 'quasar';
import { isToday, parseISO } from 'date-fns';
import VisitCard from '@/components/VisitCard.vue';
import IssueSheet from '@/components/IssueSheet.vue';
import VisitTimer, { type TimerAction } from '@/components/VisitTimer.vue';
import TimeEditDialog from '@/components/TimeEditDialog.vue';
import HistoryDialog from '@/components/HistoryDialog.vue';
import { normalizeVisit, useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { useSyncStore } from '@/stores/sync';
import { db } from '@/offline/db';
import { errorMessage } from '@/stores/api';
import { clone, newId } from '@/lib/format';
import type { Note, TimeLog, Visit } from '@/lib/types';

defineOptions({ name: 'VisitPage' });

const $q = useQuasar();
const route = useRoute();
const data = useDataStore();
const ui = useUiStore();
const sync = useSyncStore();

const poolId = computed(() => String(route.params.id));
const pool = computed(() => data.poolById.get(poolId.value));
const customer = computed(() => (pool.value ? data.customerById.get(pool.value.customerId) : undefined));
const openIssues = computed(() => data.openIssues.filter((i) => i.poolId === poolId.value && i.status !== 'postponed'));

const draft = ref<Visit | null>(null);
const previous = ref<Visit | null>(null);
const editingExisting = ref(false);
const savedSnapshot = ref('');
const loadingVisits = ref(true);
const saving = ref(false);
const issueOpen = ref(false);
const timeEditOpen = ref(false);
const historyOpen = ref(false);
const pinnedNotes = ref<Note[]>([]);

const snapshot = (v: Visit | null) => (v ? JSON.stringify({ r: v.readings, d: v.doses, t: v.tasks, n: v.notes ?? '', tl: v.timeLog }) : '');
const dirty = computed(() => !!draft.value && snapshot(draft.value) !== savedSnapshot.value);
const hasContent = computed(() => {
  const v = draft.value;
  if (!v) return false;
  return (
    Object.values(v.readings).some((x) => x !== null && x !== undefined) ||
    v.doses.length > 0 ||
    Object.values(v.tasks).some(Boolean) ||
    !!v.notes?.trim() ||
    !!v.timeLog?.segments.length
  );
});

function blankVisit(): Visit {
  const now = new Date().toISOString();
  return {
    _id: newId(),
    poolId: poolId.value,
    visitedAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    readings: {},
    doses: [],
    tasks: { brushed: false, skimmed: false, vacuumed: false, basketsEmptied: false, filterCleaned: false },
    notes: '',
    timeLog: { segments: [], finished: false },
  };
}

async function load() {
  loadingVisits.value = true;
  try {
    const [visits, notes] = await Promise.all([data.recentVisits(poolId.value, 2), data.notesFor('pool', poolId.value)]);
    pinnedNotes.value = notes.filter((n) => n.pinned);
    const latest = visits[0];
    if (latest && isToday(parseISO(latest.visitedAt))) {
      // Coming back to today's visit: keep editing it instead of starting a second one.
      draft.value = clone(latest);
      draft.value.notes ??= '';
      draft.value.timeLog ??= { segments: [], finished: false };
      previous.value = visits[1] ?? null;
      editingExisting.value = true;
    } else {
      draft.value = blankVisit();
      previous.value = latest ?? null;
      editingExisting.value = false;
    }
    savedSnapshot.value = snapshot(draft.value);
    // Unsaved edits from before (app closed, crash, battery): pick up where you left off.
    const kept = await db.drafts.get(poolId.value);
    if (kept && isToday(parseISO(kept.visit.visitedAt)) && (!editingExisting.value || kept.visit._id === draft.value._id)) {
      draft.value = normalizeVisit(kept.visit);
      draft.value.notes ??= '';
      $q.notify({ message: 'Restored your unsaved changes', color: 'grey-8', timeout: 1500 });
    } else if (kept) {
      await db.drafts.delete(poolId.value);
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    loadingVisits.value = false;
  }
}

function copyDoses() {
  if (!draft.value || !previous.value) return;
  draft.value.doses = previous.value.doses.map((d) => ({ ...d }));
  $q.notify({ message: 'Copied last visit’s doses', color: 'grey-8', timeout: 1500 });
}

/** Pause any timer running at another pool (one timer at a time). Returns false if the user cancels. */
async function pauseOtherTimers(): Promise<boolean> {
  const others = data.activeTimers.filter((v) => v._id !== draft.value?._id);
  if (!others.length) return true;
  const names = others
    .map((v) => {
      const p = data.poolById.get(v.poolId);
      return p ? data.customerById.get(p.customerId)?.name ?? p.name : 'another pool';
    })
    .join(', ');
  const go = await new Promise<boolean>((resolve) =>
    $q
      .dialog({ title: 'Timer running elsewhere', message: `The timer at ${names} is still running. Pause it and start here?`, cancel: true, ok: { label: 'Pause it', unelevated: true } })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false))
      .onDismiss(() => resolve(false)),
  );
  if (!go) return false;
  const now = new Date().toISOString();
  for (const v of others) {
    const copy = clone(v);
    const last = copy.timeLog?.segments[copy.timeLog.segments.length - 1];
    if (last && !last.end) last.end = now;
    copy.updatedAt = now;
    await data.saveVisit(copy);
  }
  return true;
}

async function onTimer(action: TimerAction) {
  const v = draft.value;
  if (!v?.timeLog) return;
  const tl = v.timeLog;
  const now = new Date().toISOString();
  const last = tl.segments[tl.segments.length - 1];
  if (action === 'start' || action === 'resume') {
    if (!(await pauseOtherTimers())) return;
    tl.finished = false;
    tl.segments.push({ start: now, end: null });
  } else if (action === 'pause') {
    if (last && !last.end) last.end = now;
  } else if (action === 'stop') {
    if (last && !last.end) last.end = now;
    tl.finished = true;
  }
  await save(action);
}

async function onTimesEdited(timeLog: TimeLog) {
  if (!draft.value) return;
  draft.value.timeLog = timeLog;
  await save('times');
}

async function save(reason: 'manual' | 'auto' | TimerAction | 'times' = 'manual'): Promise<boolean> {
  const v = draft.value;
  if (!v) return true;
  const invalidDose = v.doses.find((d) => !d.chemicalId || !(d.amount > 0));
  if (invalidDose) {
    $q.notify({ type: 'warning', message: 'Each dose needs a chemical and an amount above 0.' });
    return false;
  }
  saving.value = true;
  try {
    const readings = Object.fromEntries(Object.entries(v.readings).filter(([, x]) => x !== null && x !== undefined && !Number.isNaN(x)));
    const body: Visit = { ...v, readings, updatedAt: new Date().toISOString() };
    if (!body.notes?.trim()) delete body.notes;
    await data.saveVisit(body);
    v.updatedAt = body.updatedAt;
    savedSnapshot.value = snapshot(v);
    editingExisting.value = true;
    const offline = !sync.online || !sync.reachable;
    const messages: Record<string, string> = {
      manual: offline ? 'Saved on phone · uploads when there’s signal' : 'Visit saved',
      auto: offline ? 'Visit saved on phone' : 'Visit saved',
      start: 'Timer started',
      resume: 'Timer resumed',
      pause: 'Timer paused',
      stop: 'Timer stopped',
      times: 'Times updated',
    };
    $q.notify({ type: 'positive', message: messages[reason] ?? 'Saved', timeout: 1200 });
    return true;
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
    return false;
  } finally {
    saving.value = false;
  }
}

async function toggleDone(done: boolean) {
  try {
    await data.setDone(poolId.value, done);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}

function onIssueSaved() {
  $q.notify({ type: 'positive', message: 'Issue added', timeout: 1500 });
}

// Leaving the screen saves the visit (on the phone first; it uploads when there's signal).
onBeforeRouteLeave(async () => {
  if (dirty.value && hasContent.value) await save('auto');
  return true;
});

// Every change is kept on the phone as a draft (300 ms after the last keystroke), so
// closing the app or a crash loses nothing. Going to the background saves the visit.
let draftTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  draft,
  (v) => {
    clearTimeout(draftTimer);
    if (!v || !dirty.value) return;
    draftTimer = setTimeout(() => void db.drafts.put({ poolId: v.poolId, visit: clone(v), savedAt: new Date().toISOString() }), 300);
  },
  { deep: true },
);
function onHidden() {
  if (document.visibilityState === 'hidden' && dirty.value && hasContent.value) void save('auto');
}
onMounted(() => document.addEventListener('visibilitychange', onHidden));
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onHidden);
  clearTimeout(draftTimer);
});

watch(
  [pool, customer],
  () => {
    if (pool.value) ui.setTitle(customer.value?.name ?? 'Pool', pool.value.name);
  },
  { immediate: true },
);

onMounted(load);

/**
 * When a sync brings new data (e.g. the first download on a new phone), refresh
 * the previous-visit card and pinned notes. The visit being edited is left alone.
 */
watch(
  () => data.version,
  async () => {
    if (loadingVisits.value || !draft.value) return;
    const [visits, notes] = await Promise.all([data.recentVisits(poolId.value, 3), data.notesFor('pool', poolId.value)]);
    pinnedNotes.value = notes.filter((n) => n.pinned);
    previous.value = visits.find((v) => v._id !== draft.value!._id && !isToday(parseISO(v.visitedAt))) ?? previous.value;
  },
);
</script>

<style scoped>
.save-bar {
  z-index: 10;
}
.save-bar-inner {
  border-top: 1px solid rgba(0, 0, 0, 0.12);
}
</style>
