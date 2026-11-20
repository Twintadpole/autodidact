<template>
  <q-page class="q-pa-md column q-gutter-md">
    <div v-if="!visit" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>
    <template v-else>
      <div class="text-body2 text-grey-8">
        To: <b data-test="recap-to">{{ toEmail || 'no email on file' }}</b>
        <span v-if="!toEmail" class="text-caption"> · add one on the customer, or pick a recipient after Share</span>
      </div>

      <div class="row q-gutter-md">
        <q-toggle v-model="options.readings" label="Water test" data-test="recap-readings" />
        <q-toggle v-model="options.chemicals" label="Chemicals added" data-test="recap-chemicals" />
      </div>

      <q-input v-model="customerNote" outlined autogrow type="textarea" label="Note for the customer" hint="Your private visit notes are never included" data-test="recap-note" />

      <div v-if="dayPhotos.length">
        <div class="text-subtitle2 q-mb-xs">Photos to share (tap to include)</div>
        <div class="photo-pick">
          <button v-for="p in dayPhotos" :key="p._id" type="button" class="pick" :class="{ on: picked.has(p._id) }" :data-test="`recap-photo-${p._id}`" @click="toggle(p._id)">
            <PhotoImg :photo-id="p._id" thumb />
            <q-icon v-if="picked.has(p._id)" name="check_circle" color="positive" size="22px" class="tick" />
          </button>
        </div>
      </div>

      <q-card flat bordered>
        <q-card-section class="text-caption text-grey-7 q-pb-none">Preview · {{ recap.subject }}</q-card-section>
        <q-card-section><pre class="preview" data-test="recap-preview">{{ recap.body }}</pre></q-card-section>
      </q-card>

      <div class="row q-col-gutter-sm">
        <div class="col-6">
          <q-btn class="full-width" color="primary" unelevated icon="email" label="Email" no-caps :href="mailto" data-test="recap-email" @click="afterSend" />
        </div>
        <div class="col-6">
          <q-btn class="full-width" color="primary" outline icon="share" :label="picked.size ? `Share + ${picked.size} photo${picked.size > 1 ? 's' : ''}` : 'Share'" no-caps :loading="sharing" data-test="recap-share" @click="share" />
        </div>
      </div>
      <div class="text-caption text-grey-7">Email opens your email app with everything filled in (email links can't attach photos). Share lets you pick Gmail or Messages and includes photos.</div>
      <div v-if="visit.recapSentAt" class="text-caption text-positive" data-test="recap-sent">Recap sent {{ sentLabel }}</div>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useQuasar } from 'quasar';
import PhotoImg from '@/components/PhotoImg.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { db } from '@/offline/db';
import { buildRecap } from '@/lib/recap';
import { clone } from '@/lib/format';
import type { Photo, Visit } from '@/lib/types';

defineOptions({ name: 'VisitRecapPage' });

const $q = useQuasar();
const route = useRoute();
const data = useDataStore();
const ui = useUiStore();
const poolId = computed(() => String(route.params.id));
const visitId = computed(() => String(route.params.visitId));
const visit = ref<Visit | undefined>();
const customerNote = ref('');
const options = reactive({ readings: true, chemicals: true });
const dayPhotos = ref<Photo[]>([]);
const picked = ref(new Set<string>());
const sharing = ref(false);

const pool = computed(() => data.poolById.get(poolId.value));
const customer = computed(() => (pool.value ? data.customerById.get(pool.value.customerId) : undefined));
const toEmail = computed(() => customer.value?.billingEmail || customer.value?.email || '');

const recap = computed(() =>
  visit.value
    ? buildRecap({
        visit: { ...visit.value, customerNote: customerNote.value },
        customer: customer.value,
        poolName: pool.value ? data.poolName(pool.value) : '',
        chemicalById: data.chemicalById,
        business: data.settings,
        options,
      })
    : { subject: '', body: '' },
);
const mailto = computed(() => `mailto:${encodeURIComponent(toEmail.value)}?subject=${encodeURIComponent(recap.value.subject)}&body=${encodeURIComponent(recap.value.body)}`);
const sentLabel = computed(() => (visit.value?.recapSentAt ? new Date(visit.value.recapSentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''));

async function load() {
  visit.value = await data.getVisit(visitId.value);
  if (!visit.value) return;
  customerNote.value = visit.value.customerNote ?? '';
  // Photos of this pool taken on the visit's day (issue and equipment photos alike).
  const day = new Date(visit.value.visitedAt).toDateString();
  const all = await data.listPhotos({ poolId: poolId.value });
  dayPhotos.value = all.filter((p) => new Date(p.takenAt).toDateString() === day);
}
watch(visitId, () => void load(), { immediate: true });
watch(customer, (c) => ui.setTitle('Visit recap', c?.name ?? ''), { immediate: true });

function toggle(id: string) {
  const next = new Set(picked.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  picked.value = next;
}

/** The note is saved with the visit either way; "sent" only when the owner says so. */
async function saveVisit(sent: boolean) {
  if (!visit.value) return;
  const doc = clone(visit.value);
  if (customerNote.value.trim()) doc.customerNote = customerNote.value.trim();
  else delete doc.customerNote;
  if (sent) doc.recapSentAt = new Date().toISOString();
  await data.saveVisit(doc);
  visit.value = doc;
}

function afterSend() {
  // Give the email/share app a moment, then ask.
  setTimeout(() => {
    $q.dialog({ title: 'Recap sent?', message: 'Mark this visit’s recap as sent.', cancel: { label: 'Not yet', flat: true }, ok: { label: 'Mark sent', unelevated: true, color: 'primary' } })
      .onOk(() => void saveVisit(true))
      .onCancel(() => void saveVisit(false));
  }, 600);
}

async function photoFile(p: Photo): Promise<File | null> {
  const local = await db.photoBlobs.get(p._id);
  let blob = local?.blob ?? null;
  if (!blob) {
    const res = await fetch(`/api/photos/${p._id}`, { credentials: 'same-origin' }).catch(() => null);
    blob = res?.ok ? await res.blob() : null;
  }
  return blob ? new File([blob], `pool-${p._id.slice(0, 8)}.jpg`, { type: 'image/jpeg' }) : null;
}

async function share() {
  sharing.value = true;
  try {
    const files = (await Promise.all(dayPhotos.value.filter((p) => picked.value.has(p._id)).map(photoFile))).filter((f): f is File => !!f);
    if (files.length < picked.value.size) $q.notify({ type: 'warning', message: 'Some photos need a connection to share; sending without them.' });
    const payload: ShareData = { title: recap.value.subject, text: recap.value.body, ...(files.length && navigator.canShare?.({ files }) ? { files } : {}) };
    if (!navigator.share) {
      await navigator.clipboard?.writeText(recap.value.body);
      $q.notify({ message: 'Sharing isn’t available here; the recap was copied instead.', color: 'grey-8' });
    } else {
      await navigator.share(payload);
    }
    afterSend();
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') $q.notify({ type: 'negative', message: `Couldn't share: ${(err as Error).message}` });
  } finally {
    sharing.value = false;
  }
}
</script>

<style scoped>
.preview {
  white-space: pre-wrap;
  font-family: inherit;
  margin: 0;
}
.photo-pick {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.pick {
  position: relative;
  aspect-ratio: 1 / 1;
  padding: 0;
  border: 3px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  background: #eceff1;
}
.pick.on {
  border-color: var(--q-positive);
}
.pick :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tick {
  position: absolute;
  right: 2px;
  bottom: 2px;
  background: white;
  border-radius: 50%;
}
</style>
