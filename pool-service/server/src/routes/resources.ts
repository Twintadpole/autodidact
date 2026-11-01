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
import { Chemical, Customer, Issue, Note, Pool, Visit } from '../models/index.js';
import { registerCrud } from '../services/crud.js';
import { queryBool } from '../util.js';

/** CRUD for customers, pools, chemicals, notes and issues, plus pool visit history. */
export const resourceRoutes: FastifyPluginAsync = async (parent) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();

  registerCrud(app, { path: '/customers', model: Customer, schemas: customer, sort: { name: 1 } });

  registerCrud(app, {
    path: '/pools',
    model: Pool,
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
};
