<template>
  <!-- A card's table: same columns everywhere; full screen can hide columns and export it. -->
  <q-markup-table flat dense class="card-table bg-transparent" :data-test="testId">
    <thead>
      <tr>
        <th v-for="c in shownCols" :key="c.key" :class="`text-${c.align ?? 'left'}`">{{ c.label }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-if="!rows.length">
        <td :colspan="shownCols.length" class="text-grey-7">{{ empty }}</td>
      </tr>
      <tr v-for="(r, i) in rows" :key="i" :class="{ 'cursor-pointer': clickable }" @click="clickable && emit('row', r)">
        <td v-for="c in shownCols" :key="c.key" :class="[`text-${c.align ?? 'left'}`, c.money && typeof r[c.key] === 'number' && (r[c.key] as number) < 0 ? 'text-negative' : '', c.class ?? '']">
          {{ show(c, r[c.key]) }}
        </td>
      </tr>
    </tbody>
  </q-markup-table>
</template>

<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { formatMoney, useDashTools } from '@/composables/useDashTools';

export interface CardColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** Money: shown in the chosen number format. */
  money?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<{ name: string; columns: CardColumn[]; rows: Record<string, unknown>[]; empty?: string; clickable?: boolean; testId?: string }>(), {
  empty: 'Nothing here.',
  clickable: false,
  testId: 'card-table',
});
const emit = defineEmits<{ row: [r: Record<string, unknown>] }>();
const tools = useDashTools();

const shownCols = computed(() => props.columns.filter((c) => !tools.hiddenCols.includes(c.key)));
const show = (c: CardColumn, v: unknown) => (v == null || v === '' ? '' : c.money && typeof v === 'number' ? formatMoney(v, tools.format) : String(v));

// Full screen offers Columns and Export for this table.
watchEffect(() => {
  tools.table = { name: props.name, columns: props.columns.map((c) => ({ key: c.key, label: c.label, ...(c.money && { money: true }) })), rows: props.rows };
});
</script>

<style scoped>
.card-table :deep(td),
.card-table :deep(th) {
  font-variant-numeric: tabular-nums;
}
</style>
