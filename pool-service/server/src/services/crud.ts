import { z } from 'zod';
import type { Model } from 'mongoose';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { idSchema } from '@pool/shared';
import { HttpError, newId, queryBool } from '../util.js';
import { diff, recordAudit } from './audit.js';
import { redact, scopeFilter } from './scope.js';
import { isOwner, type Actor } from './users.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
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
  beforeWrite?: (body: Record<string, any>, existing: Record<string, any> | null, now: Date, actor: Actor) => Record<string, any>;
  /**
   * What a tech may do (GPF item 3): 'none' = owner only; 'read' = list and view;
   * 'write' = also add and edit (default). Deleting needs `techDelete`. Techs only ever reach
   * records in their scope (see scope.ts) and get the redacted copy.
   */
  techAccess?: 'none' | 'read' | 'write';
  techDelete?: boolean;
  /** A tech's create/patch body: drop owner-only fields, check references. Throw HttpError to refuse. */
  techBody?: (body: Record<string, any>, existing: Record<string, any> | null, actor: Actor) => Promise<Record<string, any>> | Record<string, any>;
  /** After a create or patch, with the stored copies before and after. */
  afterWrite?: (before: Record<string, any> | null, after: Record<string, any>, actor: Actor) => Promise<unknown>;
  /** Runs after a soft delete (e.g. hide a pool's visits and issues too). */
  afterDelete?: (id: string, now: Date, actor: Actor) => Promise<unknown>;
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
  const collection = model.collection.name;
  const listQuery = opts.listQuery ? baseListQuery.extend(opts.listQuery.shape) : baseListQuery;
  const techAccess = opts.techAccess ?? 'write';

  /** Filter for this actor, or throws: techs without access get a 403. */
  async function scoped(actor: Actor, need: 'read' | 'write' | 'delete'): Promise<Record<string, unknown>> {
    if (!isOwner(actor)) {
      const allowed = need === 'read' ? techAccess !== 'none' : need === 'write' ? techAccess === 'write' : techAccess === 'write' && !!opts.techDelete;
      if (!allowed) throw new HttpError(403, 'Only an owner can do that');
    }
    const f = await scopeFilter(collection, actor);
    if (!f) throw new HttpError(403, 'Only an owner can do that');
    return f;
  }
  const out = (doc: any, actor: Actor) => (doc ? redact(collection, doc, actor) : doc);

  app.get(path, { schema: { querystring: listQuery } }, async (request) => {
    const actor = request.actor!;
    const query = request.query as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = { ...(opts.toFilter?.(query) ?? {}) };
    if (!query.includeDeleted) filter.deletedAt = null;
    const scope = await scoped(actor, 'read');
    const docs = await model
      .find({ $and: [filter, scope] })
      .sort(opts.sort ?? { createdAt: 1 })
      .lean();
    return docs.map((d) => out(d, actor)).filter(Boolean);
  });

  app.get(`${path}/:id`, { schema: { params: idParams } }, async (request, reply) => {
    const scope = await scoped(request.actor!, 'read');
    const doc = await model.findOne({ $and: [{ _id: request.params.id }, scope] }).lean();
    if (!doc) return reply.code(404).send({ error: 'Not Found', message: `No document ${request.params.id}` });
    return out(doc, request.actor!);
  });

  app.post(`${path}`, { schema: { body: opts.schemas.create } }, async (request, reply) => {
    const actor = request.actor!;
    await scoped(actor, 'write');
    const now = new Date();
    let body = { ...(request.body as Record<string, any>) };
    if (!isOwner(actor) && opts.techBody) body = await opts.techBody(body, null, actor);
    body = opts.beforeWrite?.(body, null, now, actor) ?? body;
    const _id = body._id ?? newId();
    if (await model.exists({ _id })) {
      return reply.code(409).send({ error: 'Conflict', message: `Document ${_id} already exists` });
    }
    const [created] = await model.create([{ ...body, _id, createdAt: now, updatedAt: now, deletedAt: null, syncedAt: now }]);
    const doc = created!.toObject();
    await recordAudit({ collectionName: collection, docId: _id, action: 'create', source: 'app', userId: actor.userId });
    await opts.afterWrite?.(null, doc, actor);
    return reply.code(201).send(out(doc, actor));
  });

  app.patch(`${path}/:id`, { schema: { params: idParams, body: opts.schemas.patch } }, async (request, reply) => {
    const actor = request.actor!;
    const scope = await scoped(actor, 'write');
    const existing = await model.findOne({ $and: [{ _id: request.params.id, deletedAt: null }, scope] }).lean<Record<string, any>>();
    if (!existing) return reply.code(404).send({ error: 'Not Found', message: `No document ${request.params.id}` });
    const now = new Date();
    let body = { ...(request.body as Record<string, any>) };
    if (!isOwner(actor) && opts.techBody) body = await opts.techBody(body, existing, actor);
    body = opts.beforeWrite?.(body, existing, now, actor) ?? body;
    delete body._id;
    const updated = await model
      .findByIdAndUpdate(
        request.params.id,
        { $set: { ...body, updatedAt: now, syncedAt: now } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<Record<string, any>>();
    await recordAudit({ collectionName: collection, docId: request.params.id, action: 'update', source: 'app', changes: diff(existing, body), userId: actor.userId });
    await opts.afterWrite?.(existing, updated!, actor);
    return out(updated, actor);
  });

  app.delete(`${path}/:id`, { schema: { params: idParams } }, async (request, reply) => {
    const actor = request.actor!;
    const scope = await scoped(actor, 'delete');
    const now = new Date();
    const updated = await model
      .findOneAndUpdate(
        { $and: [{ _id: request.params.id, deletedAt: null }, scope] },
        { $set: { deletedAt: now, updatedAt: now, syncedAt: now } },
        { returnDocument: 'after' },
      )
      .lean();
    if (!updated) return reply.code(404).send({ error: 'Not Found', message: `No document ${request.params.id}` });
    await recordAudit({ collectionName: collection, docId: request.params.id, action: 'delete', source: 'app', userId: actor.userId });
    await opts.afterDelete?.(request.params.id, now, actor);
    return out(updated, actor);
  });
}
