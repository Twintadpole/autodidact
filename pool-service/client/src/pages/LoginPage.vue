<template>
  <q-layout view="hHh lpR fFf">
    <q-page-container>
      <q-page class="column items-center justify-center q-pa-md bg-grey-2">
        <q-card flat bordered class="full-width" style="max-width: 420px">
          <q-form @submit.prevent="submit">
            <q-card-section class="text-center q-pb-none">
              <img v-if="brand.logo" :src="brand.logo" alt="" class="login-logo" data-test="login-logo" />
              <img v-else src="/icons/icon-128x128.png" alt="" class="login-logo" />
              <div class="text-h5 q-mt-sm" data-test="login-name">{{ appName }}</div>
              <div v-if="brand.business" class="text-caption text-grey-7" data-test="login-powered">Powered by {{ brand.product }}</div>
            </q-card-section>
            <q-card-section class="q-gutter-md">
              <q-input
                v-model="email"
                type="text"
                inputmode="email"
                label="Email"
                outlined
                :autofocus="!email"
                autocomplete="username"
                autocapitalize="off"
                data-test="email"
              />
              <q-input
                v-model="password"
                type="password"
                label="Password"
                outlined
                :autofocus="!!email"
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
import { onMounted, ref } from 'vue';
import { appName, brand, refreshBranding } from '@/lib/branding';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { useAuthStore } from '@/stores/auth';
import { useDataStore } from '@/stores/data';
import { ApiError } from '@/stores/api';
import { clearLocalData, mustClearFor, setDataOwner, unsentCount } from '@/lib/session';

defineOptions({ name: 'LoginPage' });

const auth = useAuthStore();
const data = useDataStore();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const LAST_EMAIL = 'pool.lastEmail';
const email = ref(localStorage.getItem(LAST_EMAIL) ?? '');
const password = ref('');
const remember = ref(true);
const busy = ref(false);
const error = ref('');

/** Asks before unsent changes from the previous login are thrown away. */
function confirmDiscard(n: number): Promise<boolean> {
  return new Promise((resolve) => {
    $q.dialog({
      title: 'Unsent changes on this phone',
      message: `This phone has ${n} change${n === 1 ? '' : 's'} from the previous login that ${n === 1 ? 'hasn’t' : 'haven’t'} reached the server. Logging in as someone else deletes ${n === 1 ? 'it' : 'them'}. To keep ${n === 1 ? 'it' : 'them'}, cancel, log in as the previous person and let the phone sync first.`,
      cancel: { label: 'Cancel', flat: true, noCaps: true },
      ok: { label: 'Delete and continue', color: 'negative', unelevated: true, noCaps: true },
      persistent: true,
    })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false));
  });
}

async function submit() {
  if (!email.value.trim() || !password.value) return;
  busy.value = true;
  error.value = '';
  try {
    const me = await auth.login(email.value.trim(), password.value, remember.value);
    localStorage.setItem(LAST_EMAIL, email.value.trim());
    if (await mustClearFor(me._id, me.role)) {
      const n = await unsentCount();
      if (n && !(await confirmDiscard(n))) {
        await auth.logout();
        return;
      }
      await clearLocalData();
    }
    await setDataOwner(me._id);
    await data.loadAll(true);
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    await router.replace(me.mustChangePassword ? '/more/account?change=1' : next);
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) error.value = err.message.includes('this login') ? err.message : 'Too many attempts. Wait 15 minutes.';
    else if (err instanceof ApiError && err.status === 401) error.value = 'Wrong email or password';
    else if (err instanceof ApiError && err.status === 400) error.value = 'Check the email address';
    else error.value = err instanceof Error ? err.message : 'Login failed';
  } finally {
    busy.value = false;
  }
}
onMounted(refreshBranding);
</script>

<style scoped>
.login-logo {
  width: 72px;
  height: 72px;
  object-fit: contain;
}
</style>
