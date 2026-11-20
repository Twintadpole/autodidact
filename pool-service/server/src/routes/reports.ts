import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Pool, Visit } from '../models/index.js';
import { customerHours } from '../services/customerHours.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Reports that need every visit (the phone keeps only recent ones). */
export const reportRoutes: FastifyPluginAsync = async (parent) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  app.get(
    '/reports/customer-hours',
    { schema: { querystring: z.object({ from: day, to: day, tzOffsetMin: z.coerce.number().int().min(-840).max(840).default(0) }) } },
    async (req) => customerHours(req.query),
  );

  /**
   * Every visit in a date range, newest first (the desktop Visits table, Phase 7D). Read only.
   * `from`/`to` are the owner's local dates; visits of deleted pools are left out.
   */
  app.get(
    '/reports/visits',
    {
      schema: {
        querystring: z.object({
          from: day,
          to: day,
          tzOffsetMin: z.coerce.number().int().min(-840).max(840).default(0),
          limit: z.coerce.number().int().min(1).max(5000).default(2000),
        }),
      },
    },
    async (req) => {
      const { from, to, tzOffsetMin, limit } = req.query;
      // Local midnight of `from` up to local midnight after `to`, as UTC instants.
      const start = new Date(new Date(`${from}T00:00:00.000Z`).getTime() + tzOffsetMin * 60_000);
      const end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000 + tzOffsetMin * 60_000);
      const visits = await Visit.find({ deletedAt: null, visitedAt: { $gte: start, $lt: end } })
        .sort({ visitedAt: -1 })
        .limit(limit)
        .lean<{ poolId: string }[]>();
      if (!visits.length) return visits;
      const livePools = new Set(
        (await Pool.find({ _id: { $in: [...new Set(visits.map((v) => v.poolId))] }, deletedAt: null }, { _id: 1 }).lean<{ _id: string }[]>()).map((p) => p._id),
      );
      return visits.filter((v) => livePools.has(v.poolId));
    },
  );
};
