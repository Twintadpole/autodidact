import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  applyIssueStatus,
  chemical,
  customer,
  idSchema,
  invoice,
  ISSUE_STATUSES,
  ledger,
  issue,
  NOTE_PARENT_TYPES,
  note,
  OWNER_ONLY_FIELDS,
  pool,
  SERVICE_DAYS,
  settings,
} from '@pool/shared';
import { AuditLog, Chemical, Customer, Invoice, Issue, Ledger, Note, Pool, Settings, Visit } from '../models/index.js';
import { registerCrud } from '../services/crud.js';
import { cascadeCustomerDelete, cascadePoolDelete } from '../services/cascade.js';
import { assertOwner, assertPool, canSeePool, redact, techScope } from '../services/scope.js';
import { bumpAccess, type Actor } from '../services/users.js';
import { HttpError, queryBool } from '../util.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const without = (body: Record<string, any>, keys: readonly string[]) => Object.fromEntries(Object.entries(body).filter(([k]) => !keys.includes(k)));

/** A tech may attach notes only to their own pools, their customers and those pools' visits. */
async function assertNoteParent(actor: Actor, parentType: string, parentId: string) {
  if (parentType === 'pool' && (await canSeePool(actor, parentId))) return;
  if (parentType === 'customer' && (await techScope(actor)).customerIds.includes(parentId)) return;
  if (parentType === 'visit') {
    const v = await Visit.findById(parentId, { poolId: 1 }).lean<{ poolId: string }>();
    if (v && (await canSeePool(actor, v.poolId))) return;
  }
  throw new HttpError(404, 'No such record to attach the note to');
}

/** CRUD for customers, pools, chemicals, notes and issues, plus pool visit history. */
export const resourceRoutes: FastifyPluginAsync = async (parent) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();

  registerCrud(app, {
    path: '/customers',
    model: Customer,
    schemas: customer,
    sort: { name: 1 },
    afterDelete: cascadeCustomerDelete,
    // Techs add and edit customers, without the money fields; they don't delete.
    techBody: (body) => without(body, [...OWNER_ONLY_FIELDS.customers, 'createdBy']),
    beforeWrite: (body, existing, _now, actor) => (existing ? without(body, ['createdBy']) : { ...body, createdBy: actor.userId }),
  });

  registerCrud(app, {
    path: '/pools',
    model: Pool,
    afterDelete: (id, now) => cascadePoolDelete(id, now, 'Pool deleted'),
    schemas: pool,
    // A tech's new pool is on their route; they can't move pools between routes.
    techBody: async (body, existing, actor) => {
      if (existing) return without(body, ['techId', 'customerId']);
      if (!(await techScope(actor)).customerIds.includes(body.customerId)) throw new HttpError(404, 'No such customer');
      return { ...body, techId: actor.userId };
    },
    afterWrite: async (before, after) => {
      if ((before?.techId ?? null) !== (after.techId ?? null)) await bumpAccess([before?.techId, after.techId]);
    },
    sort: { serviceDay: 1, routeOrder: 1 },
    listQuery: z.object({
      customerId: idSchema.optional(),
      serviceDay: z.enum(SERVICE_DAYS).optional(),
      active: queryBool.optional(),
    }),
    toFilter: (q) => ({
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.serviceDay && { serviceDay: q.serviceDay }),
      ...(q.active !== undefined && { active: q.active }),
    }),
  });

  // Phase 7B. Invoices are kept when their customer is deleted (financial records).
  registerCrud(app, {
    path: '/invoices',
    model: Invoice,
    schemas: invoice,
    sort: { number: -1 },
    techAccess: 'none',
    listQuery: z.object({ customerId: idSchema.optional() }),
    toFilter: (q) => (q.customerId ? { customerId: q.customerId } : {}),
  });
  // Techs get the business details they need (recaps) through sync only.
  registerCrud(app, { path: '/settings', model: Settings, schemas: settings, sort: { _id: 1 }, techAccess: 'none' });
  registerCrud(app, {
    path: '/ledger',
    model: Ledger,
    schemas: ledger,
    sort: { date: -1 },
    techAccess: 'none',
    listQuery: z.object({ customerId: idSchema.optional() }),
    toFilter: (q) => (q.customerId ? { customerId: q.customerId } : {}),
  });

  registerCrud(app, {
    path: '/chemicals',
    model: Chemical,
    schemas: chemical,
    sort: { name: 1 },
    techAccess: 'read',
    listQuery: z.object({ active: queryBool.optional() }),
    toFilter: (q) => (q.active !== undefined ? { active: q.active } : {}),
  });

  registerCrud(app, {
    path: '/notes',
    model: Note,
    schemas: note,
    sort: { pinned: -1, createdAt: -1 },
    techDelete: true,
    techBody: async (body, existing, actor) => {
      if (existing) return without(body, ['parentType', 'parentId']);
      await assertNoteParent(actor, body.parentType, body.parentId);
      return body;
    },
    listQuery: z.object({ parentType: z.enum(NOTE_PARENT_TYPES).optional(), parentId: idSchema.optional() }),
    toFilter: (q) => ({
      ...(q.parentType && { parentType: q.parentType }),
      ...(q.parentId && { parentId: q.parentId }),
    }),
  });

  registerCrud(app, {
    path: '/issues',
    model: Issue,
    schemas: issue,
    techDelete: true,
    techBody: async (body, existing, actor) => {
      if (existing) return without(body, ['poolId']);
      await assertPool(actor, body.poolId);
      return body;
    },
    // Do-now first: urgent+important, then important, then urgent, then oldest.
    sort: { important: -1, urgent: -1, createdAt: 1 },
    listQuery: z.object({
      /** One status or a comma-separated list, e.g. "open,in_progress". */
      status: z
        .string()
        .transform((s) => s.split(',').map((v) => v.trim()))
        .pipe(z.array(z.enum(ISSUE_STATUSES)))
        .optional(),
      poolId: idSchema.optional(),
    }),
    toFilter: (q) => ({
      ...(q.status && { status: { $in: q.status } }),
      ...(q.poolId && { poolId: q.poolId }),
    }),
    beforeWrite: (body, existing, now) => applyIssueStatus(body, existing?.status ?? (existing ? undefined : 'open'), now),
  });

  app.get(
    '/pools/:id/visits',
    {
      schema: {
        params: z.object({ id: idSchema }),
        // Default 2 = the current visit card and the previous visit card.
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(2) }),
      },
    },
    async (request) => {
      await assertPool(request.actor!, request.params.id);
      const visits = await Visit.find({ poolId: request.params.id, deletedAt: null }).sort({ visitedAt: -1 }).limit(request.query.limit).lean();
      return visits.map((v) => redact('visits', v, request.actor!));
    },
  );

  /** One visit (visit history detail screen). */
  app.get('/visits/:id', { schema: { params: z.object({ id: idSchema }) } }, async (request, reply) => {
    const v = await Visit.findOne({ _id: request.params.id, deletedAt: null }).lean<Record<string, any>>();
    if (!v || !(await canSeePool(request.actor!, v.poolId))) return reply.code(404).send({ error: 'Not Found', message: 'No such visit' });
    return redact('visits', v, request.actor!);
  });

  /** Visits whose timer is running right now (open time segment), for pools that still exist. */
  app.get('/visits/active', async (request) => {
    const running = await Visit.find({
      deletedAt: null,
      'timeLog.finished': { $ne: true },
      'timeLog.segments': { $elemMatch: { end: null } },
    }).lean<{ poolId: string }[]>();
    if (!running.length) return running;
    const mine = request.actor!.role === 'owner' ? {} : { techId: request.actor!.userId };
    const livePools = new Set(
      (await Pool.find({ _id: { $in: running.map((v) => v.poolId) }, deletedAt: null, ...mine }, { _id: 1 }).lean<{ _id: string }[]>()).map((p) => p._id),
    );
    return running.filter((v) => livePools.has(v.poolId)).map((v) => redact('visits', v, request.actor!));
  });

  /** Change history for one document (newest first), or the latest changes overall. */
  app.get(
    '/audit',
    {
      schema: {
        querystring: z.object({
          collection: z.string().min(1).max(40).optional(),
          docId: z.string().min(1).max(64).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
      },
    },
    async (request) => {
      assertOwner(request.actor);
      const { collection, docId, limit } = request.query;
      const filter: Record<string, unknown> = {};
      if (collection) filter.collectionName = collection;
      if (docId) filter.docId = docId;
      return AuditLog.find(filter).sort({ at: -1 }).limit(limit).lean();
    },
  );
};
