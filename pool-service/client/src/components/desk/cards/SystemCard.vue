<template>
  <div class="column no-wrap full-height" data-test="system-card">
    <div class="row items-center q-gutter-x-sm">
      <q-icon :name="problems.length ? 'error' : 'check_circle'" size="28px" :style="{ color: problems.length ? STATUS.critical : STATUS.good }" />
      <div>
        <div class="hero hero-2" data-test="system-summary">{{ problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : $t('All OK') }}</div>
        <div class="hero-sub">{{ problems.length ? problems.map((p) => p.label).join(' · ') : $t('Backups, alerts, disk and sync') }}</div>
      </div>
      <q-space />
      <span v-if="error && fetchedAt" class="text-caption text-grey-7"><q-icon name="cloud_off" /> as of {{ asOf(fetchedAt) }}</span>
      <q-btn flat round dense size="sm" icon="refresh" :aria-label="$t(`Refresh`)" :loading="loading" @click="reload" />
    </div>

    <!-- Each check, with an icon and words (never colour alone) -->
    <q-list v-if="mode !== 's'" dense class="q-mt-sm col scroll" data-test="system-checks">
      <q-item v-for="c in checks" :key="c.label" class="q-px-none" style="min-height: 28px">
        <q-item-section avatar style="min-width: 28px">
          <q-icon :name="ICON[c.state]" size="18px" :style="{ color: COLOR[c.state] }" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ c.label }}</q-item-label>
        </q-item-section>
        <q-item-section side class="text-grey-8">{{ c.detail }}</q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script setup lang="ts">
import { t, timeAgo, tn, translated } from '@/i18n';
import { computed, ref } from 'vue';
import { parseISO } from 'date-fns';
import { api } from '@/stores/api';
import { useSyncStore } from '@/stores/sync';
import { useCachedReport } from '@/composables/useCachedReport';
import { STATUS } from '@/lib/chartTheme';
import { asOf, type CardMode } from '@/lib/dashboard';

defineProps<{ mode: CardMode; width?: number }>();
const sync = useSyncStore();

interface Status {
  lastBackupAt: string | null;
  lastOffsiteAt?: string | null;
  lastRestoreCheckAt?: string | null;
  monitorCheckedAt?: string | null;
  openAlerts?: { name: string; since: string | null }[];
  disk?: { usedPct: number; freeGb: number } | null;
}
const { data: status, fetchedAt, loading, error, reload } = useCachedReport<Status>(ref('system'), () => api('/system/status'));

type State = 'ok' | 'warn' | 'bad' | 'unknown';
const ICON: Record<State, string> = { ok: 'check_circle', warn: 'warning', bad: 'error', unknown: 'help' };
const COLOR: Record<State, string> = { ok: STATUS.good, warn: '#c98500', bad: STATUS.critical, unknown: '#898781' };
const ALERT_LABEL: Record<string, string> = translated({ app: 'App unreachable', disk: 'Disk full', backups: 'Backups' });

const hoursSince = (iso: string | null | undefined) => (iso ? (Date.now() - parseISO(iso).getTime()) / 3_600_000 : null);
const ago = (iso: string | null | undefined) => (iso ? timeAgo(parseISO(iso)) : t('never'));
/** Fresh enough within `max` hours; a missing time counts as a problem. */
const age = (iso: string | null | undefined, max: number): State => {
  const h = hoursSince(iso);
  return h == null ? 'bad' : h <= max ? 'ok' : 'bad';
};

const checks = computed(() => {
  const s = status.value;
  const list: { label: string; state: State; detail: string }[] = [];
  if (s) {
    list.push({ label: t('Nightly backup'), state: age(s.lastBackupAt, 26), detail: ago(s.lastBackupAt) });
    if (s.lastOffsiteAt !== undefined) list.push({ label: t('Offsite copy (R2)'), state: age(s.lastOffsiteAt, 26), detail: ago(s.lastOffsiteAt) });
    if (s.lastRestoreCheckAt !== undefined) list.push({ label: t('Weekly restore check'), state: age(s.lastRestoreCheckAt, 8 * 24), detail: ago(s.lastRestoreCheckAt) });
    if (s.disk) list.push({ label: t('Server disk'), state: s.disk.usedPct > 80 ? 'bad' : s.disk.usedPct > 70 ? 'warn' : 'ok', detail: t('{usedPct}% full · {freeGb} GB free', { usedPct: s.disk.usedPct, freeGb: s.disk.freeGb }) });
    const alerts = s.openAlerts ?? [];
    list.push({
      label: t('Phone alerts'),
      state: s.monitorCheckedAt === undefined ? 'unknown' : alerts.length ? 'bad' : age(s.monitorCheckedAt, 2) === 'ok' ? 'ok' : 'warn',
      detail: alerts.length ? alerts.map((a) => t('{alert}, {since}', { alert: ALERT_LABEL[a.name] ?? a.name, since: ago(a.since) })).join(', ') : s.monitorCheckedAt ? t('none open · checked {ago}', { ago: ago(s.monitorCheckedAt) }) : t('not reported yet'),
    });
  }
  list.push({
    label: t('This device'),
    state: sync.failed ? 'bad' : sync.pending ? 'warn' : 'ok',
    detail: sync.failed ? tn(sync.failed, '{n} change failed', '{n} changes failed') : sync.pending ? tn(sync.pending, '{n} change waiting to upload', '{n} changes waiting to upload') : t('everything uploaded'),
  });
  return list;
});
const problems = computed(() => checks.value.filter((c) => c.state === 'bad'));
</script>
