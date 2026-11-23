<template>
  <q-select
    :model-value="lang"
    :options="options"
    emit-value
    map-options
    dense
    outlined
    options-dense
    :label="$t('Language')"
    data-test="language"
    @update:model-value="choose"
  >
    <template #prepend><q-icon name="translate" /></template>
  </q-select>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { LANGUAGES, type LanguageCode } from '@pool/shared';
import { lang, setLanguage, t } from '@/i18n';
import { api } from '@/stores/api';
import { useAuthStore } from '@/stores/auth';

/** GPF item 5: the app's language. Signed in, it's saved to the person's login (follows them). */
const props = defineProps<{ save?: boolean }>();
const auth = useAuthStore();
const options = computed(() => LANGUAGES.map((l) => ({ value: l.code, label: l.beta ? `${l.name} (${t('beta')})` : l.name })));

async function choose(code: LanguageCode) {
  await setLanguage(code);
  if (props.save) {
    const me = await api<import('@pool/shared').Me>('/auth/me', { method: 'PATCH', body: { language: code } }).catch(() => null);
    if (me) auth.setMe(me);
  }
}
</script>
