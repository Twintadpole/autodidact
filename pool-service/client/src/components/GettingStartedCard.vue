<template>
  <q-card v-if="show" flat bordered class="bg-blue-1" :class="desk ? 'q-mb-md' : 'q-mx-md q-mt-md'" data-test="getting-started">
    <q-card-section class="row items-center no-wrap q-pb-xs">
      <q-icon name="rocket_launch" color="primary" size="sm" class="q-mr-sm" />
      <div class="col">
        <div class="text-subtitle1 text-weight-medium">{{ $t(`Getting started`) }}</div>
        <div class="text-caption text-grey-8" data-test="getting-started-count">{{ $t('{done} of {total} done', { done: doneCount, total: steps.length }) }}</div>
      </div>
      <q-btn flat dense no-caps color="grey-8" :label="$t(`Hide`)" data-test="getting-started-hide" @click="hide" />
    </q-card-section>
    <q-linear-progress :value="doneCount / steps.length" color="primary" track-color="blue-2" class="q-mx-md" style="width: auto" rounded />
    <q-list dense class="q-py-sm">
      <q-item v-for="s in steps" :key="s.id" clickable :data-test="`getting-started-${s.id}`" :class="{ 'text-grey-6': s.done }" @click="router.push(s.to)">
        <q-item-section avatar style="min-width: 32px">
          <q-icon :name="s.done ? 'check_circle' : 'radio_button_unchecked'" :color="s.done ? 'positive' : 'grey-6'" />
        </q-item-section>
        <q-item-section>
          <q-item-label :class="{ 'text-strike': s.done }">{{ s.label }}</q-item-label>
          <q-item-label v-if="s.hint && !s.done" caption>{{ s.hint }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="!s.done" side><q-icon name="chevron_right" size="xs" /></q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>

<script setup lang="ts">
import { t } from '@/i18n';
import { computed, ref } from 'vue';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import { customerStatus } from '@pool/shared';
import { useAuthStore } from '@/stores/auth';
import { useDataStore } from '@/stores/data';
import { gettingStartedHidden, hideGettingStarted, installed } from '@/lib/welcome';

/**
 * Beta onboarding for owners: a checklist on the Route (and the dashboard) that ticks itself from the
 * business's own data. Hidden when everything is done, or with Hide (this device, this person).
 */
defineOptions({ name: 'GettingStartedCard' });
const props = defineProps<{ desk?: boolean }>();
const router = useRouter();
const auth = useAuthStore();
const data = useDataStore();
const hidden = ref(gettingStartedHidden(auth.me?._id));

interface Step {
  id: string;
  label: string;
  hint?: string | undefined;
  done: boolean;
  to: RouteLocationRaw;
}
const steps = computed<Step[]>(() => {
  const s = data.settings;
  const d = props.desk ? '/desk' : '/more';
  const customers = data.customers;
  const list: Step[] = [
    { id: 'business', label: t('Your business details'), hint: t('Name, phone or email, payment instructions'), done: !!s?.businessName && !!(s.phone || s.email), to: `${d}/business` },
    { id: 'logo', label: t('Your logo'), hint: t('It becomes the app’s icon too'), done: !!s?.logoDataUrl, to: `${d}/business` },
    { id: 'prices', label: t('Chemical prices'), hint: t('For your costs; never shown to customers'), done: data.activeChemicals.some((c) => (c.price ?? 0) > 0), to: `${d}/chemicals` },
    { id: 'customers', label: t('Add your customers'), hint: props.desk ? t('Or import them from a spreadsheet') : undefined, done: customers.length > 0, to: props.desk ? '/desk/customers' : '/customers' },
    { id: 'route', label: t('Put pools on the route'), hint: t('A weekly service day or a one-time date'), done: data.pools.some((p) => !!p.serviceDay || !!p.oneTimeDate), to: props.desk ? '/desk/customers' : '/customers' },
    { id: 'rates', label: t('Monthly rates'), hint: t('Needed for invoices'), done: customers.some((c) => customerStatus(c) === 'current' && (c.monthlyRate ?? 0) > 0), to: props.desk ? '/desk/customers' : '/customers' },
    { id: 'team', label: t('Add your techs'), hint: t('Skip this if you work alone'), done: auth.team.length > 1, to: `${d}/team` },
  ];
  if (!props.desk) list.push({ id: 'install', label: t('Install the app on your phone'), hint: t('See Help → Getting started'), done: installed(), to: { name: 'help', params: { topic: 'start' } } });
  return list;
});
const doneCount = computed(() => steps.value.filter((s) => s.done).length);
const show = computed(() => auth.isOwner && data.loaded && !hidden.value && doneCount.value < steps.value.length);

function hide() {
  hideGettingStarted(auth.me?._id);
  hidden.value = true;
}
</script>
