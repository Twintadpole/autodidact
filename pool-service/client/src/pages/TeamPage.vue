<template>
  <q-page class="q-pa-md column q-gutter-md" data-test="team-page">
    <div class="row items-center">
      <div class="text-caption text-grey-8 col">
        {{ $t(`Techs see their own route (the pools assigned to them) without any money. Owners see everything.`) }}
      </div>
      <q-btn color="primary" unelevated no-caps icon="person_add" :label="$t(`Add a login`)" data-test="team-add" @click="addOpen = true" />
    </div>

    <q-list bordered separator class="bg-white rounded-borders" data-test="team-list">
      <q-item v-for="m in members" :key="m._id" :class="{ 'text-grey-6': !m.active }" :data-test="`team-member-${m.email}`">
        <q-item-section>
          <q-item-label>
            {{ m.name }}
            <q-badge :color="m.role === 'owner' ? 'primary' : 'teal'" :label="m.role === 'owner' ? $t('Owner') : $t('Tech')" class="q-ml-xs" />
            <q-badge v-if="!m.active" color="grey-6" :label="$t(`Off`)" class="q-ml-xs" />
            <q-badge v-else-if="m.mustChangePassword" outline color="orange-9" :label="$t(`Temporary password`)" class="q-ml-xs" />
          </q-item-label>
          <q-item-label caption>{{ m.email }}</q-item-label>
          <q-item-label caption>
            <template v-if="m.role === 'tech'">{{ $tn(routeCount(m._id), '{n} pool on the route', '{n} pools on the route') }} · </template>
            {{ $t('Last login {date}', { date: m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString(locale) : $t('never') }) }}<template v-if="m.activeMonths.includes(thisMonth)"> {{ $t(`· active this month`) }}</template>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <div class="row q-gutter-xs">
            <q-btn v-if="m.role === 'tech' && m.active" flat dense no-caps icon="route" :label="$t(`Route`)" :data-test="`team-route-${m.email}`" @click="openRoute(m)" />
            <q-btn flat dense round icon="more_vert" :data-test="`team-menu-${m.email}`">
              <q-menu auto-close>
                <q-list dense style="min-width: 200px">
                  <q-item clickable :data-test="`team-reset-${m.email}`" @click="resetPassword(m)"><q-item-section>{{ $t(`New temporary password`) }}</q-item-section></q-item>
                  <q-item v-if="m.active" clickable @click="patch(m, { role: m.role === 'owner' ? 'tech' : 'owner' })">
                    <q-item-section>{{ m.role === 'owner' ? $t('Make a tech') : $t('Make an owner') }}</q-item-section>
                  </q-item>
                  <q-item clickable :data-test="`team-active-${m.email}`" @click="toggleActive(m)">
                    <q-item-section :class="m.active ? 'text-negative' : ''">{{ m.active ? $t('Turn this login off') : $t('Turn this login on') }}</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </div>
        </q-item-section>
      </q-item>
    </q-list>

    <!-- Add -->
    <q-dialog v-model="addOpen">
      <q-card style="width: 420px; max-width: 95vw">
        <q-form @submit.prevent="add">
          <q-card-section class="text-h6">{{ $t(`Add a login`) }}</q-card-section>
          <q-card-section class="q-gutter-sm">
            <q-input v-model="draft.name" outlined dense :label="$t(`Name`)" data-test="team-new-name" />
            <q-input v-model="draft.email" outlined dense type="email" :label="$t(`Email (their login)`)" autocapitalize="off" data-test="team-new-email" />
            <q-btn-toggle v-model="draft.role" no-caps unelevated toggle-color="primary" :options="[{ label: $t('Tech'), value: 'tech' }, { label: $t('Owner'), value: 'owner' }]" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat no-caps :label="$t(`Cancel`)" v-close-popup />
            <q-btn type="submit" color="primary" unelevated no-caps :label="$t(`Add`)" :disable="!draft.name.trim() || !draft.email.trim()" :loading="busy" data-test="team-new-save" />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>

    <!-- Temporary password, shown once -->
    <q-dialog v-model="pwOpen" persistent>
      <q-card style="width: 420px; max-width: 95vw" data-test="team-temp-password">
        <q-card-section class="text-h6">Temporary password for {{ pwFor }}</q-card-section>
        <q-card-section>
          <div class="text-h5 text-weight-bold q-pa-sm bg-grey-2 rounded-borders text-center" style="letter-spacing: 1px; font-family: monospace" data-test="team-temp-value">{{ pw }}</div>
          <div class="text-caption text-grey-8 q-mt-sm">{{ $t(`Give it to them in person or by text. It's shown only now; they choose their own password when they first log in.`) }}</div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps icon="content_copy" :label="$t(`Copy`)" @click="copy" />
          <q-btn color="primary" unelevated no-caps :label="$t(`Done`)" data-test="team-temp-done" @click="closePassword" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Route: which pools are on this tech's route -->
    <q-dialog v-model="routeOpen">
      <q-card style="width: 560px; max-width: 95vw" data-test="team-route-dialog">
        <q-card-section class="row items-center">
          <div class="text-h6 col">{{ routeFor?.name }}'s route</div>
          <q-input v-model="routeSearch" dense outlined clearable :placeholder="$t(`Search`)" style="width: 180px" />
        </q-card-section>
        <q-card-section class="q-pt-none text-caption text-grey-8">{{ $t(`Tick the pools this tech services. A pool is on one route at a time; ticking one moves it here.`) }}</q-card-section>
        <q-card-section class="q-pt-none" style="max-height: 55vh; overflow: auto">
          <div v-for="g in routeGroups" :key="g.label" class="q-mb-sm">
            <div class="text-subtitle2 text-grey-8">{{ g.label }}</div>
            <q-item v-for="p in g.pools" :key="p._id" dense tag="label" class="q-px-none" :data-test="`route-pool-${p._id}`">
              <q-item-section avatar><q-checkbox v-model="picked" :val="p._id" dense /></q-item-section>
              <q-item-section>
                <q-item-label>{{ p.customer }} · {{ p.name }}</q-item-label>
                <q-item-label v-if="p.techId && p.techId !== routeFor?._id" caption class="text-orange-9">now on {{ auth.memberName(p.techId) }}'s route</q-item-label>
              </q-item-section>
            </q-item>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps :label="$t(`Cancel`)" v-close-popup />
          <q-btn color="primary" unelevated no-caps :label="$t(`Save route`)" :loading="busy" data-test="team-route-save" @click="saveRoute" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { locale, t, tn } from '@/i18n';
import { computed, onMounted, reactive, ref } from 'vue';
import { useQuasar, copyToClipboard } from 'quasar';
import type { Role, TeamMemberFull } from '@pool/shared';
import { api, errorMessage } from '@/stores/api';
import { useAuthStore } from '@/stores/auth';
import { useDataStore } from '@/stores/data';
import { useSyncStore } from '@/stores/sync';
import { DAY_LABELS } from '@/lib/format';

defineOptions({ name: 'TeamPage' });
const $q = useQuasar();
const auth = useAuthStore();
const data = useDataStore();

const members = ref<TeamMemberFull[]>([]);
const busy = ref(false);
const addOpen = ref(false);
const draft = reactive({ name: '', email: '', role: 'tech' as Role });
const pwOpen = ref(false);
const pw = ref('');
const pwFor = ref('');
const routeOpen = ref(false);
const routeFor = ref<TeamMemberFull | null>(null);
const routeSearch = ref('');
const picked = ref<string[]>([]);
const thisMonth = new Date().toISOString().slice(0, 7);

const fail = (err: unknown) => $q.notify({ type: 'negative', message: errorMessage(err) });
const routeCount = (id: string) => data.pools.filter((p) => p.techId === id).length;

async function load() {
  try {
    members.value = await api<TeamMemberFull[]>('/team');
    auth.setTeam(members.value.map(({ _id, name, role, active }) => ({ _id, name, role, active })));
  } catch (err) {
    fail(err);
  }
}
async function add() {
  busy.value = true;
  try {
    const r = await api<{ member: TeamMemberFull; password: string }>('/team', { method: 'POST', body: { ...draft, email: draft.email.trim(), name: draft.name.trim() } });
    addOpen.value = false;
    Object.assign(draft, { name: '', email: '', role: 'tech' });
    showPassword(r.member.name, r.password);
    await load();
  } catch (err) {
    fail(err);
  } finally {
    busy.value = false;
  }
}
function showPassword(name: string, value: string) {
  pwFor.value = name;
  pw.value = value;
  pwOpen.value = true;
}
function closePassword() {
  pwOpen.value = false;
  pw.value = '';
}
function copy() {
  void copyToClipboard(pw.value).then(() => $q.notify({ message: t('Copied'), timeout: 1200 }));
}
function resetPassword(m: TeamMemberFull) {
  $q.dialog({ title: t('New temporary password for {name}?', { name: m.name }), message: t('Their devices are signed out; they log in with the new one and choose their own.'), cancel: true, ok: { label: t('Make one'), unelevated: true, noCaps: true } }).onOk(async () => {
    try {
      const r = await api<{ password: string }>(`/team/${m._id}/reset-password`, { method: 'POST' });
      showPassword(m.name, r.password);
      await load();
    } catch (err) {
      fail(err);
    }
  });
}
async function patch(m: TeamMemberFull, body: Partial<Pick<TeamMemberFull, 'role' | 'active' | 'name' | 'email'>>) {
  try {
    await api(`/team/${m._id}`, { method: 'PATCH', body });
    await load();
  } catch (err) {
    fail(err);
  }
}
function toggleActive(m: TeamMemberFull) {
  if (!m.active) return void patch(m, { active: true });
  $q.dialog({ title: t('Turn off {name}’s login?', { name: m.name }), message: t('They are signed out everywhere and can’t log in. Their pools stay on their route until you move them. You can turn it on again.'), cancel: true, ok: { label: t('Turn off'), color: 'negative', unelevated: true, noCaps: true } }).onOk(() => void patch(m, { active: false }));
}

// ---------------------------------------------------------------- route
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const routeGroups = computed(() => {
  const q = (routeSearch.value ?? '').toLowerCase();
  const byCustomer = new Map(data.customers.map((c) => [c._id, c.name]));
  const pools = data.pools
    .filter((p) => byCustomer.has(p.customerId))
    .map((p) => ({ ...p, customer: byCustomer.get(p.customerId)! }))
    .filter((p) => !q || `${p.customer} ${p.name}`.toLowerCase().includes(q));
  const groups = DAY_ORDER.map((d) => ({ label: DAY_LABELS[d], pools: pools.filter((p) => p.serviceDay === d) }));
  groups.push({ label: t('One-time or not scheduled'), pools: pools.filter((p) => !p.serviceDay) });
  for (const g of groups) g.pools.sort((a, b) => (a.routeOrder ?? 0) - (b.routeOrder ?? 0) || a.customer.localeCompare(b.customer));
  return groups.filter((g) => g.pools.length);
});
function openRoute(m: TeamMemberFull) {
  routeFor.value = m;
  routeSearch.value = '';
  picked.value = data.pools.filter((p) => p.techId === m._id).map((p) => p._id);
  routeOpen.value = true;
}
async function saveRoute() {
  const tech = routeFor.value!;
  const before = new Set(data.pools.filter((p) => p.techId === tech._id).map((p) => p._id));
  const after = new Set(picked.value);
  const add = [...after].filter((id) => !before.has(id));
  const remove = [...before].filter((id) => !after.has(id));
  busy.value = true;
  try {
    if (add.length) await api('/pools/assign', { method: 'POST', body: { poolIds: add, techId: tech._id } });
    if (remove.length) await api('/pools/assign', { method: 'POST', body: { poolIds: remove, techId: null } });
    routeOpen.value = false;
    await useSyncStore().kick({ force: true });
    $q.notify({ type: 'positive', message: tn(after.size, '{name}’s route: {n} pool', '{name}’s route: {n} pools', { name: tech.name }) });
  } catch (err) {
    fail(err);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>
