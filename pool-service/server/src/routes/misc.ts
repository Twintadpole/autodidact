import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import mongoose from 'mongoose';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { idSchema } from '@pool/shared';
import { Photo, Pool } from '../models/index.js';
import type { PhotoStore } from '../services/photoStore.js';
import { diff, recordAudit } from '../services/audit.js';

/** Public: Docker liveness check. */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_request, reply) => {
    const mongo = mongoose.connection.readyState === 1;
    return reply.code(mongo ? 200 : 503).send({ ok: mongo, mongo });
  });
};

/** App/server info for the More screen. */
export const systemRoutes: FastifyPluginAsync<{ backupDir?: string }> = async (app, { backupDir }) => {
  app.get('/system/status', async () => {
    let lastBackupAt: string | null = null;
    if (backupDir) {
      try {
        const raw = (await fs.promises.readFile(path.join(backupDir, 'LAST_BACKUP'), 'utf8')).trim();
        if (raw && !Number.isNaN(Date.parse(raw))) lastBackupAt = new Date(raw).toISOString();
      } catch {
        // no backup yet
      }
    }
    return { lastBackupAt, serverTime: new Date().toISOString() };
  });
};

/** Problems seen on the phone (e.g. a photo that wouldn't load), written to the server log for diagnosis. */
export const clientLogRoutes: FastifyPluginAsync = async (parent) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/client-log',
    {
      schema: {
        body: z.object({
          where: z.string().max(60),
          message: z.string().max(500),
          details: z.record(z.string(), z.unknown()).optional(),
          userAgent: z.string().max(300).optional(),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      req.log.warn({ clientProblem: req.body }, `client problem: ${req.body.where}: ${req.body.message}`);
      return { ok: true };
    },
  );
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
    await recordAudit({ collectionName: 'pools', docId: '*', action: 'bulk', source: 'app', note: `Reset week: cleared ${res.modifiedCount} checkmark(s)` });
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

  /** Photo metadata: a pool's gallery (savedToPool=true) or an issue's photos. */
  app.get(
    '/photos',
    {
      schema: {
        querystring: z.object({
          poolId: idSchema.optional(),
          issueId: idSchema.optional(),
          savedToPool: z.enum(['true', 'false']).optional(),
        }),
      },
    },
    async (req) => {
      const filter: Record<string, unknown> = { deletedAt: null };
      if (req.query.poolId) filter.poolId = req.query.poolId;
      if (req.query.issueId) filter.issueId = req.query.issueId;
      if (req.query.savedToPool) filter.savedToPool = req.query.savedToPool === 'true';
      const docs = await Photo.find(filter).sort({ takenAt: -1 }).lean<Record<string, unknown>[]>();
      return docs.map(({ file: _file, syncedAt: _s, ...rest }) => rest);
    },
  );

  /** Toggle "Save to pool" or change the caption. */
  app.patch(
    '/photos/:id',
    { schema: { params, body: z.object({ savedToPool: z.boolean().optional(), caption: z.string().max(500).optional() }) } },
    async (req, reply) => {
      const existing = await Photo.findOne({ _id: req.params.id, deletedAt: null }).lean<Record<string, unknown>>();
      if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'No such photo' });
      const now = new Date();
      const updated = await Photo.findByIdAndUpdate(req.params.id, { $set: { ...req.body, updatedAt: now, syncedAt: now } }, { returnDocument: 'after' }).lean<
        Record<string, unknown>
      >();
      await recordAudit({ collectionName: 'photos', docId: req.params.id, action: 'update', source: 'app', changes: diff(existing, req.body) });
      const { file: _file, syncedAt: _s, ...rest } = updated!;
      return rest;
    },
  );

  /** Soft delete; the image file stays on disk (and in backups). */
  app.delete('/photos/:id', { schema: { params } }, async (req, reply) => {
    const now = new Date();
    const res = await Photo.updateOne({ _id: req.params.id, deletedAt: null }, { $set: { deletedAt: now, updatedAt: now, syncedAt: now } });
    if (!res.matchedCount) return reply.code(404).send({ error: 'Not Found', message: 'No such photo' });
    await recordAudit({ collectionName: 'photos', docId: req.params.id, action: 'delete', source: 'app' });
    return { ok: true };
  });

  app.get('/photos/:id', { schema: { params } }, (req, reply) => send(req.params.id, false, reply));
  app.get('/photos/:id/thumb', { schema: { params } }, (req, reply) => send(req.params.id, true, reply));
};
