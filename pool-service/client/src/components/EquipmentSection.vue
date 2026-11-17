<template>
  <div data-test="equipment">
    <div class="text-subtitle1 q-mb-xs">Equipment</div>

    <q-list v-if="items.length" bordered separator class="bg-white rounded-borders q-mb-sm">
      <q-item v-for="e in items" :key="e._id" clickable :data-test="`equipment-${e.kind}`" @click="edit(e)">
        <q-item-section avatar><q-icon :name="EQUIPMENT_ICON[e.kind]" color="primary" /></q-item-section>
        <q-item-section>
          <q-item-label>{{ title(e) }}</q-item-label>
          <q-item-label v-if="caption(e)" caption>{{ caption(e) }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="photos.get(e._id)?.length" side>
          <q-chip dense icon="photo" :label="photos.get(e._id)!.length" class="q-ma-none" />
        </q-item-section>
      </q-item>
    </q-list>

    <!-- Empty slots, plus anything else -->
    <div class="row q-gutter-xs">
      <q-chip
        v-for="k in emptySlots"
        :key="k"
        clickable
        outline
        color="primary"
        icon="add"
        :label="EQUIPMENT_LABEL[k]"
        :data-test="`add-equipment-${k}`"
        @click="add(k)"
      />
      <q-chip clickable outline color="primary" icon="add" label="Other equipment" data-test="add-equipment-other" @click="add('other')" />
    </div>

    <!-- Edit one item -->
    <q-dialog v-model="open" position="bottom" @hide="onHide">
      <q-card v-if="draft" class="full-width" style="max-width: 600px" data-test="equipment-dialog">
        <q-card-section class="row items-center q-pb-none">
          <q-icon :name="EQUIPMENT_ICON[draft.kind]" color="primary" size="24px" class="q-mr-sm" />
          <div class="text-h6">{{ EQUIPMENT_LABEL[draft.kind] }}</div>
          <q-space />
          <q-btn flat round dense icon="close" aria-label="Close" @click="open = false" />
        </q-card-section>
        <q-card-section class="column q-gutter-sm">
          <q-input v-model="draft.name" outlined dense :label="draft.kind === 'other' ? 'What is it? (e.g. Booster pump)' : 'Label (e.g. Spa heater)'" data-test="equipment-name" />
          <q-input v-model="draft.model" outlined dense label="Brand and model" data-test="equipment-model" />
          <div class="row q-col-gutter-sm">
            <q-input v-model="draft.serial" outlined dense label="Serial number" class="col-7" data-test="equipment-serial" />
            <q-input v-model="draft.installedOn" outlined dense stack-label label="Installed" type="date" class="col-5" data-test="equipment-installed" />
          </div>
          <q-input v-model="draft.notes" outlined dense autogrow type="textarea" label="Notes" data-test="equipment-notes" />

          <div>
            <div class="row items-center q-gutter-sm q-mb-sm">
              <div class="text-subtitle2">Photos</div>
              <q-space />
              <q-btn outline dense no-caps color="primary" icon="photo_camera" label="Camera" @click="cameraInput?.click()" />
              <q-btn outline dense no-caps color="primary" icon="photo_library" label="Gallery" @click="galleryInput?.click()" />
            </div>
            <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onFiles" />
            <input ref="galleryInput" type="file" accept="image/*" multiple class="hidden" data-test="equipment-photo-input" @change="onFiles" />
            <PhotoGrid v-if="draftPhotos.length || uploading" :photos="draftPhotos" :pending="uploading" @open="(p) => (viewing = p)" />
          </div>
        </q-card-section>
        <q-card-actions class="q-px-md q-pb-md">
          <q-btn v-if="!isNew" flat color="negative" icon="delete" label="Remove" no-caps data-test="equipment-remove" @click="remove" />
          <q-space />
          <q-btn color="primary" unelevated label="Save" :loading="busy" :disable="uploading > 0" data-test="equipment-save" @click="save" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <PhotoViewer :photo="viewing" no-gallery @close="viewing = null" @delete="deleteViewing" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { format, parseISO } from 'date-fns';
import type { EquipmentKind } from '@pool/shared';
import PhotoGrid from '@/components/PhotoGrid.vue';
import PhotoViewer from '@/components/PhotoViewer.vue';
import { useDataStore } from '@/stores/data';
import { errorMessage, reportClientProblem } from '@/stores/api';
import { compressPhoto } from '@/lib/photos';
import { dateInput, EQUIPMENT_ICON, EQUIPMENT_LABEL, EQUIPMENT_SLOTS } from '@/lib/customer';
import { newId } from '@/lib/format';
import type { Equipment, Photo, Pool } from '@/lib/types';

/**
 * A pool's equipment: ready-made slots (pump, filter, heater…) and anything else, each with
 * optional details, notes and photos. Every field is optional.
 */
const props = defineProps<{ pool: Pool }>();

const $q = useQuasar();
const data = useDataStore();

const items = computed(() => {
  const order = (k: EquipmentKind) => (EQUIPMENT_SLOTS as readonly string[]).indexOf(k) + 1 || 99;
  return [...(props.pool.equipment ?? [])].sort((a, b) => order(a.kind) - order(b.kind));
});
const emptySlots = computed(() => EQUIPMENT_SLOTS.filter((k) => !items.value.some((e) => e.kind === k)));

const photos = ref(new Map<string, Photo[]>());
async function loadPhotos() {
  photos.value = await data.equipmentPhotos(props.pool._id).catch(() => new Map());
}
watch(() => [props.pool._id, data.version], () => void loadPhotos(), { immediate: true });

const title = (e: Equipment) => e.name?.trim() || EQUIPMENT_LABEL[e.kind];
const caption = (e: Equipment) =>
  [
    e.name?.trim() && e.kind !== 'other' ? EQUIPMENT_LABEL[e.kind] : '',
    e.model,
    e.serial ? `S/N ${e.serial}` : '',
    e.installedOn ? `installed ${format(parseISO(e.installedOn.slice(0, 10)), 'MMM yyyy')}` : '',
  ]
    .filter((x) => x?.trim())
    .join(' · ');

// ---- dialog
type Draft = { _id: string; kind: EquipmentKind; name: string; model: string; serial: string; installedOn: string; notes: string };
const open = ref(false);
const busy = ref(false);
const isNew = ref(false);
const draft = ref<Draft | null>(null);
const uploading = ref(0);
const viewing = ref<Photo | null>(null);
const cameraInput = ref<HTMLInputElement | null>(null);
const galleryInput = ref<HTMLInputElement | null>(null);
let saved = false;
/** Photos added while this dialog was open (removed again if a new item is closed without saving). */
let addedPhotoIds: string[] = [];

const draftPhotos = computed(() => (draft.value ? (photos.value.get(draft.value._id) ?? []) : []));

function add(kind: EquipmentKind) {
  draft.value = { _id: newId(), kind, name: '', model: '', serial: '', installedOn: '', notes: '' };
  isNew.value = true;
  startEditing();
}
function edit(e: Equipment) {
  draft.value = { _id: e._id, kind: e.kind, name: e.name ?? '', model: e.model ?? '', serial: e.serial ?? '', installedOn: dateInput(e.installedOn), notes: e.notes ?? '' };
  isNew.value = false;
  startEditing();
}
function startEditing() {
  saved = false;
  addedPhotoIds = [];
  open.value = true;
}

function toEquipment(d: Draft): Equipment {
  const t = (s: string) => s.trim() || undefined;
  return {
    _id: d._id,
    kind: d.kind,
    ...(t(d.name) && { name: t(d.name) }),
    ...(t(d.model) && { model: t(d.model) }),
    ...(t(d.serial) && { serial: t(d.serial) }),
    installedOn: d.installedOn || null,
    ...(t(d.notes) && { notes: t(d.notes) }),
  } as Equipment;
}

async function save() {
  if (!draft.value) return;
  busy.value = true;
  try {
    const item = toEquipment(draft.value);
    const list = isNew.value ? [...(props.pool.equipment ?? []), item] : (props.pool.equipment ?? []).map((e) => (e._id === item._id ? item : e));
    await data.saveEquipment(props.pool._id, list, `${isNew.value ? 'Add' : 'Edit'} ${title(item).toLowerCase()}`);
    saved = true;
    open.value = false;
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    busy.value = false;
  }
}

function remove() {
  const d = draft.value;
  if (!d) return;
  $q.dialog({ title: `Remove ${title(toEquipment(d)).toLowerCase()}?`, message: 'Its details and photos are removed.', cancel: true, ok: { label: 'Remove', color: 'negative', unelevated: true } }).onOk(async () => {
    const list = (props.pool.equipment ?? []).filter((e) => e._id !== d._id);
    await data.saveEquipment(props.pool._id, list, `Remove ${title(toEquipment(d)).toLowerCase()}`);
    saved = true;
    open.value = false;
  });
}

/** A new item closed without saving: its photos go too. */
async function onHide() {
  if (isNew.value && !saved) for (const id of addedPhotoIds) await data.deletePhoto(id);
  addedPhotoIds = [];
  draft.value = null;
}

async function onFiles(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  const d = draft.value;
  if (!d) return;
  for (const file of files) {
    uploading.value++;
    try {
      const { blob, width, height } = await compressPhoto(file);
      const photo = await data.uploadPhoto(blob, { poolId: props.pool._id, issueId: null, equipmentId: d._id, width, height });
      addedPhotoIds.push(photo._id);
      photos.value = new Map(photos.value).set(d._id, [...(photos.value.get(d._id) ?? []), photo]);
    } catch (err) {
      const message = errorMessage(err);
      $q.notify({ type: 'negative', message: `Photo not added: ${message}`, timeout: 0, actions: [{ label: 'OK', color: 'white' }] });
      void reportClientProblem('equipment-photo', message, { name: file.name, type: file.type, size: file.size });
    } finally {
      uploading.value--;
    }
  }
}

async function deleteViewing() {
  const ph = viewing.value;
  if (!ph) return;
  viewing.value = null;
  await data.deletePhoto(ph._id);
  await loadPhotos();
}
</script>
