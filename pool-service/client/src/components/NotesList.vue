<template>
  <div>
    <q-list v-if="notes.length" bordered separator class="bg-white rounded-borders q-mb-sm">
      <q-item v-for="n in notes" :key="n._id" data-test="note-row">
        <q-item-section avatar>
          <q-btn flat round dense :icon="'push_pin'" :color="n.pinned ? 'amber-9' : 'grey-6'" :aria-label="n.pinned ? 'Unpin' : 'Pin'" @click="togglePin(n)" />
        </q-item-section>
        <q-item-section>
          <q-item-label class="pre-wrap">{{ n.body }}</q-item-label>
          <q-item-label caption>{{ shortDate(n.createdAt) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-btn flat round dense icon="delete" color="grey-6" aria-label="Delete note" @click="remove(n)" />
        </q-item-section>
      </q-item>
    </q-list>
    <div v-else class="text-grey-6 text-body2 q-mb-sm">No notes yet.</div>
    <div class="row no-wrap items-start q-gutter-x-sm">
      <q-input v-model="draft" dense outlined autogrow placeholder="Add a note…" class="col" data-test="note-input" @keydown.enter.exact.prevent="add" />
      <q-btn unelevated color="primary" icon="add" :disable="!draft.trim()" aria-label="Add note" data-test="note-add" @click="add" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { shortDate } from '@/lib/format';
import type { Note } from '@/lib/types';

const props = defineProps<{ parentType: Note['parentType']; parentId: string }>();

const $q = useQuasar();
const data = useDataStore();
const notes = ref<Note[]>([]);
const draft = ref('');

async function load() {
  try {
    notes.value = await data.notesFor(props.parentType, props.parentId);
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}

async function add() {
  const body = draft.value.trim();
  if (!body) return;
  try {
    await data.saveNote(null, { parentType: props.parentType, parentId: props.parentId, body, pinned: false });
    draft.value = '';
    await load();
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}

async function togglePin(n: Note) {
  await data.saveNote(n._id, { pinned: !n.pinned });
  await load();
}

function remove(n: Note) {
  $q.dialog({ title: 'Delete note?', message: n.body, cancel: true, ok: { label: 'Delete', color: 'negative', unelevated: true } }).onOk(async () => {
    await data.deleteNote(n._id);
    await load();
  });
}

watch(() => props.parentId, load);
onMounted(load);
</script>

<style scoped>
.pre-wrap {
  white-space: pre-wrap;
}
</style>
