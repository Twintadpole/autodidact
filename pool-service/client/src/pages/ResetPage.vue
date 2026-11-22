<template>
  <PublicCard :title="$t(`Choose a new password`)">
    <q-card-section v-if="!token" class="text-body1" data-test="reset-no-token">{{ $t('This link is incomplete. Open it again from the email, or ask for a new one.') }}</q-card-section>

    <q-form v-else @submit.prevent="save">
      <q-card-section class="q-gutter-sm">
        <q-input v-model="next1" type="password" outlined :label="$t(`New password (8 characters or more)`)" autocomplete="new-password" data-test="reset-new" />
        <q-input v-model="next2" type="password" outlined :label="$t(`New password again`)" autocomplete="new-password" data-test="reset-new2" :error="!!next2 && next1 !== next2" :error-message="$t(`The two don't match`)" />
        <div class="text-caption text-grey-7">{{ $t('Every device logged in as you is signed out.') }}</div>
        <div v-if="error" class="text-negative text-body2" data-test="reset-error">{{ error }}</div>
      </q-card-section>
      <q-card-actions class="q-px-md">
        <q-btn type="submit" color="primary" unelevated class="full-width" :label="$t(`Save the new password`)" :disable="next1.length < 8 || next1 !== next2" :loading="busy" data-test="reset-save" />
      </q-card-actions>
    </q-form>

    <q-card-actions class="q-px-md q-pb-md column q-gutter-xs">
      <q-btn v-if="error" flat no-caps color="primary" class="full-width" :label="$t(`Ask for a new link`)" @click="router.replace('/forgot')" />
      <q-btn flat no-caps color="primary" class="full-width" icon="arrow_back" :label="$t(`Back to log in`)" @click="router.replace('/login')" />
    </q-card-actions>
  </PublicCard>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { api, errorMessage } from '@/stores/api';
import PublicCard from '@/components/PublicCard.vue';

defineOptions({ name: 'ResetPage' });
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const token = typeof route.query.token === 'string' ? route.query.token : '';
const next1 = ref('');
const next2 = ref('');
const busy = ref(false);
const error = ref('');

async function save() {
  busy.value = true;
  error.value = '';
  try {
    const r = await api<{ email: string }>('/auth/reset', { method: 'POST', body: { token, password: next1.value } });
    $q.notify({ type: 'positive', message: t('Password changed. Log in with your new password.') });
    await router.replace({ path: '/login', query: { email: r.email } });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>
