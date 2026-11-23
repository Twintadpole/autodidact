<template>
  <q-dialog :model-value="welcomeOpen" persistent :maximized="$q.screen.lt.sm" data-test="welcome">
    <q-card class="column no-wrap welcome-card">
      <q-card-section class="col column items-center justify-center text-center q-gutter-md">
        <q-icon :name="page.icon" color="primary" size="64px" />
        <div class="text-h5" data-test="welcome-title">{{ page.title }}</div>
        <div v-for="(line, i) in page.lines" :key="i" class="text-body1 text-grey-9 welcome-line">{{ line }}</div>
        <LanguagePicker v-if="step === 0" save class="full-width welcome-lang" />
      </q-card-section>
      <q-card-section class="row justify-center q-gutter-xs">
        <div v-for="(_, i) in pages" :key="i" class="dot" :class="{ on: i === step }" />
      </q-card-section>
      <q-card-actions class="q-pa-md">
        <q-btn v-if="step < pages.length - 1" flat no-caps color="grey-8" :label="$t(`Skip`)" data-test="welcome-skip" @click="finish" />
        <q-space />
        <q-btn v-if="step < pages.length - 1" unelevated no-caps color="primary" :label="$t(`Next`)" data-test="welcome-next" @click="step++" />
        <q-btn v-else unelevated no-caps color="primary" :label="$t(`Let’s go`)" data-test="welcome-done" @click="finish" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useAuthStore } from '@/stores/auth';
import { appName } from '@/lib/branding';
import { installed, welcomeDone, welcomeOpen } from '@/lib/welcome';
import LanguagePicker from '@/components/LanguagePicker.vue';

/** Beta onboarding: three short screens after someone's first login (see lib/welcome.ts). */
defineOptions({ name: 'WelcomeDialog' });
const $q = useQuasar();
const auth = useAuthStore();
const step = ref(0);

const pages = computed(() => [
  {
    icon: 'waving_hand',
    title: t('Welcome to {name}', { name: appName.value }),
    lines: installed()
      ? [t('You’re all set: the app is on your home screen.'), t('Pick your language here; you can change it later under More → My account.')]
      : [
          t('Add the app to your home screen, so it opens like any other app.'),
          /iPhone|iPad/.test(navigator.userAgent)
            ? t('iPhone: tap Share, then “Add to Home Screen”.')
            : t('Android: tap the ⋮ menu, then “Install app” or “Add to Home screen”.'),
        ],
  },
  auth.isOwner
    ? {
        icon: 'checklist',
        title: t('Set up your business'),
        lines: [t('The Getting started card on the Route walks you through it: your details, prices, customers and techs.'), t('Every field is optional: fill in what you know, add the rest later.')],
      }
    : {
        icon: 'checklist',
        title: t('Your route'),
        lines: [t('The Route shows this week’s pools on your route. Tap a pool to start its visit.'), t('Start the timer when you arrive, then fill in the readings, tasks and chemicals.')],
      },
  {
    icon: 'cloud_off',
    title: t('No signal? Keep working'),
    lines: [t('Everything is saved on the phone and uploads by itself when there’s signal.'), t('Questions? Tap ? at the top of any screen for help, or send us feedback.')],
  },
]);
const page = computed(() => pages.value[step.value]!);

function finish() {
  welcomeDone();
  step.value = 0;
}
</script>

<style scoped>
.welcome-card {
  width: 440px;
  max-width: 100vw;
  min-height: 460px;
}
.welcome-line {
  max-width: 360px;
}
.welcome-lang {
  max-width: 320px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cfd8dc;
}
.dot.on {
  background: var(--q-primary);
}
</style>
