import { z } from 'zod';
import type { Model } from 'mongoose';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { idSchema } from '@pool/shared';
import { newId, queryBool } from '../util.js';

export interface CrudOptions {
  /** URL path, e.g. "/customers". */
  path: string;
  model: Model<any>;
  schemas: { create: z.ZodType; patch: z.ZodType };
  /** Extra query-string filters for GET list, mapped to a Mongo filter. */
  listQuery?: z.ZodObject;
  toFilter?: (query: any) => Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
  /** Adjust a create/patch body before writing (e.g. issue status timestamps). */
  beforeWrite?: (body: Record<string, any>, existing: Record<string, any> | null, now: Date) => Record<string, any>;
}

const idParams = z.object({ id: idSchema });
const baseListQuery = z.object({ includeDeleted: queryBool.default(false) });

/**
 * Registers GET list, GET one, POST, PATCH and (soft) DELETE for a collection.
 * These are for online edits; the phone normally writes through `/sync/package`.
 */
export function registerCrud(parent: FastifyInstance, opts: CrudOptions): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { model, path } = opts;
  const listQuery = opts.listQuery ? baseListQuery.extend(opts.listQuery.shape) : baseListQuery;

  app.get(path, { schema: { querystring: listQuery } }, async (request) => {
    const query = request.query as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = { ...(opts.toFilter?.(query) ?? {}) };
    if (!query.includeDeleted) filter.deletedAt = null;
    return model
      .find(filter)
      .sort(opts.sort ?? { createdAt: 1 })
      .lean();
  });

  app.get(`${path}/:id`, { schema: { params: idParams } }, async (request, reply) => {
    const doc = await model.findById(request.params.id).lean();
    if (!doc) return reply.code(404).send({ error: 'Not Found', message: `No document ${request.params.id}` });
    return doc;
  });

  app.post(`${path}`, { schema: { body: opts.schemas.create } }, async (request, reply) => {
    const now = new Date();
    let body = { ...(request.body as Record<string, any>) };
    body = opts.beforeWrite?.(body, null, now) ?? body;
    const _id = body._id ?? newId();
    if (await model.exists({ _id })) {
      return reply.code(409).send({ error: 'Conflict', message: `Document ${_id} already exists` });
    }
    const [created] = await model.create([{ ...body, _id, createdAt: now, updatedAt: now, deletedAt: null, syncedAt: now }]);
    return reply.code(201).send(created!.toObject());
  });

  app.patch(`${path}/:id`, { schema: { params: idParams, body: opts.schemas.patch } }, async (request, reply) => {
    const existing = await model.findOne({ _id: request.params.id, deletedAt: null }).lean<Record<string, any>>();
    if (!existing) return reply.code(404).send({ error: 'Not Found', message: `No document ${request.params.id}` });
    const now = new Date();
    let body = { ...(request.body as Record<string, any>) };
    body = opts.beforeWrite?.(body, existing, now) ?? body;
    delete body._id;
    const updated = await model
      .findByIdAndUpdate(
        request.params.id,
        { $set: { ...body, updatedAt: now, syncedAt: now } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean();
    return updated;
  });

  app.delete(`${path}/:id`, { schema: { params: idParams } }, async (request, reply) => {
    const now = new Date();
    const updated = await model
      .findOneAndUpdate(
        { _id: request.params.id, deletedAt: null },
        { $set: { deletedAt: now, updatedAt: now, syncedAt: now } },
        { returnDocument: 'after' },
      )
      .lean();
    if (!updated) return reply.code(404).send({ error: 'Not Found', message: `No document ${request.params.id}` });
    return updated;
  });
}
