import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
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
};
