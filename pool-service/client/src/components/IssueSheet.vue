<template>
  <q-dialog :model-value="modelValue" position="bottom" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <q-card class="full-width issue-sheet" data-test="issue-sheet">
      <q-form @submit.prevent="save">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">{{ issue ? 'Issue' : 'New issue' }}</div>
          <q-space />
          <q-chip v-if="issue" dense :color="statusColor" text-color="white" data-test="issue-status-chip">{{ statusLabel }}</q-chip>
          <q-btn flat round dense icon="close" v-close-popup />
        </q-card-section>

        <q-card-section class="q-gutter-sm">
          <div v-if="poolLabel" class="text-caption text-grey-7">{{ poolLabel }}</div>
          <q-input v-model="form.title" label="Title" outlined autofocus :rules="[(v) => !!v?.trim() || 'Required']" data-test="issue-title" />
          <q-input v-model="form.description" label="Details" type="textarea" autogrow outlined data-test="issue-description" />
          <div class="row">
            <q-toggle v-model="form.urgent" label="Urgent" color="negative" class="col-6" data-test="issue-urgent" />
            <q-toggle v-model="form.important" label="Important" color="orange-8" class="col-6" data-test="issue-important" />
          </div>
          <div class="text-caption text-grey-7">{{ quadrantLabel }}</div>
          <q-select
            v-if="issue"
            v-model="form.status"
            :options="statusOptions"
            emit-value
            map-options
            outlined
            dense
            label="Status"
            data-test="issue-status"
          />
        </q-card-section>

        <q-card-actions class="q-px-md q-pb-md column q-gutter-sm items-stretch">
          <q-btn type="submit" color="primary" unelevated size="lg" :label="issue ? 'Save' : 'Add issue'" :loading="busy" data-test="issue-save" />
          <div v-if="issue" class="row q-col-gutter-sm">
            <div v-if="issue.status !== 'resolved'" class="col-6">
              <q-btn class="full-width" color="positive" outline icon="task_alt" label="Completed" :disable="busy" data-test="issue-complete" @click="quick('resolved')" />
            </div>
            <div v-if="issue.status !== 'postponed' && issue.status !== 'resolved'" class="col-6">
              <q-btn class="full-width" color="grey-8" outline icon="schedule" label="Postpone" :disable="busy" data-test="issue-postpone" @click="quick('postponed')" />
            </div>
            <div v-if="issue.status === 'resolved' || issue.status === 'postponed'" class="col-6">
              <q-btn class="full-width" color="primary" outline icon="replay" label="Reopen" :disable="busy" data-test="issue-reopen" @click="quick('open')" />
            </div>
          </div>
        </q-card-actions>
      </q-form>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { deriveQuadrant, QUADRANTS, type IssueStatus } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import type { Issue } from '@/lib/types';

const props = defineProps<{ modelValue: boolean; issue?: Issue | null; poolId: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [Issue] }>();

const $q = useQuasar();
const data = useDataStore();
const busy = ref(false);

const STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  postponed: 'Postponed',
  resolved: 'Completed',
};
const statusOptions = (Object.keys(STATUS_LABELS) as IssueStatus[]).map((s) => ({ label: STATUS_LABELS[s], value: s }));

const form = reactive({ title: '', description: '', urgent: false, important: false, status: 'open' as IssueStatus });

watch(
  () => [props.modelValue, props.issue] as const,
  ([open, issue]) => {
    if (!open) return;
    form.title = issue?.title ?? '';
    form.description = issue?.description ?? '';
    form.urgent = issue?.urgent ?? false;
    form.important = issue?.important ?? false;
    form.status = issue?.status ?? 'open';
  },
  { immediate: true },
);

const statusLabel = computed(() => (props.issue ? STATUS_LABELS[props.issue.status] : ''));
const statusColor = computed(() =>
  props.issue?.status === 'resolved' ? 'positive' : props.issue?.status === 'postponed' ? 'grey-7' : 'primary',
);
const quadrantLabel = computed(() => {
  const q = QUADRANTS.find((x) => x.key === deriveQuadrant(form));
  return `Goes in: ${q?.label}`;
});
const poolLabel = computed(() => {
  const pool = data.poolById.get(props.poolId);
  if (!pool) return '';
  return `${data.customerById.get(pool.customerId)?.name ?? ''} · ${pool.name}`;
});

async function persist(body: Partial<Issue>) {
  busy.value = true;
  try {
    const saved = await data.saveIssue(props.issue?._id ?? null, props.issue ? body : { poolId: props.poolId, ...body });
    emit('saved', saved);
    emit('update:modelValue', false);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}

function save() {
  if (!form.title.trim()) return;
  const body: Partial<Issue> = {
    title: form.title.trim(),
    urgent: form.urgent,
    important: form.important,
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(props.issue ? { status: form.status } : {}),
  };
  void persist(body);
}

function quick(status: IssueStatus) {
  void persist({ status });
}
</script>

<style scoped>
.issue-sheet {
  max-width: 600px;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
}
</style>
