import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  applyIssueStatus,
  chemical,
  customer,
  idSchema,
  ISSUE_STATUSES,
  issue,
  NOTE_PARENT_TYPES,
  note,
  pool,
  SERVICE_DAYS,
} from '@pool/shared';
import { AuditLog, Chemical, Customer, Issue, Note, Pool, Visit } from '../models/index.js';
import { registerCrud } from '../services/crud.js';
import { cascadeCustomerDelete, cascadePoolDelete } from '../services/cascade.js';
import { queryBool } from '../util.js';

/** CRUD for customers, pools, chemicals, notes and issues, plus pool visit history. */
export const resourceRoutes: FastifyPluginAsync = async (parent) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();

  registerCrud(app, { path: '/customers', model: Customer, schemas: customer, sort: { name: 1 }, afterDelete: cascadeCustomerDelete });

  registerCrud(app, {
    path: '/pools',
    model: Pool,
    afterDelete: (id, now) => cascadePoolDelete(id, now, 'Pool deleted'),
    schemas: pool,
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

  registerCrud(app, {
    path: '/chemicals',
    model: Chemical,
    schemas: chemical,
    sort: { name: 1 },
    listQuery: z.object({ active: queryBool.optional() }),
    toFilter: (q) => (q.active !== undefined ? { active: q.active } : {}),
  });

  registerCrud(app, {
    path: '/notes',
    model: Note,
    schemas: note,
    sort: { pinned: -1, createdAt: -1 },
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
    async (request) =>
      Visit.find({ poolId: request.params.id, deletedAt: null })
        .sort({ visitedAt: -1 })
        .limit(request.query.limit)
        .lean(),
  );

  /** Visits whose timer is running right now (open time segment), for pools that still exist. */
  app.get('/visits/active', async () => {
    const running = await Visit.find({
      deletedAt: null,
      'timeLog.finished': { $ne: true },
      'timeLog.segments': { $elemMatch: { end: null } },
    }).lean<{ poolId: string }[]>();
    if (!running.length) return running;
    const livePools = new Set(
      (await Pool.find({ _id: { $in: running.map((v) => v.poolId) }, deletedAt: null }, { _id: 1 }).lean<{ _id: string }[]>()).map((p) => p._id),
    );
    return running.filter((v) => livePools.has(v.poolId));
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
      const { collection, docId, limit } = request.query;
      const filter: Record<string, unknown> = {};
      if (collection) filter.collectionName = collection;
      if (docId) filter.docId = docId;
      return AuditLog.find(filter).sort({ at: -1 }).limit(limit).lean();
    },
  );
};
