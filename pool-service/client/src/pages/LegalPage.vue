<template>
  <PublicCard :title="doc === 'privacy' ? $t('Privacy') : $t('Terms of beta use')" wide>
    <q-card-section>
      <div v-if="lang !== 'en'" class="text-caption text-grey-7 q-mb-sm" data-test="legal-english-only">{{ $t('This page is in English only for now.') }}</div>
      <!-- eslint-disable-next-line vue/no-v-html -- our own fixed text, escaped by renderMarkdown -->
      <div class="legal" dir="ltr" lang="en" data-test="legal-text" v-html="html" />
    </q-card-section>
    <q-card-actions class="q-px-md q-pb-md">
      <q-btn flat no-caps color="primary" icon="arrow_back" :label="$t(`Back`)" data-test="legal-back" @click="back" />
      <q-space />
      <q-btn flat no-caps color="primary" :label="doc === 'privacy' ? $t('Terms of beta use') : $t('Privacy')" @click="router.replace(doc === 'privacy' ? '/terms' : '/privacy')" />
    </q-card-actions>
  </PublicCard>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { lang } from '@/i18n';
import { renderMarkdown } from '@/lib/markdown';
import { SUPPORT_EMAIL } from '@/lib/help';
import PublicCard from '@/components/PublicCard.vue';
import terms from '@/legal/terms.md?raw';
import privacy from '@/legal/privacy.md?raw';

/** Terms of beta use and Privacy (beta docs). Public: linked from the login screen, More and Help. */
defineOptions({ name: 'LegalPage' });
const props = defineProps<{ doc: 'terms' | 'privacy' }>();
const router = useRouter();
// The page's own title is the card's; the text starts below its "# …" line.
const html = computed(() => renderMarkdown((props.doc === 'privacy' ? privacy : terms).replace(/^# .*\n/, ''), { SUPPORT: SUPPORT_EMAIL }));
function back() {
  if (window.history.state?.back) router.back();
  else void router.replace('/login');
}
</script>

<style scoped>
.legal :deep(h3) {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 1.2em 0 0.4em;
}
.legal :deep(p),
.legal :deep(li) {
  line-height: 1.5;
}
.legal :deep(ul),
.legal :deep(ol) {
  padding-left: 1.3em;
  margin: 0 0 0.8em;
}
</style>
