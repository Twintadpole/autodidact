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

/**
 * Public: the app's "Log in again" button opens this page when Cloudflare Access (the emailed-code
 * login in front of the site) has expired. Cloudflare shows its login on the way; once a request
 * gets here, the browser is logged in, so send it back to the app.
 */
export const accessLoginRoutes: FastifyPluginAsync = async (app) => {
  app.get('/access-login', async (_request, reply) => reply.redirect('/'));
};

/**
 * App/server info for the More screen and the dashboard's System card (Phase 7D). Read only.
 * The backup scripts and deploy/monitor.sh leave marker files in the backups folder (mounted read-only).
 */
export const systemRoutes: FastifyPluginAsync<{ backupDir?: string }> = async (app, { backupDir }) => {
  const read = async (name: string): Promise<string | null> => {
    if (!backupDir) return null;
    try {
      return (await fs.promises.readFile(path.join(backupDir, name), 'utf8')).trim();
    } catch {
      return null;
    }
  };
  const time = (raw: string | null | undefined) => (raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null);

  app.get('/system/status', async () => {
    const [backup, offsite, restoreCheck, monitor] = await Promise.all([read('LAST_BACKUP'), read('LAST_OFFSITE'), read('LAST_RESTORE_CHECK'), read('MONITOR_STATUS')]);
    // MONITOR_STATUS: "checked <time>" then one "down <check> <since>" line per open alert.
    const lines = (monitor ?? '').split('\n').map((l) => l.trim().split(/\s+/));
    const openAlerts = lines.filter((l) => l[0] === 'down' && l[1]).map((l) => ({ name: l[1]!, since: time(l[2]) }));
    let disk: { usedPct: number; freeGb: number } | null = null;
    if (backupDir) {
      try {
        const st = await fs.promises.statfs(backupDir);
        const total = st.blocks * st.bsize;
        const free = st.bavail * st.bsize;
        disk = { usedPct: Math.round(((total - free) / total) * 100), freeGb: Math.round((free / 1e9) * 10) / 10 };
      } catch {
        // not available
      }
    }
    return {
      lastBackupAt: time(backup),
      lastOffsiteAt: time(offsite),
      lastRestoreCheckAt: time(restoreCheck),
      monitorCheckedAt: time(lines.find((l) => l[0] === 'checked')?.[1]),
      openAlerts,
      disk,
      serverTime: new Date().toISOString(),
    };
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
