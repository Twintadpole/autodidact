<template>
  <q-page class="q-pa-md column q-gutter-md">
    <Teleport defer to="#header-actions">
      <q-btn flat round icon="person_add" aria-label="New customer" to="/customers/new" data-test="new-customer" />
    </Teleport>

    <q-input v-model="search" outlined dense clearable placeholder="Search name, address or phone" data-test="customer-search">
      <template #prepend><q-icon name="search" /></template>
    </q-input>

    <div v-if="!data.loaded && data.loading" class="flex flex-center q-pa-xl"><q-spinner size="40px" color="primary" /></div>
    <div v-else-if="!filtered.length" class="text-center text-grey-7 q-pa-md">
      {{ search ? 'No matches.' : 'No customers yet.' }}
      <div v-if="!search" class="q-mt-md"><q-btn color="primary" unelevated label="Add customer" to="/customers/new" /></div>
    </div>
    <q-list v-else bordered separator class="bg-white rounded-borders" data-test="customer-list">
      <q-item v-for="c in filtered" :key="c._id" clickable :to="`/customers/${c._id}`" :data-test="`customer-${c._id}`">
        <q-item-section avatar>
          <q-avatar color="primary" text-color="white" size="40px">{{ initials(c.name) }}</q-avatar>
        </q-item-section>
        <q-item-section>
          <q-item-label class="text-weight-medium">{{ c.name }}</q-item-label>
          <q-item-label caption>{{ c.address.line1 }}, {{ c.address.city }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-item-label caption>{{ poolCount(c._id) }} pool{{ poolCount(c._id) === 1 ? '' : 's' }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDataStore } from '@/stores/data';
import { addressText } from '@/lib/format';

defineOptions({ name: 'CustomersPage' });

const data = useDataStore();
const search = ref<string | null>('');

const filtered = computed(() => {
  const q = (search.value ?? '').trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const list = [...data.customers].sort((a, b) => a.name.localeCompare(b.name));
  if (!q) return list;
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
