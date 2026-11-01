import fs from 'node:fs';
import { z } from 'zod';
import mongoose from 'mongoose';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { idSchema } from '@pool/shared';
import { Photo, Pool } from '../models/index.js';
import type { PhotoStore } from '../services/photoStore.js';

/** Public: Docker liveness check. */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_request, reply) => {
    const mongo = mongoose.connection.readyState === 1;
    return reply.code(mongo ? 200 : 503).send({ ok: mongo, mongo });
  });
};

/** Weekly service list actions. */
export const routeRoutes: FastifyPluginAsync = async (app) => {
  /** Clears every pool's weekly checkmark. */
  app.post('/route/reset-week', async () => {
    const now = new Date();
    const res = await Pool.updateMany(
      { deletedAt: null },
      { $set: { 'week.done': false, 'week.doneAt': null, 'week.changedAt': now, updatedAt: now, syncedAt: now } },
    );
    return { ok: true, pools: res.modifiedCount, resetAt: now.toISOString() };
  });
};

/** Serves stored photos. Thumbnails arrive in Phase 5; until then /thumb serves the original. */
export const photoRoutes: FastifyPluginAsync<{ photos: PhotoStore }> = async (parent, { photos: store }) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ id: idSchema });

  async function send(id: string, thumb: boolean, reply: any) {
    const photo = await Photo.findOne({ _id: id, deletedAt: null }).lean<{ file: string }>();
    if (!photo) return reply.code(404).send({ error: 'Not Found', message: 'No such photo' });
    let rel = photo.file;
    if (thumb && (await store.exists(store.thumbRelPath(rel)))) rel = store.thumbRelPath(rel);
    if (!(await store.exists(rel))) return reply.code(404).send({ error: 'Not Found', message: 'Image file missing' });
    return reply
      .type('image/jpeg')
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(fs.createReadStream(store.absPath(rel)));
  }

  app.get('/photos/:id', { schema: { params } }, (req, reply) => send(req.params.id, false, reply));
  app.get('/photos/:id/thumb', { schema: { params } }, (req, reply) => send(req.params.id, true, reply));
};
