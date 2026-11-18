<template>
  <q-page class="q-pa-md">
    <Teleport defer to="#header-actions">
      <q-btn flat no-caps icon="dashboard_customize" label="Cards" data-test="dash-cards">
        <q-menu>
          <q-list dense style="min-width: 240px">
            <q-item-label header>Show on the dashboard</q-item-label>
            <q-item v-for="c in CARDS" :key="c.id" tag="label" clickable :data-test="`dash-show-${c.id}`">
              <q-item-section side><q-checkbox :model-value="!isHidden(c.id)" dense @update:model-value="(v: boolean) => setHidden(c.id, !v)" /></q-item-section>
              <q-item-section avatar style="min-width: 28px"><q-icon :name="c.icon" color="grey-7" size="xs" /></q-item-section>
              <q-item-section>{{ c.title }}</q-item-section>
            </q-item>
            <q-separator />
            <q-item v-close-popup clickable data-test="dash-reset" @click="resetLayout">
              <q-item-section avatar style="min-width: 28px"><q-icon name="restart_alt" size="xs" /></q-item-section>
              <q-item-section>Reset to the usual layout</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </Teleport>

    <div v-if="!shown.length" class="text-center text-grey-7 q-pa-xl">All cards are hidden. Use <b>Cards</b> at the top to show some.</div>

    <div ref="grid" class="dash-grid" :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }" data-test="dash-grid">
      <div
        v-for="c in shown"
        :key="c.id"
        class="dash-cell"
        :class="{ 'drop-target': dropOn === c.id && dragId !== c.id }"
        :style="cellStyle(c.size)"
        :data-test="`cell-${c.id}`"
        @dragover.prevent="dropOn = c.id"
        @dragleave="dropOn = dropOn === c.id ? null : dropOn"
        @drop.prevent="onDrop(c.id)"
      >
        <DashCard
          :id="c.id"
          :title="CARD_BY_ID.get(c.id)!.title"
          :icon="CARD_BY_ID.get(c.id)!.icon"
          :size="c.size"
          @dragstart="dragId = c.id"
          @size="(s) => setSize(c.id, s)"
          @move="(by) => move(c.id, by)"
          @hide="setHidden(c.id, true)"
          @fullscreen="full = c.id"
        >
          <template #default="{ mode, width }">
            <component :is="COMPONENTS[c.id as CardId]" :mode="mode" :width="width" />
          </template>
        </DashCard>
      </div>
    </div>

    <!-- Full screen: the same card with room for everything, and tools to view, filter and export -->
    <q-dialog :model-value="!!full" maximized transition-show="fade" transition-hide="fade" @update:model-value="(v: boolean) => !v && (full = null)">
      <q-card v-if="full" class="column no-wrap bg-grey-1" data-test="dash-fullscreen">
        <div class="row items-center q-gutter-sm q-px-md q-pt-md" data-test="dash-tools">
          <q-select v-if="fullCard?.range" v-model="tools.months" dense outlined emit-value map-options :options="RANGE_OPTIONS" label="Period" style="width: 160px" data-test="tool-range" />
          <q-select
            v-if="fullCard?.customer"
            v-model="tools.customerId"
            dense
            outlined
            emit-value
            map-options
            clearable
            use-input
            input-debounce="0"
            :options="customerOptions"
            label="Customer"
            style="width: 220px"
            data-test="tool-customer"
            @filter="filterCustomers"
          />
          <q-btn-toggle v-model="tools.format" dense no-caps unelevated toggle-color="primary" color="white" text-color="grey-9" :options="FORMAT_OPTIONS" data-test="tool-format" />
          <q-toggle v-model="tools.zoom" dense label="Zoom" data-test="tool-zoom">
            <q-tooltip>Scroll on a chart, or drag the slider under it, to look at part of it</q-tooltip>
          </q-toggle>
          <q-space />
          <template v-if="tools.table">
            <q-btn flat dense no-caps icon="view_column" label="Columns" data-test="tool-columns">
              <q-menu>
                <q-list dense style="min-width: 180px">
                  <q-item v-for="c in tools.table.columns" :key="c.key" tag="label" clickable>
                    <q-item-section side><q-checkbox :model-value="!tools.hiddenCols.includes(c.key)" dense @update:model-value="toggleCol(c.key)" /></q-item-section>
                    <q-item-section>{{ c.label }}</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
            <q-btn flat dense no-caps icon="download" label="Export CSV" data-test="tool-export" @click="downloadCsv(tools.table, tools.hiddenCols)" />
          </template>
        </div>
        <div class="col q-pa-md">
          <DashToolsScope :tools="tools">
            <DashCard :id="full" :title="fullCard!.title" :icon="fullCard!.icon" size="xl" fullscreen :draggable="false">
              <template #head>
                <q-btn flat round dense icon="close_fullscreen" aria-label="Close full screen" data-test="dash-fullscreen-close" @click="full = null" />
              </template>
              <template #default="{ width }">
                <component :is="COMPONENTS[full as CardId]" mode="l" :width="width" />
              </template>
            </DashCard>
          </DashToolsScope>
        </div>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import { useQuasar } from 'quasar';
import type { CardSize, DashboardLayout } from '@pool/shared';
import DashCard from '@/components/desk/DashCard.vue';
import WeekCard from '@/components/desk/cards/WeekCard.vue';
import MoneyCard from '@/components/desk/cards/MoneyCard.vue';
import OwedCard from '@/components/desk/cards/OwedCard.vue';
import HourlyCard from '@/components/desk/cards/HourlyCard.vue';
import ChemicalsCard from '@/components/desk/cards/ChemicalsCard.vue';
import IssuesCard from '@/components/desk/cards/IssuesCard.vue';
import WaterCard from '@/components/desk/cards/WaterCard.vue';
import PipelineCard from '@/components/desk/cards/PipelineCard.vue';
import VisitTimesCard from '@/components/desk/cards/VisitTimesCard.vue';
import MileageCard from '@/components/desk/cards/MileageCard.vue';
import EquipmentCard from '@/components/desk/cards/EquipmentCard.vue';
import SystemCard from '@/components/desk/cards/SystemCard.vue';
import DashToolsScope from '@/components/desk/DashToolsScope.vue';
import { downloadCsv, newDashTools } from '@/composables/useDashTools';
import { useDataStore } from '@/stores/data';
import { errorMessage } from '@/stores/api';
import { CARD_BY_ID, CARDS, defaultLayout, span, withAllCards, type CardId } from '@/lib/dashboard';
import { clone } from '@/lib/format';

defineOptions({ name: 'DeskHomePage' });

const COMPONENTS: Record<CardId, Component> = {
  week: WeekCard,
  money: MoneyCard,
  owed: OwedCard,
  hourly: HourlyCard,
  chemicals: ChemicalsCard,
  issues: IssuesCard,
  water: WaterCard,
  pipeline: PipelineCard,
  visitTimes: VisitTimesCard,
  mileage: MileageCard,
  equipment: EquipmentCard,
  system: SystemCard,
};

const $q = useQuasar();
const data = useDataStore();

// ---- the layout: the owner's saved one (it follows them to any device), else the usual one
const layout = ref<DashboardLayout>(withAllCards(data.dashboard));
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
// Another device changed it (arrives with a sync): follow, unless a change here is about to be saved.
watch(
  () => data.dashboard,
  (d) => {
    if (!pending) layout.value = withAllCards(d);
  },
);
/** Applies a change at once and saves it shortly after (dragging and resizing make several quick changes). */
function change(fn: (l: DashboardLayout) => void) {
  const next = clone(layout.value);
  fn(next);
  layout.value = next;
  pending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save(), 700);
}
async function save() {
  try {
    await data.saveDashboard(layout.value);
  } catch (err) {
    $q.notify({ type: 'negative', message: `Couldn't save the layout: ${errorMessage(err)}` });
  } finally {
    pending = false;
  }
}
onBeforeUnmount(() => {
  if (pending) {
    clearTimeout(saveTimer);
    void save();
  }
});

/** Cards this app knows, in the owner's order, not hidden. */
const shown = computed(() => layout.value.cards.filter((c) => CARD_BY_ID.has(c.id) && !c.hidden));
const isHidden = (id: string) => !!layout.value.cards.find((c) => c.id === id)?.hidden;
const setHidden = (id: string, hidden: boolean) => change((l) => (l.cards.find((c) => c.id === id)!.hidden = hidden));
const setSize = (id: string, size: CardSize) => change((l) => (l.cards.find((c) => c.id === id)!.size = size));
function resetLayout() {
  change((l) => (l.cards = defaultLayout().cards));
}
/** Moves a card past the next shown card in either direction. */
function move(id: string, by: number) {
  const visible = shown.value.map((c) => c.id);
  const target = visible[visible.indexOf(id) + by];
  if (target) moveTo(id, target, by > 0);
}
function moveTo(id: string, target: string, after: boolean) {
  change((l) => {
    const card = l.cards.splice(
      l.cards.findIndex((c) => c.id === id),
      1,
    )[0]!;
    const at = l.cards.findIndex((c) => c.id === target);
    l.cards.splice(after ? at + 1 : at, 0, card);
  });
}

// ---- drag and drop
const dragId = ref<string | null>(null);
const dropOn = ref<string | null>(null);
function onDrop(target: string) {
  const id = dragId.value;
  dragId.value = null;
  dropOn.value = null;
  if (!id || id === target) return;
  const visible = shown.value.map((c) => c.id);
  moveTo(id, target, visible.indexOf(id) < visible.indexOf(target));
}

// ---- grid: as many ~300px columns as fit (1 on a phone, up to 4)
const grid = ref<HTMLDivElement | null>(null);
const cols = ref(4);
let ro: ResizeObserver | undefined;
onMounted(() => {
  ro = new ResizeObserver(([e]) => (cols.value = Math.max(1, Math.min(4, Math.floor((e!.contentRect.width + 12) / 312)))));
  ro.observe(grid.value!);
});
onBeforeUnmount(() => ro?.disconnect());
function cellStyle(size: CardSize) {
  const s = span(size, cols.value);
  return { gridColumn: `span ${s.c}`, gridRow: `span ${s.r}` };
}

// ---- full screen, with fresh tools each time a card is opened
const full = ref<string | null>(null);
const fullCard = computed(() => (full.value ? CARD_BY_ID.get(full.value) : undefined));
const tools = ref(newDashTools());
watch(full, (id) => {
  if (id) tools.value = Object.assign(newDashTools(), { zoom: true });
});
const RANGE_OPTIONS = [3, 6, 12, 24].map((n) => ({ label: `Last ${n} months`, value: n }));
const FORMAT_OPTIONS = [
  { label: '$1,234.56', value: 'exact' },
  { label: '$1,235', value: 'whole' },
  { label: '$1.2k', value: 'short' },
];
function toggleCol(key: string) {
  const h = tools.value.hiddenCols;
  tools.value.hiddenCols = h.includes(key) ? h.filter((k) => k !== key) : [...h, key];
}
const allCustomers = computed(() => data.customers.map((c) => ({ label: c.name, value: c._id })));
const customerOptions = ref(allCustomers.value);
function filterCustomers(val: string, update: (fn: () => void) => void) {
  update(() => {
    const q = val.toLowerCase();
    customerOptions.value = allCustomers.value.filter((o) => o.label.toLowerCase().includes(q));
  });
}
</script>

<style scoped>
.dash-grid {
  display: grid;
  grid-auto-rows: 220px;
  grid-auto-flow: row dense;
  gap: 12px;
}
.dash-cell {
  min-width: 0;
  min-height: 0;
  border-radius: 6px;
}
.drop-target {
  outline: 2px dashed var(--q-primary);
  outline-offset: 2px;
}
</style>

<style>
/* Big figure on a card, and the line under it. */
.dash-grid .hero,
.q-dialog .hero {
  font-size: 1.75rem;
  font-weight: 500;
  line-height: 1.1;
  color: #0b0b0b;
}
.dash-grid .hero-2,
.q-dialog .hero-2 {
  font-size: 1.35rem;
}
.dash-grid .hero-sub,
.q-dialog .hero-sub {
  font-size: 0.8rem;
  color: #52514e;
}
</style>
