<template>
  <q-page padding class="column q-gutter-md">
    <!-- Status -->
    <q-card flat bordered>
      <q-card-section class="q-pb-sm">
        <div class="text-h6">Test version</div>
        <div class="text-body2 text-grey-8">
          The real screens arrive in Phase 3. This page checks the server, login and data sync end to end.
        </div>
      </q-card-section>
      <q-card-section class="row items-center q-gutter-sm q-pt-none">
        <q-chip :color="health.status === 'ok' ? 'positive' : health.status === 'down' ? 'negative' : 'grey'" text-color="white" icon="dns" data-test="api-chip">
          API: {{ health.status }}
        </q-chip>
        <q-chip :color="health.mongo ? 'positive' : 'grey'" text-color="white" icon="storage" data-test="db-chip">
          Database: {{ health.mongo ? 'ok' : 'down' }}
        </q-chip>
        <q-chip :color="health.loggedIn ? 'primary' : 'grey'" text-color="white" icon="person" data-test="auth-chip">
          {{ health.loggedIn ? 'Logged in' : 'Logged out' }}
        </q-chip>
      </q-card-section>
    </q-card>

    <!-- Login -->
    <q-card v-if="!health.loggedIn" flat bordered>
      <q-form @submit.prevent="doLogin">
        <q-card-section class="q-gutter-md">
          <div class="text-subtitle1">Log in</div>
          <q-input
            v-model="password"
            type="password"
            label="App password"
            outlined
            autocomplete="current-password"
            data-test="password"
            :error="!!loginError"
            :error-message="loginError"
          />
          <q-toggle v-model="remember" label="Remember this device (90 days)" />
        </q-card-section>
        <q-card-actions class="q-px-md q-pb-md">
          <q-btn type="submit" color="primary" unelevated size="lg" class="full-width" label="Log in" :loading="busy" data-test="login" />
        </q-card-actions>
      </q-form>
    </q-card>

    <template v-else>
      <!-- Chemicals -->
      <q-card flat bordered>
        <q-card-section class="q-pb-none">
          <div class="text-subtitle1">Chemicals in the database ({{ chemicals.length }})</div>
        </q-card-section>
        <q-list dense data-test="chemicals">
          <q-item v-for="c in chemicals" :key="c._id">
            <q-item-section>{{ c.name }}</q-item-section>
            <q-item-section side>{{ c.defaultUnit }}</q-item-section>
          </q-item>
        </q-list>
      </q-card>

      <!-- Sync test -->
      <q-card flat bordered>
        <q-card-section>
          <div class="text-subtitle1">Sync test</div>
          <div class="text-body2 text-grey-8">
            Sends one visit for a demo pool twice, the way the phone retries when signal drops. The server should apply it
            once and report the second as a duplicate.
          </div>
        </q-card-section>
        <q-list v-if="steps.length" separator data-test="sync-steps">
          <q-item v-for="(s, i) in steps" :key="i">
            <q-item-section avatar>
              <q-icon :name="s.ok ? 'check_circle' : 'error'" :color="s.ok ? 'positive' : 'negative'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ s.label }}</q-item-label>
              <q-item-label caption>{{ s.detail }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
        <q-banner v-if="syncVerdict" :class="syncVerdict.ok ? 'bg-green-1 text-positive' : 'bg-red-1 text-negative'" data-test="sync-verdict">
          {{ syncVerdict.text }}
        </q-banner>
        <q-card-actions class="q-pa-md q-gutter-sm">
          <q-btn color="primary" unelevated size="lg" class="col" icon="sync" label="Run sync test" :loading="busy" data-test="sync-test" @click="runSyncTest" />
          <q-btn flat color="grey-8" icon="delete_sweep" label="Reset demo" :disable="busy" data-test="reset-demo" @click="resetDemo" />
        </q-card-actions>
      </q-card>

      <q-btn flat color="grey-8" icon="logout" label="Log out" data-test="logout" @click="doLogout" />
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useHealthStore } from '@/stores/health';
import { api, ApiError } from '@/stores/api';

defineOptions({ name: 'IndexPage' });

interface Chemical { _id: string; name: string; defaultUnit: string }
interface Doc { _id: string; name?: string }
interface PackageResult { duplicate: boolean; applied: { visit: number } }
interface Step { label: string; detail: string; ok: boolean }

const DEMO_CUSTOMER = 'Demo customer (sync test)';

const $q = useQuasar();
const health = useHealthStore();
const password = ref('');
const remember = ref(true);
const loginError = ref('');
const busy = ref(false);
const chemicals = ref<Chemical[]>([]);
const steps = ref<Step[]>([]);

const syncVerdict = computed(() => {
  if (steps.value.length < 4) return null;
  const ok = steps.value.every((s) => s.ok);
  return { ok, text: ok ? 'Sync works: applied once, retry was safe.' : 'Sync test failed: see the step marked red.' };
});

async function loadChemicals() {
  chemicals.value = await api<Chemical[]>('/chemicals?active=true');
}

async function doLogin() {
  busy.value = true;
  loginError.value = '';
  try {
    await health.login(password.value, remember.value);
    password.value = '';
  } catch (err) {
    loginError.value = err instanceof ApiError && err.status === 429 ? 'Too many attempts. Wait 15 minutes.' : 'Wrong password';
  } finally {
    busy.value = false;
  }
}

async function doLogout() {
  await health.logout();
  steps.value = [];
}

async function demoPool(): Promise<string> {
  const customers = await api<Doc[]>('/customers');
  let customer = customers.find((c) => c.name === DEMO_CUSTOMER);
  customer ??= await api<Doc>('/customers', {
    method: 'POST',
    body: {
      name: DEMO_CUSTOMER,
      phones: [{ label: 'demo', number: '+15555550100' }],
      address: { line1: '100 Demo St', city: 'Dallas', state: 'TX', zip: '75201' },
      notes: 'Created by the sync test. Safe to delete.',
    },
  });
  const pools = await api<Doc[]>(`/pools?customerId=${customer._id}`);
  const pool =
    pools[0] ??
    (await api<Doc>('/pools', {
      method: 'POST',
      body: { customerId: customer._id, name: 'Demo pool', type: 'chlorine', volumeGal: 15000, serviceDay: 'mon' },
    }));
  return pool._id;
}

async function runSyncTest() {
  busy.value = true;
  steps.value = [];
  const add = (label: string, detail: string, ok: boolean) => steps.value.push({ label, detail, ok });
  try {
    const poolId = await demoPool();
    add('Demo pool ready', `pool ${poolId.slice(0, 8)}…`, true);

    const chem = chemicals.value.find((c) => c.name === 'Liquid chlorine') ?? chemicals.value[0];
    const now = new Date().toISOString();
    const visitId = crypto.randomUUID();
    const pkg = {
      packageId: crypto.randomUUID(),
      poolId,
      createdAt: now,
      visit: {
        _id: visitId,
        poolId,
        visitedAt: now,
        createdAt: now,
        updatedAt: now,
        readings: { fc: 3, ph: 7.5, ta: 90 },
        doses: chem ? [{ chemicalId: chem._id, amount: 1, unit: chem.defaultUnit }] : [],
        tasks: { brushed: true, skimmed: true },
        notes: 'Sync test visit',
      },
    };

    const first = await api<PackageResult>('/sync/package', { method: 'POST', body: pkg });
    add('First send', first.duplicate ? 'server said duplicate (unexpected)' : `applied: ${first.applied.visit} visit`, !first.duplicate && first.applied.visit === 1);

    const second = await api<PackageResult>('/sync/package', { method: 'POST', body: pkg });
    add('Same package sent again (retry)', second.duplicate ? 'server said duplicate: nothing applied twice' : 'applied again (bad)', second.duplicate);

    const visits = await api<Doc[]>(`/pools/${poolId}/visits?limit=100`);
    const copies = visits.filter((v) => v._id === visitId).length;
    add('Visits stored for this send', `${copies} (expected 1); demo pool has ${visits.length} visit(s) total`, copies === 1);
  } catch (err) {
    add('Error', err instanceof Error ? err.message : String(err), false);
  } finally {
    busy.value = false;
  }
}

async function resetDemo() {
  busy.value = true;
  try {
    const customers = (await api<Doc[]>('/customers')).filter((c) => c.name === DEMO_CUSTOMER);
    for (const c of customers) {
      for (const p of await api<Doc[]>(`/pools?customerId=${c._id}`)) await api(`/pools/${p._id}`, { method: 'DELETE' });
      await api(`/customers/${c._id}`, { method: 'DELETE' });
    }
    steps.value = [];
    $q.notify({ message: customers.length ? 'Demo data removed' : 'No demo data to remove', color: 'grey-8' });
  } finally {
    busy.value = false;
  }
}

watch(
  () => health.loggedIn,
  (loggedIn) => {
    if (loggedIn) void loadChemicals();
  },
);

onMounted(async () => {
  await health.check();
  if (health.loggedIn) await loadChemicals();
});
</script>
