<template>
  <q-page class="q-pa-md column q-gutter-md">
    <Teleport defer to="#header-actions">
      <q-btn flat round icon="person_add" :aria-label="$t(`New customer`)" to="/customers/new" data-test="new-customer" />
    </Teleport>

    <q-input v-model="search" outlined dense clearable :placeholder="$t(`Search name, address or phone`)" data-test="customer-search">
      <template #prepend><q-icon name="search" /></template>
    </q-input>

    <q-btn-toggle
      v-if="!searching"
      v-model="ui.customerFilter"
      spread
      no-caps
      unelevated
      dense
      toggle-color="primary"
      color="grey-3"
      text-color="grey-9"
      data-test="customer-filter"
      :options="filterOptions"
    />
    <div v-else class="text-caption text-grey-7">{{ $t(`Searching all customers (current, prospects and past)`) }}</div>

    <div v-if="!data.loaded && data.loading" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>
    <div v-else-if="!filtered.length" class="text-center text-grey-7 q-pa-md">
      {{ searching ? $t('No matches.') : data.customers.length ? FILTER_EMPTY[ui.customerFilter] : $t('No customers yet.') }}
      <div v-if="!searching" class="q-mt-md"><q-btn color="primary" unelevated :label="$t(`Add customer`)" to="/customers/new" /></div>
    </div>
    <q-list v-else bordered separator class="bg-white rounded-borders" data-test="customer-list">
      <q-item v-for="c in filtered" :key="c._id" clickable :to="`/customers/${c._id}`" :data-test="`customer-${c._id}`">
        <q-item-section avatar>
          <q-avatar color="primary" text-color="white" size="40px">{{ initials(c.name) }}</q-avatar>
        </q-item-section>
        <q-item-section>
          <q-item-label class="text-weight-medium">{{ c.name }}</q-item-label>
          <q-item-label caption>{{ shortAddress(c) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge v-if="customerStatus(c) !== 'current'" :color="STATUS_COLOR[customerStatus(c)]" :label="STATUS_LABEL[customerStatus(c)]" class="q-mb-xs" :data-test="`status-${c._id}`" />
          <q-item-label caption>{{ poolCount(c._id) }} pool{{ poolCount(c._id) === 1 ? '' : 's' }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { t, translated } from '@/i18n';
import { computed, ref } from 'vue';
import { customerStatus, type CustomerStatus } from '@pool/shared';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { addressText } from '@/lib/format';
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/customer';
import type { Customer } from '@/lib/types';

defineOptions({ name: 'CustomersPage' });

const data = useDataStore();
const ui = useUiStore();
const search = ref<string | null>('');
const searching = computed(() => !!(search.value ?? '').trim());

const FILTER_EMPTY: Record<CustomerStatus | 'all', string> = translated({ current: 'No current customers.', prospect: 'No prospects.', past: 'No past customers.', all: 'No customers.' });
const count = (s: CustomerStatus) => data.customers.filter((c) => customerStatus(c) === s).length;
const filterOptions = computed(() => [
  { label: t('Current {n}', { n: count('current') }), value: 'current' },
  { label: t('Prospects {n}', { n: count('prospect') }), value: 'prospect' },
  { label: t('Past {n}', { n: count('past') }), value: 'past' },
  { label: t('All {n}', { n: data.customers.length }), value: 'all' },
]);

const shortAddress = (c: Customer) => [c.address?.line1, c.address?.city].filter((x) => x?.trim()).join(', ');

const filtered = computed(() => {
  const q = (search.value ?? '').trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const sorted = [...data.customers].sort((a, b) => a.name.localeCompare(b.name));
  // A search looks through every class, so nobody is "lost" behind the filter.
  if (!q) return ui.customerFilter === 'all' ? sorted : sorted.filter((c) => customerStatus(c) === ui.customerFilter);
  const list = sorted;
  return list.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      addressText(c.address).toLowerCase().includes(q) ||
      (digits.length >= 3 && c.phones.some((p) => p.number.includes(digits))),
  );
});

const poolCount = (id: string) => data.pools.filter((p) => p.customerId === id).length;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
</script>
