<template>
  <div class="desk-table column q-gutter-sm">
    <!-- Toolbar: search, the page's own filters, columns -->
    <div class="row items-center q-gutter-sm no-wrap">
      <q-input v-model="search" dense outlined clearable debounce="150" placeholder="Search" class="desk-search" data-test="table-search">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <slot name="filters" />
      <q-space />
      <slot name="actions" />
      <q-btn flat dense no-caps icon="view_column" label="Columns" data-test="table-columns">
        <q-menu>
          <q-list dense style="min-width: 200px">
            <q-item v-for="c in hideable" :key="c.name" tag="label" clickable>
              <q-item-section side><q-checkbox :model-value="visible.includes(c.name)" dense @update:model-value="toggle(c.name)" /></q-item-section>
              <q-item-section>{{ c.label }}</q-item-section>
            </q-item>
            <q-separator />
            <q-item clickable @click="resetColumns"><q-item-section class="text-grey-8">Show the usual columns</q-item-section></q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </div>

    <!-- Quick entry row (pages that add records) -->
    <slot name="quick" />

    <q-table
      v-model:pagination="pagination"
      flat
      bordered
      dense
      :rows="shown"
      :columns="columns"
      :visible-columns="visible"
      :row-key="rowKey"
      :rows-per-page-options="[25, 50, 100, 0]"
      :loading="loading"
      :no-data-label="noData"
      binary-state-sort
      class="desk-q-table"
      :data-test="testId"
      @row-click="(_e: Event, row: Row) => emit('row', row)"
    >
      <template v-for="name in cellSlots" :key="name" #[name]="props">
        <slot :name="name" v-bind="props" />
      </template>
      <template v-if="hasTotals && shown.length" #bottom-row="props">
        <q-tr class="desk-total" data-test="table-total">
          <q-td v-for="col in props.cols" :key="col.name" :class="`text-${col.align ?? 'left'}`">
            <template v-if="col.name === firstVisible">Total · {{ shown.length }} {{ shown.length === 1 ? 'row' : 'rows' }}</template>
            <template v-else-if="sumCols.has(col.name)">{{ formatTotal(col.name) }}</template>
          </q-td>
        </q-tr>
      </template>
    </q-table>
  </div>
</template>

<script setup lang="ts" generic="Row extends Record<string, any>">
import { computed, ref, useSlots, watch } from 'vue';
import type { QTableColumn } from 'quasar';

/** A column; `sum` adds it up in the totals row (over what the search and filters show). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeskColumn<R extends Record<string, any>> = QTableColumn<R> & { sum?: boolean; hidden?: boolean };

const props = withDefaults(
  defineProps<{
    rows: Row[];
    columns: DeskColumn<Row>[];
    rowKey?: string;
    /** Remembers the columns the owner picked, per table, on this computer. */
    storageKey: string;
    loading?: boolean;
    noData?: string;
    sortBy?: string;
    descending?: boolean;
    testId?: string;
  }>(),
  { rowKey: '_id', loading: false, noData: 'Nothing here yet', descending: false, testId: 'desk-table' },
);
const emit = defineEmits<{ row: [row: Row] }>();
const slots = useSlots();

const search = ref('');
const pagination = ref({ sortBy: props.sortBy ?? null, descending: props.descending, page: 1, rowsPerPage: 50 });

/** Value as shown in the cell (field, then format), for search. */
function cellText(col: DeskColumn<Row>, row: Row): string {
  const raw = cellValue(col, row);
  const shown = col.format ? col.format(raw, row) : raw;
  return shown == null ? '' : String(shown);
}
function cellValue(col: DeskColumn<Row>, row: Row): unknown {
  return typeof col.field === 'function' ? col.field(row) : (row as Record<string, unknown>)[col.field as string];
}

const shown = computed(() => {
  const q = (search.value ?? '').trim().toLowerCase();
  if (!q) return props.rows;
  const words = q.split(/\s+/);
  return props.rows.filter((r) => {
    const text = props.columns.map((c) => cellText(c, r)).join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
});
watch(search, () => (pagination.value.page = 1));

// ---- columns the owner can show/hide
const defaults = () => props.columns.filter((c) => !c.hidden).map((c) => c.name);
const key = computed(() => `pool:cols:${props.storageKey}`);
function loadVisible(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key.value) ?? 'null') as string[] | null;
    if (Array.isArray(saved)) return saved.filter((n) => props.columns.some((c) => c.name === n));
  } catch {
    // ignore
  }
  return defaults();
}
const visible = ref<string[]>(loadVisible());
const required = computed(() => props.columns.filter((c) => c.required).map((c) => c.name));
const hideable = computed(() => props.columns.filter((c) => !c.required));
function toggle(name: string) {
  visible.value = visible.value.includes(name) ? visible.value.filter((n) => n !== name) : [...visible.value, name];
  localStorage.setItem(key.value, JSON.stringify(visible.value));
}
function resetColumns() {
  visible.value = defaults();
  localStorage.removeItem(key.value);
}
const firstVisible = computed(() => props.columns.find((c) => c.required || visible.value.includes(c.name))?.name);

// ---- totals
const sumCols = computed(() => new Set(props.columns.filter((c) => c.sum).map((c) => c.name)));
const hasTotals = computed(() => sumCols.value.size > 0);
function formatTotal(name: string): string {
  const col = props.columns.find((c) => c.name === name)!;
  const cents = shown.value.reduce((t, r) => {
    const v = cellValue(col, r);
    return t + (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : 0);
  }, 0);
  const total = cents / 100;
  return col.format ? String(col.format(total, {} as Row)) : String(total);
}

/** Pass the page's body-cell-* slots on to the table. */
const cellSlots = computed(() => Object.keys(slots).filter((n) => n.startsWith('body-cell')));

defineExpose({ shown, required });
</script>

<style scoped>
.desk-search {
  width: 260px;
}
.desk-q-table :deep(tbody tr) {
  cursor: pointer;
}
.desk-q-table :deep(.desk-total td) {
  font-weight: 600;
  background: #f5f7f9;
  cursor: default;
}
.desk-q-table :deep(th) {
  font-weight: 600;
}
</style>
