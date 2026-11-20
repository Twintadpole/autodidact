<template>
  <q-page class="q-pa-md column q-gutter-md" data-test="account-page">
    <q-card flat bordered>
      <q-card-section>
        <div class="text-h6" data-test="account-name">{{ auth.me?.name ?? 'Owner' }}</div>
        <div class="text-grey-8">{{ auth.me?.email }} · {{ auth.isOwner ? 'Owner' : 'Tech' }}</div>
      </q-card-section>
    </q-card>

    <q-card flat bordered>
      <q-form @submit.prevent="changePassword">
        <q-card-section>
          <div class="text-subtitle1 text-weight-medium">Change password</div>
          <q-banner v-if="forced" dense rounded class="bg-amber-1 q-mt-sm" data-test="account-must-change">
            You logged in with a temporary password. Choose your own to continue.
          </q-banner>
        </q-card-section>
        <q-card-section class="q-pt-none q-gutter-sm">
          <q-input v-model="current" type="password" outlined dense :label="forced ? 'Temporary password' : 'Current password'" autocomplete="current-password" data-test="account-current" />
          <q-input v-model="next1" type="password" outlined dense label="New password (8 characters or more)" autocomplete="new-password" data-test="account-new" />
          <q-input v-model="next2" type="password" outlined dense label="New password again" autocomplete="new-password" data-test="account-new2" :error="!!next2 && next1 !== next2" error-message="The two don't match" />
          <div class="text-caption text-grey-7">Your other devices are signed out when you change it.</div>
        </q-card-section>
        <q-card-actions align="right" class="q-px-md q-pb-md">
          <q-btn type="submit" color="primary" unelevated no-caps label="Change password" :disable="!current || next1.length < 8 || next1 !== next2" :loading="saving" data-test="account-save" />
        </q-card-actions>
      </q-form>
    </q-card>

    <q-card v-if="!forced" flat bordered>
      <q-card-section class="row items-center">
        <div class="text-subtitle1 text-weight-medium">My devices</div>
        <q-space />
        <q-btn v-if="devices.length > 1" flat dense no-caps color="negative" label="Sign out all others" data-test="account-signout-others" @click="signOut('others')" />
      </q-card-section>
      <q-list separator data-test="account-devices">
        <q-item v-for="d in devices" :key="d.id">
          <q-item-section avatar><q-icon :name="/Android|iPhone/.test(d.device) ? 'smartphone' : 'computer'" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ d.device }} <q-badge v-if="d.current" color="positive" label="This device" class="q-ml-xs" /></q-item-label>
            <q-item-label caption>Signed in {{ when(d.signedInAt) }} · last used {{ when(d.lastSeenAt) }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="!d.current" side>
            <q-btn flat dense no-caps color="negative" label="Sign out" @click="signOut(d.id)" />
          </q-item-section>
        </q-item>
        <q-item v-if="!devices.length" class="text-grey-7">{{ devicesError || 'Loading…' }}</q-item>
      </q-list>
    </q-card>

    <q-btn outline color="grey-8" icon="logout" label="Log out" data-test="account-logout" @click="logout" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import type { Device } from '@pool/shared';
import { useAuthStore } from '@/stores/auth';
import { api, errorMessage } from '@/stores/api';

defineOptions({ name: 'AccountPage' });
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();

const forced = computed(() => !!auth.me?.mustChangePassword || route.query.change === '1');
const current = ref('');
const next1 = ref('');
const next2 = ref('');
const saving = ref(false);
const devices = ref<Device[]>([]);
const devicesError = ref('');

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

async function loadDevices() {
  try {
    devices.value = await api<Device[]>('/auth/devices');
  } catch (err) {
    devicesError.value = errorMessage(err);
  }
}
async function changePassword() {
  saving.value = true;
  try {
    const r = await api<{ signedOut: number }>('/auth/password', { method: 'POST', body: { current: current.value, password: next1.value } });
    auth.passwordChanged();
    current.value = next1.value = next2.value = '';
    $q.notify({ type: 'positive', message: `Password changed${r.signedOut ? `; ${r.signedOut} other device${r.signedOut === 1 ? '' : 's'} signed out` : ''}` });
    if (route.query.change === '1') await router.replace('/');
    else await loadDevices();
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  } finally {
    saving.value = false;
  }
}
async function signOut(id: string) {
  try {
    await api(`/auth/devices/${id}`, { method: 'DELETE' });
    await loadDevices();
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) });
  }
}
async function logout() {
  await auth.logout();
  await router.replace('/login');
}
onMounted(loadDevices);
</script>
