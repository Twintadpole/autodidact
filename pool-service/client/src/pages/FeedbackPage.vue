<template>
  <q-page class="q-pa-md column q-gutter-md" data-test="feedback-page">
    <q-card flat bordered>
      <q-form @submit.prevent="send">
        <q-card-section class="q-gutter-sm">
          <div class="text-body2 text-grey-8">{{ $t('A problem, an idea or a question? Say what you were doing and what you expected.') }}</div>
          <q-btn-toggle v-model="kind" spread no-caps unelevated toggle-color="primary" color="grey-2" text-color="grey-9" :options="kinds" data-test="feedback-kind" />
          <q-input v-model="text" type="textarea" outlined autogrow :input-style="{ minHeight: '7em' }" :label="$t(`Your feedback`)" maxlength="4000" data-test="feedback-text" />
          <div class="text-caption text-grey-7">{{ $t('Sent with it: your name, this screen ({screen}), the app version and your language.', { screen: from || '—' }) }}</div>
        </q-card-section>
        <q-card-actions align="right" class="q-px-md q-pb-md">
          <q-btn type="submit" color="primary" unelevated no-caps icon="send" :label="$t(`Send`)" :disable="!text.trim()" :loading="sending" data-test="feedback-send" />
        </q-card-actions>
      </q-form>
    </q-card>

    <q-banner v-if="waiting" dense rounded class="bg-amber-1" data-test="feedback-waiting">
      {{ $tn(waiting, '{n} note waiting for signal', '{n} notes waiting for signal') }}
    </q-banner>

    <q-card flat bordered>
      <q-card-section class="text-subtitle1 text-weight-medium">{{ auth.isOwner ? $t('Feedback from your team') : $t('Feedback you sent') }}</q-card-section>
      <q-list separator data-test="feedback-list">
        <q-item v-for="f in items" :key="f._id" :class="{ 'text-grey-6': f.doneAt }" data-test="feedback-item">
          <q-item-section avatar><q-icon :name="icons[f.kind] ?? 'chat'" :color="f.doneAt ? 'grey-5' : 'primary'" /></q-item-section>
          <q-item-section>
            <q-item-label class="pre-wrap">{{ f.text }}</q-item-label>
            <q-item-label caption>{{ [f.userName, when(f.createdAt), f.screen, f.appVersion && `v${f.appVersion}`].filter(Boolean).join(' · ') }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="auth.isOwner" side>
            <q-checkbox :model-value="!!f.doneAt" :label="$t(`Done`)" left-label dense @update:model-value="(v: boolean) => mark(f, v)" />
          </q-item-section>
        </q-item>
        <q-item v-if="!items.length" class="text-grey-7">{{ listError || (loaded ? $t('Nothing yet.') : $t('Loading…')) }}</q-item>
      </q-list>
    </q-card>

    <div class="text-center text-caption text-grey-7">
      {{ $t('Support:') }} <a :href="`mailto:${SUPPORT_EMAIL}`">{{ SUPPORT_EMAIL }}</a>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { t, translatedOptions, locale } from '@/i18n';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from '@/stores/auth';
import { errorMessage } from '@/stores/api';
import { SUPPORT_EMAIL } from '@/lib/help';
import { flushFeedback, listFeedback, makeNote, markFeedback, sendFeedback, waitingFeedback, type FeedbackItem, type FeedbackKind } from '@/lib/feedback';

defineOptions({ name: 'FeedbackPage' });
const route = useRoute();
const auth = useAuthStore();
const $q = useQuasar();

const kinds = translatedOptions([
  { value: 'problem', label: 'Problem' },
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
]);
const icons: Record<string, string> = { problem: 'bug_report', idea: 'lightbulb', question: 'help', other: 'chat' };
const kind = ref<FeedbackKind>('problem');
const text = ref('');
const sending = ref(false);
const from = computed(() => String(route.query.from ?? ''));
const waiting = ref(waitingFeedback());

const items = ref<FeedbackItem[]>([]);
const loaded = ref(false);
const listError = ref('');
const when = (iso: string) => new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });

async function load() {
  try {
    items.value = (await listFeedback()).items;
    listError.value = '';
  } catch (e) {
    listError.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
}

async function send() {
  sending.value = true;
  try {
    const note = makeNote(kind.value, text.value, from.value || undefined);
    const how = await sendFeedback(note);
    text.value = '';
    waiting.value = waitingFeedback();
    $q.notify({ type: 'positive', message: how === 'sent' ? t('Thanks! Your feedback was sent.') : t('Saved on phone. It’s sent when there’s signal.') });
    if (how === 'sent') await load();
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  } finally {
    sending.value = false;
  }
}

async function mark(f: FeedbackItem, done: boolean) {
  try {
    await markFeedback(f._id, done);
    f.doneAt = done ? new Date().toISOString() : null;
  } catch (e) {
    $q.notify({ type: 'negative', message: errorMessage(e) });
  }
}

onMounted(async () => {
  await flushFeedback();
  waiting.value = waitingFeedback();
  await load();
});
</script>

<style scoped>
.pre-wrap {
  white-space: pre-wrap;
}
</style>
