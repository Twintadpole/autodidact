import crypto from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { changePasswordSchema, loginBodySchema, type Device } from '@pool/shared';
import type { AppConfig } from '../config.js';
import { SessionDoc, User } from '../models/index.js';
import { deviceName, REMEMBER_ME_MS, requireAuth } from '../plugins/auth.js';
import { hashPassword, toMe, toMember, verifyLogin } from '../services/users.js';
import { recordAudit } from '../services/audit.js';

/** A device's id in the Devices list: a hash of its session id (the session id itself stays secret). */
const deviceId = (sid: string) => crypto.createHash('sha256').update(sid).digest('hex').slice(0, 16);
/** The key this session is stored under (@fastify/session keeps it apart from the cookie's id). */
const storeId = (session: { sessionId: string }) => (session as { sessionStoreId?: string }).sessionStoreId ?? session.sessionId;

export const authRoutes: FastifyPluginAsyncZod<{ config: AppConfig }> = async (app, { config }) => {
  app.post(
    '/auth/login',
    {
      schema: { body: loginBodySchema },
      config: { rateLimit: config.loginRateLimit },
    },
    async (request, reply) => {
      const result = await verifyLogin(request.body.email, request.body.password);
      if ('error' in result) {
        return result.error === 'locked'
          ? reply.code(429).send({ error: 'Too Many Requests', message: 'Too many wrong passwords for this login. Try again in 15 minutes.' })
          : reply.code(401).send({ error: 'Unauthorized', message: 'Wrong email or password' });
      }
      // New session ID on login (prevents session fixation).
      await request.session.regenerate();
      const now = new Date().toISOString();
      request.session.set('authenticated', true);
      request.session.set('userId', result.user._id);
      request.session.set('device', deviceName(request.headers['user-agent']));
      request.session.set('signedInAt', now);
      request.session.set('lastSeenAt', now);
      if (request.body.remember) request.session.cookie.maxAge = REMEMBER_ME_MS;
      await request.session.save();
      return { ok: true, me: toMe(result.user) };
    },
  );

  app.post('/auth/logout', async (request) => {
    await request.session.destroy();
    return { ok: true };
  });

  app.register(async (inner) => {
    const secured = inner.withTypeProvider<ZodTypeProvider>();
    secured.addHook('preValidation', requireAuth);

    secured.get('/auth/me', async (request) => {
      const user = await User.findById(request.actor!.userId).lean();
      const team = (await User.find({}).sort({ role: 1, name: 1 }).lean()).map(toMember);
      return { authenticated: true, me: toMe(user!), team };
    });

    secured.post('/auth/password', { schema: { body: changePasswordSchema } }, async (request, reply) => {
      const user = await User.findById(request.actor!.userId).lean<{ _id: string; passwordHash: string }>();
      if (!user || !(await argon2.verify(user.passwordHash, request.body.current).catch(() => false))) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Your current password is not right' });
      }
      await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(request.body.password), mustChangePassword: false, updatedAt: new Date() } });
      // Other devices must log in again with the new password.
      const others = await SessionDoc.deleteMany({ 'session.userId': user._id, _id: { $ne: storeId(request.session) } });
      await recordAudit({ collectionName: 'users', docId: user._id, action: 'update', source: 'app', note: `Password changed; ${others.deletedCount} other device(s) signed out`, userId: user._id });
      return { ok: true, signedOut: others.deletedCount };
    });

    secured.get('/auth/devices', async (request): Promise<Device[]> => {
      const sessions = await SessionDoc.find({ 'session.userId': request.actor!.userId, expiresAt: { $gt: new Date() } }).lean<{ _id: string; session: Record<string, any> }[]>();
      return sessions
        .map((s) => ({
          id: deviceId(s._id),
          current: s._id === storeId(request.session),
          device: s.session.device ?? 'Device',
          signedInAt: s.session.signedInAt ?? null,
          lastSeenAt: s.session.lastSeenAt ?? null,
        }))
        .sort((a, b) => Number(b.current) - Number(a.current) || String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
    });

    /** Sign out one device (lost phone), or every other device with id "others". */
    secured.delete('/auth/devices/:id', { schema: { params: z.object({ id: z.string().min(1).max(64) }) } }, async (request) => {
      const mine = await SessionDoc.find({ 'session.userId': request.actor!.userId }, { _id: 1 }).lean<{ _id: string }[]>();
      const ids =
        request.params.id === 'others'
          ? mine.map((s) => s._id).filter((sid) => sid !== storeId(request.session))
          : mine.map((s) => s._id).filter((sid) => deviceId(sid) === request.params.id);
      const res = await SessionDoc.deleteMany({ _id: { $in: ids } });
      if (res.deletedCount) {
        await recordAudit({ collectionName: 'users', docId: request.actor!.userId, action: 'update', source: 'app', note: `Signed out ${res.deletedCount} device(s)`, userId: request.actor!.userId });
      }
      return { ok: true, signedOut: res.deletedCount };
    });
  });
};
