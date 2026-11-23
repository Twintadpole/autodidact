import crypto from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { BUSINESS_SETTINGS_ID, passwordSchema } from '@pool/shared';
import type { AppConfig } from '../config.js';
import { PasswordReset, SessionDoc, Settings, User } from '../models/index.js';
import { hashPassword } from '../services/users.js';
import { mailReady, queueMail } from '../services/mail.js';
import { recordAudit } from '../services/audit.js';

/**
 * "Forgot password?" (beta segment 4). Public. The person gets a link that works once, for 30 minutes;
 * the business's owners get a notice (without the link). The answer never says whether a login exists.
 */
const TOKEN_MS = 30 * 60 * 1000;
const PER_HOUR = 3;
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export const passwordResetRoutes: FastifyPluginAsyncZod<{ config: AppConfig }> = async (app, { config }) => {
  const product = config.productName ?? 'Great Pool Friend';

  /** What the login screen may offer. */
  app.get('/auth/options', async () => ({ resetByEmail: !!config.publicUrl && (await mailReady(config.backupDir)) }));

  app.post(
    '/auth/forgot',
    {
      schema: { body: z.object({ email: z.string().trim().toLowerCase().min(1).max(200) }) },
      config: { rateLimit: config.forgotRateLimit },
    },
    async (request) => {
      const answer = { ok: true };
      if (!config.publicUrl || !isEmail(request.body.email)) return answer;
      const user = await User.findOne({ email: request.body.email, active: true }).lean<{ _id: string; email: string; name: string; role: string }>();
      if (!user) return answer;
      const now = new Date();
      if ((await PasswordReset.countDocuments({ userId: user._id, createdAt: { $gt: new Date(now.getTime() - 3600_000) } })) >= PER_HOUR) return answer;

      const token = crypto.randomBytes(32).toString('base64url');
      await PasswordReset.create({ _id: hash(token), userId: user._id, createdAt: now, expiresAt: new Date(now.getTime() + TOKEN_MS) });
      const settings = await Settings.findById(BUSINESS_SETTINGS_ID).lean<{ businessName?: string }>();
      const business = settings?.businessName || product;
      const link = `${config.publicUrl}/reset?token=${token}`;
      const role = user.role === 'owner' ? 'owner' : 'tech';
      const signature = business === product ? product : `${product} · ${business}`;

      await queueMail(
        [user.email],
        business === product ? `Reset your ${product} password` : `${business}: reset your ${product} password`,
        [
          `Hi ${user.name},`,
          '',
          `Someone (hopefully you) asked to reset the password for your ${business === product ? '' : `${business} `}login (${user.email}) in ${product}.`,
          '',
          'Open this link within 30 minutes to choose a new password:',
          link,
          '',
          'If you didn’t ask for this, ignore this email: your password stays the same.',
          '',
          signature,
        ].join('\n'),
        'reset',
        config.mailFlagDir,
      );
      // The business's owners hear about it (not the link).
      const owners = await User.find({ role: 'owner', active: true, _id: { $ne: user._id } }).lean<{ email: string }[]>();
      await queueMail(
        owners.map((o) => o.email).filter(isEmail),
        `${business}: ${user.name} asked for a new password`,
        [
          `${user.name} (${user.email}, ${role}) asked to reset their ${product} password for ${business} on ${now.toUTCString()}.`,
          '',
          'They got an email with a link that works for 30 minutes. Nothing for you to do.',
          'If this looks wrong, turn their login off in the app: More → Team.',
          '',
          signature,
        ].join('\n'),
        'reset-notice',
        config.mailFlagDir,
      );
      await recordAudit({ collectionName: 'users', docId: user._id, action: 'update', source: 'app', note: 'Password reset email requested', userId: user._id });
      return answer;
    },
  );

  app.post(
    '/auth/reset',
    {
      schema: { body: z.object({ token: z.string().min(20).max(200), password: passwordSchema }) },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const now = new Date();
      // Claim it atomically: a token works once.
      const reset = await PasswordReset.findOneAndUpdate(
        { _id: hash(request.body.token), usedAt: null, expiresAt: { $gt: now } },
        { $set: { usedAt: now } },
      ).lean<{ userId: string }>();
      if (!reset) return reply.code(400).send({ error: 'Bad Request', message: 'This link has expired or was already used. Ask for a new one.' });
      const user = await User.findOne({ _id: reset.userId, active: true }).lean<{ _id: string; email: string }>();
      if (!user) return reply.code(400).send({ error: 'Bad Request', message: 'This link has expired or was already used. Ask for a new one.' });
      await User.updateOne(
        { _id: user._id },
        { $set: { passwordHash: await hashPassword(request.body.password), mustChangePassword: false, failedLogins: 0, lockedUntil: null, updatedAt: now } },
      );
      // Every device logs in again; other links for this login stop working.
      const out = await SessionDoc.deleteMany({ 'session.userId': user._id });
      await PasswordReset.updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: now } });
      await recordAudit({ collectionName: 'users', docId: user._id, action: 'update', source: 'app', note: `Password reset by email link; ${out.deletedCount} device(s) signed out`, userId: user._id });
      return { ok: true, email: user.email };
    },
  );
};
