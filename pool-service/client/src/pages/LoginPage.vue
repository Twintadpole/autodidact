<template>
  <q-layout view="hHh lpR fFf">
    <q-page-container>
      <q-page class="column items-center justify-center q-pa-md bg-grey-2">
        <q-card flat bordered class="full-width" style="max-width: 420px">
          <q-form @submit.prevent="submit">
            <q-card-section class="text-center q-pb-none">
              <q-icon name="pool" size="56px" color="primary" />
              <div class="text-h5 q-mt-sm">Pool Service</div>
            </q-card-section>
            <q-card-section class="q-gutter-md">
              <q-input
                v-model="password"
                type="password"
                label="Password"
                outlined
                autofocus
                autocomplete="current-password"
                data-test="password"
                :error="!!error"
                :error-message="error"
              />
              <q-toggle v-model="remember" label="Remember this device (90 days)" />
            </q-card-section>
            <q-card-actions class="q-px-md q-pb-md">
              <q-btn type="submit" color="primary" unelevated size="lg" class="full-width" label="Log in" :loading="busy" data-test="login" />
            </q-card-actions>
          </q-form>
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { ApiError } from '@/stores/api';

defineOptions({ name: 'LoginPage' });

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const password = ref('');
const remember = ref(true);
const busy = ref(false);
const error = ref('');

async function submit() {
  if (!password.value) return;
  busy.value = true;
  error.value = '';
  try {
    await auth.login(password.value, remember.value);
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    await router.replace(next);
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) error.value = 'Too many attempts. Wait 15 minutes.';
    else if (err instanceof ApiError && err.status === 401) error.value = 'Wrong password';
    else error.value = err instanceof Error ? err.message : 'Login failed';
  } finally {
    busy.value = false;
  }
}
</script>
