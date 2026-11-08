<template>
  <q-page class="q-pa-md column q-gutter-md">
    <Teleport defer to="#header-actions">
      <q-btn v-if="customer" flat round icon="edit" aria-label="Edit customer" :to="`/customers/${customer._id}/edit`" data-test="edit-customer" />
    </Teleport>

    <div v-if="!customer" class="flex flex-center q-pa-xl">
      <q-spinner v-if="!data.loaded" size="40px" color="primary" />
      <div v-else class="text-grey-7">Customer not found.</div>
    </div>
    <template v-else>
      <ContactLinks :customer="customer" :address="customer.address" />
      <div v-if="customer.notes" class="text-body2 text-grey-8 q-px-sm"><q-icon name="info" /> {{ customer.notes }}</div>

      <div>
        <div class="row items-center justify-between q-mb-xs">
          <div class="text-subtitle1">Pools</div>
          <q-btn flat dense no-caps color="primary" icon="add" label="Add pool" :to="`/customers/${customer._id}/pools/new`" data-test="add-pool" />
        </div>
        <q-list v-if="pools.length" bordered separator class="bg-white rounded-borders">
          <q-item v-for="p in pools" :key="p._id" clickable :to="`/pools/${p._id}/overview`" :data-test="`pool-${p._id}`">
            <q-item-section avatar><q-icon name="pool" color="primary" /></q-item-section>
            <q-item-section>
              <q-item-label>{{ p.name }}<span v-if="!p.active" class="text-grey-6"> (inactive)</span></q-item-label>
              <q-item-label caption>{{ DAY_LABELS[p.serviceDay] }} · {{ p.type }} · {{ p.volumeGal.toLocaleString() }} gal</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat round color="primary" icon="assignment" aria-label="Log visit" :to="`/pools/${p._id}`" @click.stop />
            </q-item-section>
          </q-item>
        </q-list>
        <div v-else class="text-grey-6 text-body2">No pools yet.</div>
      </div>

      <div>
        <div class="text-subtitle1 q-mb-xs">Notes</div>
        <NotesList parent-type="customer" :parent-id="customer._id" />
      </div>
    </template>
  </q-page>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import ContactLinks from '@/components/ContactLinks.vue';
import NotesList from '@/components/NotesList.vue';
import { useDataStore } from '@/stores/data';
import { useUiStore } from '@/stores/ui';
import { DAY_LABELS } from '@/lib/format';

defineOptions({ name: 'CustomerPage' });

const route = useRoute();
const data = useDataStore();
const ui = useUiStore();
const customer = computed(() => data.customerById.get(String(route.params.id)));
const pools = computed(() => data.pools.filter((p) => p.customerId === customer.value?._id));

watch(
  customer,
  (c) => {
    if (c) ui.setTitle(c.name);
  },
  { immediate: true },
);
</script>
