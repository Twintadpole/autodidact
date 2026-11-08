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

          <!-- Photos -->
          <div>
            <div class="text-caption text-grey-7 q-mb-xs">Photos</div>
            <PhotoGrid :photos="photos" :pending="uploading" data-test="issue-photos" @open="(ph) => (viewing = ph)">
              <template #below="{ photo: ph }">
                <q-checkbox
                  :model-value="ph.savedToPool"
                  dense
                  size="sm"
                  label="Save to pool"
                  class="text-caption q-mt-xs"
                  data-test="photo-save-to-pool"
                  @update:model-value="(v: boolean) => setSaved(ph, v)"
                />
              </template>
            </PhotoGrid>
            <div class="row q-gutter-sm q-mt-xs">
              <q-btn outline dense no-caps color="primary" icon="photo_camera" label="Camera" data-test="photo-camera" @click="cameraInput?.click()" />
              <q-btn outline dense no-caps color="primary" icon="photo_library" label="Gallery" data-test="photo-gallery" @click="galleryInput?.click()" />
            </div>
            <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onFiles" />
            <input ref="galleryInput" type="file" accept="image/*" multiple class="hidden" data-test="photo-input" @change="onFiles" />
          </div>
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
  <PhotoViewer :photo="viewing" @close="viewing = null" @save-to-pool="(v) => viewing && setSaved(viewing, v)" @delete="removePhoto" />
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { deriveQuadrant, QUADRANTS, type IssueStatus } from '@pool/shared';
import PhotoViewer from '@/components/PhotoViewer.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { compressPhoto } from '@/lib/photos';
import { reportClientProblem } from '@/stores/api';
import PhotoGrid from '@/components/PhotoGrid.vue';
import { newId } from '@/lib/format';
import type { Issue, Photo } from '@/lib/types';

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
const photos = ref<Photo[]>([]);
const uploading = ref(0);
const viewing = ref<Photo | null>(null);
const cameraInput = ref<HTMLInputElement | null>(null);
const galleryInput = ref<HTMLInputElement | null>(null);
/** A new issue gets its ID up front so photos can be attached before it is saved. */
const pendingId = ref(newId());
let savedNew = false;

const issueId = computed(() => props.issue?._id ?? pendingId.value);

async function onFiles(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length) return;
  for (const file of files) {
    uploading.value++;
    try {
      const { blob, width, height } = await compressPhoto(file);
      const photo = await data.uploadPhoto(blob, { poolId: props.poolId, issueId: issueId.value, width, height });
      photos.value.push(photo);
    } catch (err) {
      const message = errorMessage(err);
      $q.notify({ type: 'negative', message: `Photo not added: ${message}`, timeout: 0, actions: [{ label: 'OK', color: 'white' }] });
      void reportClientProblem('issue-photo', message, { name: file.name, type: file.type, size: file.size });
    } finally {
      uploading.value--;
    }
  }
}

async function setSaved(ph: Photo, savedToPool: boolean) {
  try {
    const updated = await data.patchPhoto(ph._id, { savedToPool });
    ph.savedToPool = updated.savedToPool;
    if (viewing.value?._id === ph._id) viewing.value = { ...ph };
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}

async function removePhoto() {
  const ph = viewing.value;
  if (!ph) return;
  await data.deletePhoto(ph._id);
  photos.value = photos.value.filter((p) => p._id !== ph._id);
  viewing.value = null;
}

watch(
  () => [props.modelValue, props.issue] as const,
  async ([open, issue], old) => {
    if (!open) {
      // A new issue that was never saved: don't leave its photos behind.
      if (old?.[0] && !old[1] && !savedNew) {
        for (const ph of photos.value) await data.deletePhoto(ph._id).catch(() => undefined);
      }
      return;
    }
    savedNew = false;
    photos.value = [];
    if (!issue) pendingId.value = newId();
    else data.listPhotos({ issueId: issue._id }).then((list) => (photos.value = list)).catch(() => undefined);
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
    const withPhotos = { ...body, photoIds: photos.value.map((p) => p._id) };
    const saved = await data.saveIssue(props.issue?._id ?? null, props.issue ? withPhotos : { _id: pendingId.value, poolId: props.poolId, ...withPhotos });
    if (!props.issue) savedNew = true;
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
