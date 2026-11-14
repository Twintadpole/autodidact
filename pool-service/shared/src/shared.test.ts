import { describe, expect, it } from 'vitest';
import {
  deriveQuadrant,
  isoWeekKey,
  pool,
  rateReading,
  READING_KEYS,
  serviceDayOf,
  serviceDaysFrom,
  syncPackageSchema,
  visit,
  customer,
  applyIssueStatus,
} from './index.js';

const POOL_ID = '019a3c4e-0000-7000-8000-000000000001';
const now = new Date('2026-10-31T15:00:00Z');

describe('READINGS', () => {
  it('includes every reading from the spec', () => {
    expect(READING_KEYS).toEqual(['fc', 'cc', 'ph', 'ta', 'ch', 'cya', 'salt', 'phosphate', 'tempF', 'filterPsi']);
  });

  it('rates values ok / warn / bad / none', () => {
    expect(rateReading('ph', 7.5)).toBe('ok');
    expect(rateReading('ph', 7.3)).toBe('warn');
    expect(rateReading('ph', 8.2)).toBe('bad');
    expect(rateReading('cc', 0.3)).toBe('warn');
    expect(rateReading('fc', null)).toBe('none');
    expect(rateReading('tempF', 120)).toBe('ok'); // no range defined
  });
});

describe('deriveQuadrant', () => {
  it('maps flags to Eisenhower quadrants', () => {
    expect(deriveQuadrant({ urgent: true, important: true })).toBe('do_now');
    expect(deriveQuadrant({ urgent: false, important: true })).toBe('schedule');
    expect(deriveQuadrant({ urgent: true, important: false })).toBe('quick_fix');
    expect(deriveQuadrant({ urgent: false, important: false })).toBe('someday');
  });
});

describe('week helpers', () => {
  it('uses ISO weeks (Mon–Sun)', () => {
    expect(isoWeekKey(new Date('2026-11-01T12:00:00'))).toBe('2026-W44'); // Sunday
    expect(isoWeekKey(new Date('2026-11-02T12:00:00'))).toBe('2026-W45'); // Monday
  });

  it('orders service days starting today', () => {
    const sat = new Date('2026-10-31T12:00:00');
    expect(serviceDayOf(sat)).toBe('sat');
    expect(serviceDaysFrom(sat)).toEqual(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']);
  });
});

describe('collection schemas', () => {
  it('patch schemas do not fill defaults for omitted fields', () => {
    expect(pool.patch.parse({ name: 'Spa' })).toEqual({ name: 'Spa' });
  });

  it('create schemas fill defaults', () => {
    const p = pool.create.parse({ customerId: POOL_ID, type: 'salt', volumeGal: 15000, serviceDay: 'tue' });
    expect(p.week).toEqual({ done: false, doneAt: null, changedAt: null });
    expect(p.active).toBe(true);
  });

  it('rejects non-E.164 phone numbers', () => {
    const base = { name: 'A', address: { line1: '1 Main', city: 'Austin', state: 'TX', zip: '78701' } };
    expect(customer.create.safeParse({ ...base, phones: [{ label: 'cell', number: '+15125550123' }] }).success).toBe(true);
    expect(customer.create.safeParse({ ...base, phones: [{ label: 'cell', number: '512-555-0123' }] }).success).toBe(false);
  });

  it('visit docs coerce ISO date strings', () => {
    const v = visit.doc.parse({
      _id: '019a3c4e-0000-7000-8000-0000000000aa',
      poolId: POOL_ID,
      visitedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      readings: { fc: 3, ph: 7.4 },
    });
    expect(v.visitedAt).toBeInstanceOf(Date);
    expect(v.tasks.brushed).toBe(false);
    expect(v.deletedAt).toBeNull();
  });
});

describe('syncPackageSchema', () => {
  const base = { packageId: '019a3c4e-0000-7000-8000-0000000000ff', poolId: POOL_ID, createdAt: now.toISOString() };

  it('accepts a minimal package', () => {
    const pkg = syncPackageSchema.parse({ ...base, weekToggle: { done: true, at: now.toISOString() } });
    expect(pkg.issues).toEqual([]);
    expect(pkg.weekToggle?.done).toBe(true);
  });

  it('rejects children that belong to another pool', () => {
    const result = syncPackageSchema.safeParse({
      ...base,
      issues: [
        {
          _id: '019a3c4e-0000-7000-8000-0000000000bb',
          poolId: '019a3c4e-0000-7000-8000-000000000002',
          title: 'Leak',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('applyIssueStatus', () => {
  const t = new Date('2026-10-31T10:00:00Z');
  it('stamps resolvedAt when completed and postponedAt when postponed', () => {
    expect(applyIssueStatus({ status: 'resolved' as const }, 'open', t)).toMatchObject({ resolvedAt: t, postponedAt: null });
    expect(applyIssueStatus({ status: 'postponed' as const }, 'open', t)).toMatchObject({ resolvedAt: null, postponedAt: t });
  });
  it('clears both on reopen and leaves unchanged status alone', () => {
    expect(applyIssueStatus({ status: 'open' as const, resolvedAt: t }, 'resolved', t)).toMatchObject({ resolvedAt: null, postponedAt: null });
    const same = { status: 'resolved' as const, resolvedAt: t };
    expect(applyIssueStatus(same, 'resolved')).toBe(same);
  });
});

import { timeLogSchema, timeLogSeconds, timeLogState } from './index.js';

describe('visit time log', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 10, 7, 9, m)).toISOString();

  it('sums segments and counts a running one up to now', () => {
    const log = timeLogSchema.parse({ segments: [{ start: t(0), end: t(10) }, { start: t(15), end: null }] });
    expect(timeLogSeconds(log, new Date(t(20)))).toBe(15 * 60);
    expect(timeLogState(log)).toBe('running');
  });

  it('knows paused and stopped', () => {
    expect(timeLogState(timeLogSchema.parse({ segments: [{ start: t(0), end: t(5) }] }))).toBe('paused');
    expect(timeLogState(timeLogSchema.parse({ segments: [{ start: t(0), end: t(5) }], finished: true }))).toBe('stopped');
    expect(timeLogState(timeLogSchema.parse({}))).toBe('idle');
  });

  it('rejects bad edits: end before start, overlaps, two running segments', () => {
    expect(timeLogSchema.safeParse({ segments: [{ start: t(10), end: t(5) }] }).success).toBe(false);
    expect(timeLogSchema.safeParse({ segments: [{ start: t(0), end: t(10) }, { start: t(5), end: t(12) }] }).success).toBe(false);
    expect(timeLogSchema.safeParse({ segments: [{ start: t(0), end: null }, { start: t(5), end: t(6) }] }).success).toBe(false);
    expect(timeLogSchema.safeParse({ segments: [{ start: t(0), end: null }], finished: true }).success).toBe(false);
  });
});
