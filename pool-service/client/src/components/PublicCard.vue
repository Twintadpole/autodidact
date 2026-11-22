<template>
  <q-layout view="hHh lpR fFf">
    <q-page-container>
      <q-page class="flex flex-center bg-grey-2 q-pa-md">
        <q-card class="public-card" :class="{ wide }">
          <q-card-section class="text-center q-pb-none">
            <img :src="brand.logo || '/icons/icon-128x128.png'" alt="" class="public-logo" />
            <div class="text-h6 q-mt-sm">{{ title }}</div>
            <div class="text-caption text-grey-7">{{ appName }}</div>
          </q-card-section>
          <slot />
        </q-card>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { appName, brand, refreshBranding } from '@/lib/branding';

/** The frame of the screens shown before login (Forgot password, Choose a new password). */
defineOptions({ name: 'PublicCard' });
defineProps<{ title: string; wide?: boolean }>();
void refreshBranding();
</script>

<style scoped>
.public-card {
  width: 400px;
  max-width: 100%;
}
.public-card.wide {
  width: 720px;
}
.public-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
}
</style>
