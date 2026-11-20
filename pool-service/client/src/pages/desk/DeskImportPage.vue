<template>
  <q-page class="q-pa-md import-page" data-test="desk-import">
    <q-banner dense rounded class="bg-amber-1 text-grey-9 q-mb-md" data-test="import-sync-hint">
      <template #avatar><q-icon name="sync_problem" color="amber-9" /></template>
      Let every phone finish syncing first. A customer changed offline before the import, and sent after it,
      could undo the import's change to that customer.
      <span v-if="pending" class="text-weight-medium"> This device still has {{ pending }} change{{ pending === 1 ? '' : 's' }} to send.</span>
    </q-banner>

    <!-- 1. File -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section class="row items-center q-gutter-md">
        <div class="text-subtitle1 text-weight-medium col-12">1. Choose a file</div>
        <q-file v-model="file" outlined dense accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" label="Excel (.xlsx) or CSV" style="min-width: 320px" clearable data-test="import-file" @update:model-value="onFile">
          <template #prepend><q-icon name="upload_file" /></template>
        </q-file>
        <q-btn flat no-caps icon="download" label="Blank template (CSV)" data-test="import-template" @click="downloadTemplate" />
        <q-inner-loading :showing="reading" />
      </q-card-section>
      <q-card-section v-if="read" class="q-pt-none">
        <div v-if="read.kind === 'app'" class="text-positive" data-test="import-app-file">
          <q-icon name="verified" /> This is the app's own "Export everything" file: its columns are matched for you.
        </div>
        <div v-else class="row items-center q-gutter-sm">
          <q-select v-if="read.sheets.length > 1" v-model="sheet" dense outlined emit-value map-options :options="read.sheets.map((s, i) => ({ label: `${s.name} (${s.rowCount} rows)`, value: i }))" label="Sheet" style="min-width: 240px" data-test="import-sheet" @update:model-value="onSheet" />
          <span class="text-grey-8">{{ currentSheet?.rowCount }} rows in "{{ currentSheet?.name }}"</span>
        </div>
      </q-card-section>
    </q-card>

    <!-- 2. Columns -->
    <q-card v-if="read && read.kind === 'table' && currentSheet" flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-subtitle1 text-weight-medium">2. Match the columns</div>
        <div class="text-caption text-grey-7">Guessed from the headings; change any. Columns not matched to a field go into the customer's notes, unless you choose Ignore.</div>
      </q-card-section>
      <q-markup-table flat dense separator="horizontal" class="q-mx-md q-mb-md" data-test="import-columns">
        <thead>
          <tr><th class="text-left">Column in the file</th><th class="text-left">Examples</th><th class="text-left" style="width: 300px">Goes to</th></tr>
        </thead>
        <tbody>
          <tr v-for="(h, i) in currentSheet.headers" :key="i" :data-test="`import-col-${i}`">
            <td class="text-weight-medium">{{ h }}</td>
            <td class="text-grey-8 ellipsis" style="max-width: 360px">{{ examples(i) }}</td>
            <td>
              <q-select v-model="mapping[i]" dense outlined emit-value map-options :options="FIELD_OPTIONS" options-dense :data-test="`import-map-${i}`" @update:model-value="previewData = null">
                <template #option="scope">
                  <q-item-label v-if="scope.opt.header" header class="q-py-xs">{{ scope.opt.label }}</q-item-label>
                  <q-item v-else v-bind="scope.itemProps"><q-item-section>{{ scope.opt.label }}</q-item-section></q-item>
                </template>
              </q-select>
            </td>
          </tr>
        </tbody>
      </q-markup-table>
    </q-card>

    <!-- 3. Preview -->
    <q-card v-if="read" flat bordered class="q-mb-md">
      <q-card-section class="row items-center q-gutter-sm">
        <div class="text-subtitle1 text-weight-medium">{{ read.kind === 'app' ? 2 : 3 }}. Check what will happen</div>
        <q-space />
        <q-btn color="primary" outline no-caps icon="preview" :label="previewData ? 'Check again' : 'Preview'" :loading="previewing" data-test="import-preview" @click="runPreview" />
      </q-card-section>
      <template v-if="previewData">
        <q-card-section class="q-pt-none row q-gutter-sm" data-test="import-summary">
          <q-chip square color="green-1" text-color="green-9" icon="person_add">{{ s.customersNew }} new customer{{ plural(s.customersNew) }}</q-chip>
          <q-chip square color="blue-1" text-color="blue-9" icon="merge">{{ s.customersMerged }} to update</q-chip>
          <q-chip square color="green-1" text-color="green-9" icon="pool">{{ s.poolsNew }} new pool{{ plural(s.poolsNew) }}</q-chip>
          <q-chip v-if="s.poolsMerged" square color="blue-1" text-color="blue-9" icon="pool">{{ s.poolsMerged }} pool{{ plural(s.poolsMerged) }} to update</q-chip>
          <q-chip v-if="sameCount" square color="grey-3" text-color="grey-8" icon="check">{{ sameCount }} already up to date</q-chip>
          <q-chip v-if="s.conflicts" square color="orange-1" text-color="orange-10" icon="compare_arrows" data-test="import-conflict-count">{{ s.conflicts }} difference{{ plural(s.conflicts) }} to choose</q-chip>
          <q-chip v-if="s.skippedRows" square color="red-1" text-color="red-9" icon="block">{{ s.skippedRows }} row{{ plural(s.skippedRows) }} skipped</q-chip>
        </q-card-section>

        <q-expansion-item v-if="previewData.warnings.length" dense icon="info" :label="`${previewData.warnings.length} note${plural(previewData.warnings.length)} about the file`" header-class="text-orange-10" data-test="import-warnings">
          <q-list dense class="q-px-md q-pb-sm">
            <q-item v-for="(w, i) in previewData.warnings" :key="i" dense>
              <q-item-section avatar class="text-grey-7" style="min-width: 70px">{{ w.row ? `Row ${w.row}` : '' }}</q-item-section>
              <q-item-section>{{ w.message }}</q-item-section>
            </q-item>
          </q-list>
        </q-expansion-item>

        <q-card-section class="row items-center q-gutter-sm">
          <q-btn-toggle v-model="show" dense no-caps unelevated toggle-color="primary" color="grey-3" text-color="grey-9" :options="SHOW_OPTIONS" data-test="import-show" />
          <q-space />
          <template v-if="s.conflicts">
            <q-btn flat dense no-caps label="Keep all of mine" data-test="import-keep-all" @click="take = new Set()" />
            <q-btn flat dense no-caps label="Use the file for all" data-test="import-take-all" @click="takeAll" />
          </template>
        </q-card-section>

        <q-list separator bordered class="q-mx-md q-mb-md rounded-borders" data-test="import-plan">
          <q-item v-if="!shown.length" class="text-grey-7">Nothing to show.</q-item>
          <q-expansion-item v-for="(c, ci) in shown" :key="ci" dense :default-opened="hasConflicts(c)" :data-test="`import-plan-${c.name}`">
            <template #header>
              <q-item-section avatar><q-badge :color="ACTION_COLOR[c.action]" :label="ACTION_LABEL[c.action]" /></q-item-section>
              <q-item-section>
                <q-item-label>{{ c.name }}</q-item-label>
                <q-item-label caption>
                  Row{{ c.rows.length === 1 ? '' : 's' }} {{ c.rows.join(', ') }}<template v-if="c.matchedBy"> · matched by {{ c.matchedBy }}</template>
                  · {{ c.pools.length }} pool{{ plural(c.pools.length) }}
                </q-item-label>
              </q-item-section>
              <q-item-section v-if="conflictsIn(c)" side><q-badge color="orange-8" :label="`${conflictsIn(c)} to choose`" /></q-item-section>
            </template>
            <div class="q-px-lg q-pb-md">
              <div v-if="c.action === 'new'" class="text-grey-8">Added as a new customer, with {{ c.pools.map((p) => p.name).join(', ') || 'no pools' }}.</div>
              <ChangeList :changes="c.changes" :conflicts="c.conflicts" :take="take" @toggle="toggle" />
              <div v-for="(p, pi) in c.pools.filter((x) => x.action !== 'same' || c.action !== 'new')" :key="pi" class="q-mt-sm">
                <div class="text-weight-medium"><q-icon name="pool" color="grey-7" /> {{ p.name }} <q-badge outline :color="ACTION_COLOR[p.action]" :label="ACTION_LABEL[p.action]" class="q-ml-xs" /></div>
                <ChangeList :changes="p.changes" :conflicts="p.conflicts" :take="take" @toggle="toggle" />
              </div>
            </div>
          </q-expansion-item>
        </q-list>

        <q-card-actions align="right" class="q-pa-md">
          <q-btn color="primary" unelevated no-caps icon="file_download_done" :label="importLabel" :disable="!canImport" :loading="applying" data-test="import-apply" @click="runApply" />
        </q-card-actions>
      </template>
    </q-card>

    <q-banner v-if="lastResult" rounded class="bg-green-1 text-green-10 q-mb-md" data-test="import-done">
      <template #avatar><q-icon name="task_alt" color="positive" /></template>
      Imported {{ lastResult.summary.customersNew }} new customer{{ plural(lastResult.summary.customersNew) }} and {{ lastResult.summary.poolsNew }} pool{{ plural(lastResult.summary.poolsNew) }}; updated {{ lastResult.summary.customersMerged }}.
      <template #action>
        <q-btn flat no-caps label="Open Customers" to="/desk/customers" />
        <q-btn flat no-caps color="negative" label="Undo this import" data-test="import-undo-last" @click="undo(lastResult.importId)" />
      </template>
    </q-banner>

    <!-- Past imports -->
    <q-card flat bordered>
      <q-card-section class="text-subtitle1 text-weight-medium">Past imports</q-card-section>
      <q-markup-table flat dense separator="horizontal" data-test="import-history">
        <thead><tr><th class="text-left">When</th><th class="text-left">File</th><th class="text-right">New</th><th class="text-right">Updated</th><th class="text-left">Undo</th></tr></thead>
        <tbody>
          <tr v-if="!history.length"><td colspan="5" class="text-grey-7">None yet.</td></tr>
          <tr v-for="h in history" :key="h._id" :data-test="`import-history-${h._id}`">
            <td>{{ when(h.at) }}</td>
            <td>{{ h.fileName }}</td>
            <td class="text-right">{{ h.summary.customersNew }} customers, {{ h.summary.poolsNew }} pools</td>
            <td class="text-right">{{ h.summary.customersMerged }}</td>
            <td>
              <span v-if="h.undoneAt" class="text-grey-7">Undone {{ when(h.undoneAt) }}<template v-if="h.undo?.kept"> ({{ h.undo.kept }} kept: in use or edited since)</template></span>
              <q-btn v-else flat dense no-caps color="negative" label="Undo" :data-test="`import-undo-${h._id}`" @click="undo(h._id)" />
            </td>
          </tr>
        </tbody>
      </q-markup-table>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, type PropType } from 'vue';
import { useQuasar, QBtnToggle } from 'quasar';
import {
  guessMapping,
  IMPORT_FIELDS,
  type ImportApplyResult,
  type ImportConflict,
  type ImportFieldChange,
  type ImportFieldKey,
  type ImportPlanCustomer,
  type ImportPreview,
  type ImportReadResult,
  type ImportRecord,
} from '@pool/shared';
import { api, apiForm, errorMessage } from '@/stores/api';
import { pendingCount, syncNow } from '@/offline/engine';
import { exportCsv } from '@/lib/exportTable';
import { DAY_LABELS, formatPhone } from '@/lib/format';

defineOptions({ name: 'DeskImportPage' });
const $q = useQuasar();

// ---------------------------------------------------------------- choices
const GROUP_LABEL = { customer: 'Customer', pool: 'Pool', equipment: 'Equipment' } as const;
type Opt = { label: string; value?: ImportFieldKey | null; header?: boolean; disable?: boolean };
const FIELD_OPTIONS: Opt[] = [
  { label: 'Ignore this column', value: null },
  ...(['customer', 'pool', 'equipment'] as const).flatMap((g) => [
    { label: GROUP_LABEL[g], header: true, disable: true },
    ...IMPORT_FIELDS.filter((f) => f.group === g && !('hidden' in f)).map((f) => ({ label: f.label, value: f.key as ImportFieldKey })),
  ]),
];
const ACTION_LABEL = { new: 'New', merge: 'Update', same: 'Up to date' } as const;
const ACTION_COLOR = { new: 'positive', merge: 'primary', same: 'grey-6' } as const;
const SHOW_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'New', value: 'new' },
  { label: 'Updates', value: 'merge' },
  { label: 'To choose', value: 'conflicts' },
];
const TEMPLATE = ['Customer name', 'Phone', 'Email', 'Street', 'City', 'State', 'ZIP', 'Monthly rate', 'Pool name', 'Pool type', 'Gallons', 'Service day', 'Access notes', 'Notes'];

// ---------------------------------------------------------------- state
const file = ref<File | null>(null);
const read = ref<ImportReadResult | null>(null);
const sheet = ref(0);
const mapping = ref<(ImportFieldKey | null)[]>([]);
const previewData = ref<ImportPreview | null>(null);
const take = ref(new Set<string>());
const show = ref<'all' | 'new' | 'merge' | 'conflicts'>('all');
const reading = ref(false);
const previewing = ref(false);
const applying = ref(false);
const lastResult = ref<ImportApplyResult | null>(null);
const history = ref<ImportRecord[]>([]);
const pending = ref(0);

const currentSheet = computed(() => read.value?.sheets[sheet.value]);
const s = computed(() => previewData.value!.summary);
const sameCount = computed(() => previewData.value?.customers.filter((c) => c.action === 'same').length ?? 0);
const allConflicts = (c: ImportPlanCustomer): ImportConflict[] => [...c.conflicts, ...c.pools.flatMap((p) => p.conflicts)];
const hasConflicts = (c: ImportPlanCustomer) => allConflicts(c).length > 0;
const conflictsIn = (c: ImportPlanCustomer) => allConflicts(c).length;
const shown = computed(() => {
  const list = previewData.value?.customers ?? [];
  if (show.value === 'conflicts') return list.filter(hasConflicts);
  if (show.value === 'all') return list;
  return list.filter((c) => c.action === show.value);
});
const canImport = computed(() => !!previewData.value && (s.value.customersNew + s.value.customersMerged + s.value.poolsNew > 0));
const importLabel = computed(() => {
  if (!previewData.value) return 'Import';
  const parts = [];
  if (s.value.customersNew) parts.push(`add ${s.value.customersNew} customer${plural(s.value.customersNew)}`);
  if (s.value.customersMerged) parts.push(`update ${s.value.customersMerged}`);
  if (!s.value.customersNew && s.value.poolsNew) parts.push(`add ${s.value.poolsNew} pool${plural(s.value.poolsNew)}`);
  return parts.length ? `Import: ${parts.join(', ')}` : 'Nothing to import';
});

const plural = (n: number) => (n === 1 ? '' : 's');
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const examples = (i: number) => [...new Set((currentSheet.value?.sample ?? []).map((r) => r[i] ?? '').filter(Boolean))].slice(0, 3).join(' · ');

// ---------------------------------------------------------------- steps
function options() {
  return { sheet: sheet.value, mapping: mapping.value, take: [...take.value] };
}
function body(withOptions: boolean) {
  const form = new FormData();
  if (withOptions) form.append('options', JSON.stringify(options()));
  form.append('file', file.value!, file.value!.name);
  return form;
}
function fail(err: unknown) {
  $q.notify({ type: 'negative', message: errorMessage(err), timeout: 8000 });
}

async function onFile() {
  read.value = null;
  previewData.value = null;
  lastResult.value = null;
  take.value = new Set();
  if (!file.value) return;
  reading.value = true;
  try {
    read.value = await apiForm<ImportReadResult>('/import/read', body(false));
    sheet.value = 0;
    mapping.value = [...read.value.mapping];
    if (read.value.kind === 'app') await runPreview();
  } catch (err) {
    fail(err);
  } finally {
    reading.value = false;
  }
}
function onSheet() {
  mapping.value = guessMapping(currentSheet.value?.headers ?? []);
  previewData.value = null;
}
async function runPreview() {
  previewing.value = true;
  try {
    previewData.value = await apiForm<ImportPreview>('/import/preview', body(true));
    const valid = new Set(previewData.value.customers.flatMap(allConflicts).map((c) => c.id));
    take.value = new Set([...take.value].filter((id) => valid.has(id)));
  } catch (err) {
    fail(err);
  } finally {
    previewing.value = false;
  }
}
function toggle(id: string) {
  const next = new Set(take.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  take.value = next;
}
function takeAll() {
  take.value = new Set(previewData.value!.customers.flatMap(allConflicts).map((c) => c.id));
}
function runApply() {
  $q.dialog({ title: 'Import', message: `${importLabel.value.replace(/^Import: /, '')}? You can undo it afterwards.`, cancel: true, ok: { label: 'Import', color: 'primary', unelevated: true, noCaps: true } }).onOk(async () => {
    applying.value = true;
    try {
      lastResult.value = await apiForm<ImportApplyResult>('/import/apply', body(true));
      previewData.value = null;
      read.value = null;
      file.value = null;
      await Promise.all([loadHistory(), syncNow({ pull: true }).catch(() => null)]);
    } catch (err) {
      fail(err);
    } finally {
      applying.value = false;
    }
  });
}
function undo(id: string) {
  $q.dialog({
    title: 'Undo this import?',
    message: 'Customers and pools it added are hidden, and fields it changed get their old values back. Anything used or edited since the import stays as it is.',
    cancel: true,
    ok: { label: 'Undo import', color: 'negative', unelevated: true, noCaps: true },
  }).onOk(async () => {
    try {
      const r = await api<{ hidden: number; restored: number; kept: number }>(`/imports/${id}/undo`, { method: 'POST' });
      $q.notify({ type: 'positive', message: `Undone: ${r.hidden} hidden, ${r.restored} field${plural(r.restored)} put back${r.kept ? `, ${r.kept} kept (in use or edited since)` : ''}` });
      if (lastResult.value?.importId === id) lastResult.value = null;
      await Promise.all([loadHistory(), syncNow({ pull: true }).catch(() => null)]);
    } catch (err) {
      fail(err);
    }
  });
}
function downloadTemplate() {
  exportCsv({ name: 'import-template', columns: TEMPLATE.map((label) => ({ label })), rows: [] });
}
async function loadHistory() {
  try {
    history.value = await api<ImportRecord[]>('/imports');
  } catch {
    /* offline: keep what's shown */
  }
}
onMounted(async () => {
  pending.value = await pendingCount().catch(() => 0);
  await loadHistory();
});

// ---------------------------------------------------------------- one block of changes
function show1(path: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(blank)';
  if (path === 'phones' && Array.isArray(v)) return v.map((p: { number: string }) => formatPhone(p.number)).join(', ');
  if (path === 'address' && typeof v === 'object') return Object.values(v as Record<string, string>).filter(Boolean).join(', ');
  if (path === 'serviceDay') return DAY_LABELS[v as keyof typeof DAY_LABELS] ?? String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return v.slice(0, 10);
  if (path === 'monthlyRate' && typeof v === 'number') return `$${v.toFixed(2)}`;
  return String(v);
}
const ChangeList = defineComponent({
  props: {
    changes: { type: Array as PropType<ImportFieldChange[]>, required: true },
    conflicts: { type: Array as PropType<ImportConflict[]>, required: true },
    take: { type: Object as PropType<Set<string>>, required: true },
  },
  emits: ['toggle'],
  setup(props, { emit }) {
    return () =>
      h('div', { class: 'q-mt-xs' }, [
        ...props.changes.map((c) =>
          h('div', { class: 'row q-gutter-sm items-baseline', 'data-test': `import-change-${c.path}` }, [
            h('span', { class: 'text-grey-8', style: 'min-width: 130px' }, c.label),
            h('span', { class: 'text-positive' }, c.path === 'equipment' ? show1(c.path, c.to) : `+ ${c.path === 'notes' || c.path === 'accessNotes' ? 'added text' : show1(c.path, c.to)}`),
          ]),
        ),
        ...props.conflicts.map((c) =>
          h('div', { class: 'row q-gutter-sm items-center q-mt-xs', 'data-test': `import-conflict-${c.path}` }, [
            h('span', { class: 'text-orange-10 text-weight-medium', style: 'min-width: 130px' }, c.label),
            h(QBtnToggle, {
              dense: true,
              noCaps: true,
              unelevated: true,
              toggleColor: 'orange-8',
              color: 'grey-2',
              textColor: 'grey-9',
              modelValue: props.take.has(c.id) ? 'file' : 'keep',
              options: [
                { label: `Keep: ${show1(c.path, c.from)}`, value: 'keep', attrs: { 'data-test': 'keep' } },
                { label: `Use file: ${show1(c.path, c.to)}`, value: 'file', attrs: { 'data-test': 'use-file' } },
              ],
              'onUpdate:modelValue': (v: string) => {
                if ((v === 'file') !== props.take.has(c.id)) emit('toggle', c.id);
              },
            }),
          ]),
        ),
      ]);
  },
});
</script>

<style scoped>
.import-page {
  max-width: 1200px;
}
</style>
