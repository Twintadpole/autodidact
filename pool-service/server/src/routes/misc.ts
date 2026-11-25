import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import mongoose from 'mongoose';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BUSINESS_SETTINGS_ID, idSchema } from '@pool/shared';
import crypto from 'node:crypto';
import { ClientError, Feedback, Photo, Pool, Settings, User } from '../models/index.js';
import { queueMail } from '../services/mail.js';
import type { AppConfig } from '../config.js';
import type { PhotoStore } from '../services/photoStore.js';
import { diff, recordAudit } from '../services/audit.js';
import { scopeFilter } from '../services/scope.js';
import { isOwner } from '../services/users.js';

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

/**
 * Problems seen on the phone (e.g. a photo that wouldn't load, an error in a screen), written to the
 * server log and kept, counted, in `clientErrors` (beta: the operator reads them with tenant.sh errors).
 */
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
          stack: z.string().max(2000).optional(),
          screen: z.string().max(200).optional(),
          appVersion: z.string().max(40).optional(),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const b = req.body;
      req.log.warn({ clientProblem: b }, `client problem: ${b.where}: ${b.message}`);
      // One record per kind of problem: numbers and ids in the message don't make a new one.
      const shape = b.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>').replace(/\d+/g, '<n>');
      const id = crypto.createHash('sha256').update(`${b.where}|${shape}|${b.appVersion ?? ''}`).digest('hex').slice(0, 32);
      const now = new Date();
      await ClientError.updateOne(
        { _id: id },
        {
          $set: { where: b.where, message: b.message, stack: b.stack, screen: b.screen, appVersion: b.appVersion, userId: req.actor?.userId, userAgent: b.userAgent, lastAt: now },
          $setOnInsert: { firstAt: now },
          $inc: { count: 1 },
        },
        { upsert: true },
      );
      return { ok: true };
    },
  );
};

/** "Send feedback" (beta). Anyone signed in sends; the owner reads them all and marks them done. */
export const feedbackRoutes: FastifyPluginAsync<{ config: AppConfig }> = async (parent, { config }) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/feedback',
    {
      schema: {
        body: z.object({
          _id: idSchema.optional(),
          kind: z.enum(['problem', 'idea', 'question', 'other']).optional(),
          text: z.string().trim().min(1).max(4000),
          screen: z.string().max(200).optional(),
          appVersion: z.string().max(40).optional(),
          language: z.string().max(10).optional(),
          userAgent: z.string().max(300).optional(),
          createdAt: z.string().datetime().optional(),
        }),
      },
      config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
    },
    async (req, reply) => {
      const b = req.body;
      const _id = b._id ?? crypto.randomUUID();
      // Sent again after a lost answer (the phone retries): the first copy stands.
      if (await Feedback.exists({ _id })) return reply.code(200).send({ ok: true, _id });
      await Feedback.create({
        _id, userId: req.actor!.userId, userName: req.actor!.name, role: req.actor!.role, kind: b.kind ?? 'other', text: b.text,
        screen: b.screen, appVersion: b.appVersion, language: b.language, userAgent: b.userAgent,
        createdAt: b.createdAt ? new Date(b.createdAt) : new Date(),
      });
      // Also emailed to support (beta), with the person's email as the reply address.
      if (config.supportEmail) {
        const me = await User.findById(req.actor!.userId, { email: 1 }).lean<{ email?: string }>();
        const settings = await Settings.findById(BUSINESS_SETTINGS_ID, { businessName: 1 }).lean<{ businessName?: string }>();
        const product = config.productName ?? 'Great Pool Friend';
        const business = settings?.businessName || product;
        const kind = { problem: 'Problem', idea: 'Idea', question: 'Question', other: 'Feedback' }[b.kind ?? 'other'];
        await queueMail(
          [config.supportEmail],
          `[${product} feedback] ${business}: ${kind} from ${req.actor!.name}`,
          [
            b.text,
            '',
            '—',
            `Business: ${business}${config.publicUrl ? ` (${config.publicUrl})` : ''}`,
            `From: ${req.actor!.name} <${me?.email ?? '?'}>, ${req.actor!.role}`,
            `Kind: ${kind}`,
            `Screen: ${b.screen ?? '—'} · App version: ${b.appVersion ?? '?'} · Language: ${b.language ?? '?'}`,
            `Sent: ${new Date().toUTCString()}`,
            '',
            me?.email && /@/.test(me.email) ? 'Reply to this email to answer them.' : 'Their login is not an email address: answer them in person.',
          ].join('\n'),
          'feedback',
          config.mailFlagDir,
          me?.email,
        );
      }
      return reply.code(201).send({ ok: true, _id });
    },
  );
  /** An owner sees everyone's; a tech sees their own. */
  app.get('/feedback', async (req) => {
    const filter = isOwner(req.actor) ? {} : { userId: req.actor!.userId };
    const items = await Feedback.find(filter, { userAgent: 0 }).sort({ createdAt: -1 }).limit(200).lean();
    return { items };
  });
  app.patch(
    '/feedback/:id',
    { schema: { params: z.object({ id: idSchema }), body: z.object({ done: z.boolean() }) } },
    async (req, reply) => {
      if (!isOwner(req.actor)) return reply.code(403).send({ error: 'Forbidden', message: 'Only an owner can do that' });
      const res = await Feedback.updateOne({ _id: req.params.id }, { $set: { doneAt: req.body.done ? new Date() : null } });
      if (!res.matchedCount) return reply.code(404).send({ error: 'Not Found', message: 'No such feedback' });
      return { ok: true };
    },
  );
};

/** Weekly service list actions. */
export const routeRoutes: FastifyPluginAsync = async (app) => {
  /** Clears every pool's weekly checkmark (a tech: the pools on their route). */
  app.post('/route/reset-week', async (request) => {
    const now = new Date();
    const mine = isOwner(request.actor) ? {} : { techId: request.actor!.userId };
    const res = await Pool.updateMany(
      { deletedAt: null, ...mine },
      { $set: { 'week.done': false, 'week.doneAt': null, 'week.changedAt': now, updatedAt: now, syncedAt: now } },
    );
    await recordAudit({ collectionName: 'pools', docId: '*', action: 'bulk', source: 'app', note: `Reset week: cleared ${res.modifiedCount} checkmark(s)`, userId: request.actor!.userId });
    return { ok: true, pools: res.modifiedCount, resetAt: now.toISOString() };
  });
};

/** Serves stored photos. Thumbnails arrive in Phase 5; until then /thumb serves the original. */
export const photoRoutes: FastifyPluginAsync<{ photos: PhotoStore }> = async (parent, { photos: store }) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ id: idSchema });

  /** Only photos of pools the user may see (techs: their route). */
  const mine = async (req: { actor?: import('../services/users.js').Actor }) => (await scopeFilter('photos', req.actor!))!;

  async function send(req: any, id: string, thumb: boolean, reply: any) {
    const photo = await Photo.findOne({ _id: id, deletedAt: null, ...(await mine(req)) }).lean<{ file: string }>();
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
      const filter: Record<string, unknown> = { deletedAt: null, ...(await mine(req)) };
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
      const existing = await Photo.findOne({ _id: req.params.id, deletedAt: null, ...(await mine(req)) }).lean<Record<string, unknown>>();
      if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'No such photo' });
      const now = new Date();
      const updated = await Photo.findByIdAndUpdate(req.params.id, { $set: { ...req.body, updatedAt: now, syncedAt: now } }, { returnDocument: 'after' }).lean<
        Record<string, unknown>
      >();
      await recordAudit({ collectionName: 'photos', docId: req.params.id, action: 'update', source: 'app', changes: diff(existing, req.body), userId: req.actor!.userId });
      const { file: _file, syncedAt: _s, ...rest } = updated!;
      return rest;
    },
  );

  /** Soft delete; the image file stays on disk (and in backups). */
  app.delete('/photos/:id', { schema: { params } }, async (req, reply) => {
    const now = new Date();
    const res = await Photo.updateOne({ _id: req.params.id, deletedAt: null, ...(await mine(req)) }, { $set: { deletedAt: now, updatedAt: now, syncedAt: now } });
    if (!res.matchedCount) return reply.code(404).send({ error: 'Not Found', message: 'No such photo' });
    await recordAudit({ collectionName: 'photos', docId: req.params.id, action: 'delete', source: 'app', userId: req.actor!.userId });
    return { ok: true };
  });

  app.get('/photos/:id', { schema: { params } }, (req, reply) => send(req, req.params.id, false, reply));
  app.get('/photos/:id/thumb', { schema: { params } }, (req, reply) => send(req, req.params.id, true, reply));
};
