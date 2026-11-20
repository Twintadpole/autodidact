import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assignPoolsSchema, idSchema, teamCreateSchema, teamPatchSchema } from '@pool/shared';
import { Pool, SessionDoc, User } from '../models/index.js';
import { recordAudit } from '../services/audit.js';
import { bumpAccess, hashPassword, tempPassword, toMemberFull } from '../services/users.js';
import { HttpError, newId } from '../util.js';

/**
 * Team (GPF item 3), owner only (registered behind requireOwner). No email is sent yet: a new
 * login and a reset both return a temporary password once, for the owner to pass on; the app
 * asks for a new password at the first login with it.
 */
export const teamRoutes: FastifyPluginAsync = async (parent) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const params = z.object({ id: z.string().min(1).max(64) });

  async function activeOwnersBesides(id: string) {
    return User.countDocuments({ role: 'owner', active: true, _id: { $ne: id } });
  }

  app.get('/team', async () => (await User.find({}).sort({ active: -1, role: 1, name: 1 }).lean()).map(toMemberFull));

  app.post('/team', { schema: { body: teamCreateSchema } }, async (req, reply) => {
    if (await User.exists({ email: req.body.email })) return reply.code(409).send({ error: 'Conflict', message: 'That email already has a login' });
    const password = tempPassword();
    const now = new Date();
    const _id = newId();
    await User.create({ _id, ...req.body, passwordHash: await hashPassword(password), mustChangePassword: true, createdAt: now, updatedAt: now });
    await recordAudit({ collectionName: 'users', docId: _id, action: 'create', source: 'app', note: `${req.body.role} login for ${req.body.name}`, userId: req.actor!.userId });
    return reply.code(201).send({ member: toMemberFull((await User.findById(_id).lean())!), password });
  });

  app.patch('/team/:id', { schema: { params, body: teamPatchSchema } }, async (req) => {
    const user = await User.findById(req.params.id).lean<Record<string, any>>();
    if (!user) throw new HttpError(404, 'No such login');
    const losingOwner = user.role === 'owner' && user.active && (req.body.role === 'tech' || req.body.active === false);
    if (losingOwner && !(await activeOwnersBesides(user._id))) throw new HttpError(409, 'There must always be at least one active owner');
    if (req.body.email && req.body.email !== user.email && (await User.exists({ email: req.body.email }))) throw new HttpError(409, 'That email already has a login');
    await User.updateOne({ _id: user._id }, { $set: { ...req.body, updatedAt: new Date() } });
    if (req.body.active === false) await SessionDoc.deleteMany({ 'session.userId': user._id });
    if (req.body.role && req.body.role !== user.role) await bumpAccess([user._id]);
    const changes = Object.entries(req.body).map(([path, to]) => ({ path, from: user[path] ?? null, to }));
    await recordAudit({ collectionName: 'users', docId: user._id, action: 'update', source: 'app', changes, userId: req.actor!.userId });
    return toMemberFull((await User.findById(user._id).lean())!);
  });

  /** New temporary password; every device of that login is signed out. */
  app.post('/team/:id/reset-password', { schema: { params } }, async (req) => {
    const user = await User.findById(req.params.id).lean<{ _id: string; name: string }>();
    if (!user) throw new HttpError(404, 'No such login');
    const password = tempPassword();
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null, updatedAt: new Date() } });
    const out = await SessionDoc.deleteMany({ 'session.userId': user._id });
    await recordAudit({ collectionName: 'users', docId: user._id, action: 'update', source: 'app', note: `Password reset; ${out.deletedCount} device(s) signed out`, userId: req.actor!.userId });
    return { password, signedOut: out.deletedCount };
  });

  /** Put pools on a tech's route (techId), or on nobody's (null). */
  app.post('/pools/assign', { schema: { body: assignPoolsSchema } }, async (req) => {
    const { poolIds, techId } = req.body;
    if (techId) {
      const tech = await User.findById(techId).lean<{ active: boolean }>();
      if (!tech || !tech.active) throw new HttpError(404, 'No such active login');
    }
    if (!poolIds.every((id) => idSchema.safeParse(id).success)) throw new HttpError(400, 'Bad pool id');
    const pools = await Pool.find({ _id: { $in: poolIds }, deletedAt: null }, { techId: 1 }).lean<{ _id: string; techId?: string | null }[]>();
    const moving = pools.filter((p) => (p.techId ?? null) !== techId);
    const now = new Date();
    if (moving.length) {
      await Pool.updateMany({ _id: { $in: moving.map((p) => p._id) } }, { $set: { techId, updatedAt: now, syncedAt: now } });
      await bumpAccess([techId, ...moving.map((p) => p.techId)], now);
      for (const p of moving) {
        await recordAudit({ collectionName: 'pools', docId: p._id, action: 'update', source: 'app', changes: [{ path: 'techId', from: p.techId ?? null, to: techId }], userId: req.actor!.userId });
      }
    }
    return { ok: true, moved: moving.length };
  });
};
