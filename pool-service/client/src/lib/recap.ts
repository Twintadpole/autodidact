import { READINGS } from '@pool/shared';
import type { Chemical, Customer, Settings, Tasks, Visit } from './types';

/**
 * The visit recap a customer may receive. Built ONLY from the allow-listed fields below:
 * date, tasks, readings, chemicals added (name, amount, unit), the note written for the
 * customer, and the business's contact details. Chemical costs, private visit notes and
 * time on site are never read here. (Checked by e2e/invoices-recap.cjs.)
 */
export interface RecapOptions {
  readings: boolean;
  chemicals: boolean;
}

const TASK_PHRASES: Record<keyof Tasks, string> = {
  brushed: 'Brushed the walls and steps',
  skimmed: 'Skimmed the surface',
  vacuumed: 'Vacuumed the pool',
  skimmerBaskets: 'Emptied the skimmer baskets',
  pumpBasket: 'Emptied the pump basket',
  filterCleaned: 'Cleaned the filter',
  basketsEmptied: 'Emptied the baskets',
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

export function recapDate(visitedAt: string): string {
  return new Date(visitedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export function buildRecap(input: {
  visit: Pick<Visit, 'visitedAt' | 'tasks' | 'readings' | 'doses' | 'customerNote'>;
  customer: Pick<Customer, 'name'> | undefined;
  poolName: string;
  chemicalById: Map<string, Pick<Chemical, 'name'>>;
  business: Pick<Settings, 'businessName' | 'phone' | 'email'> | null;
  options: RecapOptions;
}): { subject: string; body: string } {
  const { visit, customer, poolName, chemicalById, business, options } = input;
  const date = recapDate(visit.visitedAt);
  const from = business?.businessName?.trim() || 'Your pool service';
  const first = customer?.name?.trim().split(/\s+/)[0];
  const lines: string[] = [];

  lines.push(first ? `Hi ${first},` : 'Hello,', '');
  lines.push(`Here's a summary of today's pool service${poolName ? ` (${poolName})` : ''} on ${date}.`);

  const tasks = (Object.keys(TASK_PHRASES) as (keyof Tasks)[]).filter((k) => visit.tasks?.[k]).map((k) => TASK_PHRASES[k]);
  if (tasks.length) lines.push('', 'Work done:', ...tasks.map((t) => `• ${t}`));

  if (options.readings) {
    const readings = READINGS.filter((r) => typeof visit.readings?.[r.key] === 'number').map(
      (r) => `• ${r.label}: ${fmt(visit.readings[r.key] as number)}${r.unit ? ` ${r.unit}` : ''}`,
    );
    if (readings.length) lines.push('', 'Water test:', ...readings);
  }

  if (options.chemicals) {
    // Name, amount and unit only: never the cost.
    const added = (visit.doses ?? []).map((d) => `• ${chemicalById.get(d.chemicalId)?.name ?? 'Chemical'}: ${fmt(d.amount)} ${d.unit}`);
    if (added.length) lines.push('', 'Chemicals added:', ...added);
  }

  const note = visit.customerNote?.trim();
  if (note) lines.push('', note);

  lines.push('', 'Thank you,', from);
  const contact = [business?.phone?.trim(), business?.email?.trim()].filter(Boolean).join(' · ');
  if (contact) lines.push(contact);

  return { subject: `Pool service recap · ${date}`, body: lines.join('\n') };
}
