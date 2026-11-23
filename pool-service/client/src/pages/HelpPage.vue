<template>
  <q-page class="q-pa-md column q-gutter-md" data-test="help-page">
    <template v-if="topic">
      <q-card flat bordered data-test="help-topic">
        <q-card-section class="row items-center no-wrap q-gutter-sm">
          <q-icon :name="topic.icon" color="primary" size="sm" />
          <div class="text-h6" data-test="help-topic-title">{{ $t(topic.title) }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none help-body">
          <template v-for="(b, i) in topic.body" :key="i">
            <p v-if="'p' in b">{{ $t(b.p) }}</p>
            <ol v-else-if="'steps' in b">
              <li v-for="s in b.steps" :key="s">{{ $t(s) }}</li>
            </ol>
            <q-banner v-else dense rounded class="bg-blue-1 q-mb-sm">
              <template #avatar><q-icon name="lightbulb" color="primary" /></template>
              {{ $t(b.tip) }}
            </q-banner>
          </template>
        </q-card-section>
      </q-card>
      <q-btn flat no-caps color="primary" icon="list" :label="$t(`All help topics`)" data-test="help-all" @click="router.replace({ name: `${base}help` })" />
    </template>

    <template v-else>
      <q-input v-model="search" outlined dense clearable :placeholder="$t(`Search help`)" data-test="help-search">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <q-list bordered separator class="bg-white rounded-borders" data-test="help-list">
        <q-item v-for="tp in found" :key="tp.id" clickable :data-test="`help-${tp.id}`" @click="router.push({ name: `${base}help`, params: { topic: tp.id }, query: route.query })">
          <q-item-section avatar><q-icon :name="tp.icon" color="primary" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ $t(tp.title) }}</q-item-label>
            <q-item-label v-if="search" caption lines="2">{{ snippet(tp) }}</q-item-label>
          </q-item-section>
          <q-item-section side><q-icon name="chevron_right" /></q-item-section>
        </q-item>
        <q-item v-if="!found.length" class="text-grey-7">{{ $t('Nothing found. Try another word, or send us a question.') }}</q-item>
      </q-list>
    </template>

    <q-btn outline color="primary" no-caps icon="feedback" :label="$t(`Send feedback`)" data-test="help-feedback" @click="router.push({ name: `${base}feedback`, query: { from: String(route.query.from ?? '') } })" />

    <div class="text-center text-caption text-grey-7 q-mt-md" data-test="help-support">
      {{ $t('Support:') }} <a :href="`mailto:${SUPPORT_EMAIL}`">{{ SUPPORT_EMAIL }}</a>
      <div class="q-mt-xs">{{ LEGAL_LINE }}</div>
      <div class="q-mt-xs"><router-link to="/terms">{{ $t('Terms of beta use') }}</router-link> · <router-link to="/privacy">{{ $t('Privacy') }}</router-link></div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { computed, ref, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { HELP, LEGAL_LINE, SUPPORT_EMAIL, type HelpTopic } from '@/lib/help';

defineOptions({ name: 'HelpPage' });
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ui = useUiStore();
const search = ref('');
/** Desktop view: stay in it. */
const base = computed(() => (route.path.startsWith('/desk') ? 'desk-' : ''));

const visible = computed(() => HELP.filter((tp) => !tp.owner || auth.isOwner));
const topic = computed(() => visible.value.find((tp) => tp.id === route.params.topic));
watchEffect(() => ui.setTitle(topic.value ? t('Help') : ''));

/** All of a topic's text, in the current language. */
const texts = (tp: HelpTopic) => [t(tp.title), ...tp.body.flatMap((b) => ('p' in b ? [t(b.p)] : 'steps' in b ? b.steps.map((s) => t(s)) : [t(b.tip)]))];
const norm = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const found = computed(() => {
  const words = norm(search.value ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return visible.value;
  return visible.value.filter((tp) => {
    const all = norm(texts(tp).join(' '));
    return words.every((w) => all.includes(w));
  });
});
function snippet(tp: HelpTopic) {
  const w = norm(search.value ?? '').split(/\s+/).filter(Boolean)[0] ?? '';
  return texts(tp).slice(1).find((s) => norm(s).includes(w)) ?? '';
}
</script>

<style scoped>
.help-body p,
.help-body li {
  line-height: 1.5;
}
.help-body ol {
  padding-inline-start: 1.4em;
  margin: 0 0 0.8em;
}
.help-body li {
  margin-bottom: 0.4em;
}
</style>
