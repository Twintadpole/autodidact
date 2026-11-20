<template>
  <router-view />
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { useQuasar } from 'quasar';
import { useSyncStore } from '@/stores/sync';
import { ACCESS_LOGIN_URL } from '@/offline/access';

defineOptions({ name: 'App' });

// Cloudflare Access (emailed-code login) expired: one message on every screen until it's fixed.
const $q = useQuasar();
const sync = useSyncStore();
let dismiss: (() => void) | null = null;
watch(
  () => sync.accessBlocked,
  (blocked) => {
    if (blocked && !dismiss) {
      dismiss = $q.notify({
        message: 'Cloudflare login needed',
        caption: 'Your changes are safe on this phone and upload after you log in.',
        icon: 'lock',
        color: 'orange-9',
        timeout: 0,
        position: 'top',
        attrs: { 'data-test': 'access-needed' },
        actions: [{ label: 'Log in again', color: 'white', handler: () => window.location.assign(ACCESS_LOGIN_URL) }],
      });
    } else if (!blocked && dismiss) {
      dismiss();
      dismiss = null;
    }
  },
);
</script>
