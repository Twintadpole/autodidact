<template>
  <PublicCard :title="$t(`Forgot password?`)">
    <q-card-section v-if="loading" class="flex flex-center q-pa-lg"><q-spinner size="32px" color="primary" /></q-card-section>

    <!-- No mailbox set up for this app: the owner gives a new temporary password -->
    <q-card-section v-else-if="!byEmail" class="q-gutter-sm" data-test="forgot-ask-owner">
      <div class="text-body1">{{ $t('Ask the business owner for a new temporary password.') }}</div>
      <div class="text-caption text-grey-8">{{ $t('Owners make one under More → Team. You choose your own when you log in with it.') }}</div>
      <div v-if="loadError" class="text-caption text-negative">{{ loadError }}</div>
    </q-card-section>

    <q-card-section v-else-if="sent" class="q-gutter-sm" data-test="forgot-sent">
      <div class="text-body1">{{ $t('If {email} has a login, an email with a link is on its way.', { email: email.trim() }) }}</div>
      <div class="text-caption text-grey-8">{{ $t('It can take a minute or two; check your spam folder too. The link works for 30 minutes.') }}</div>
    </q-card-section>

    <q-form v-else @submit.prevent="send">
      <q-card-section class="q-gutter-md">
        <div class="text-body2 text-grey-8">{{ $t('Enter the email you log in with. We’ll send you a link to choose a new password.') }}</div>
        <q-input v-model="email" type="text" inputmode="email" outlined autocapitalize="off" autocomplete="username" :label="$t(`Email`)" data-test="forgot-email" />
        <div v-if="error" class="text-negative text-caption">{{ error }}</div>
      </q-card-section>
      <q-card-actions class="q-px-md">
        <q-btn type="submit" color="primary" unelevated class="full-width" :label="$t(`Send the link`)" :disable="!email.trim()" :loading="busy" data-test="forgot-send" />
      </q-card-actions>
    </q-form>

    <q-card-actions class="q-px-md q-pb-md">
      <q-btn flat no-caps color="primary" class="full-width" icon="arrow_back" :label="$t(`Back to log in`)" data-test="forgot-back" @click="router.replace({ path: '/login', query: email.trim() ? { email: email.trim() } : {} })" />
    </q-card-actions>
  </PublicCard>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '@/stores/api';
import PublicCard from '@/components/PublicCard.vue';

defineOptions({ name: 'ForgotPage' });
const route = useRoute();
const router = useRouter();
const email = ref(typeof route.query.email === 'string' ? route.query.email : '');
const loading = ref(true);
const loadError = ref('');
const byEmail = ref(false);
const busy = ref(false);
const sent = ref(false);
const error = ref('');

async function send() {
  busy.value = true;
  error.value = '';
  try {
    await api('/auth/forgot', { method: 'POST', body: { email: email.value.trim() } });
    sent.value = true;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    byEmail.value = (await api<{ resetByEmail: boolean }>('/auth/options')).resetByEmail;
  } catch (e) {
    loadError.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});
</script>
