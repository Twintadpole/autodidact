import argon2 from 'argon2';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppConfig } from '../config.js';
import { REMEMBER_ME_MS, requireAuth } from '../plugins/auth.js';

const loginBody = z.object({
  password: z.string().min(1),
  remember: z.boolean().default(false),
});

export const authRoutes: FastifyPluginAsyncZod<{ config: AppConfig }> = async (app, { config }) => {
  app.post(
    '/auth/login',
    {
      schema: { body: loginBody },
      config: { rateLimit: config.loginRateLimit },
    },
    async (request, reply) => {
      const ok = await argon2.verify(config.adminPasswordHash, request.body.password).catch(() => false);
      if (!ok) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Wrong password' });
      }
      // New session ID on login (prevents session fixation).
      await request.session.regenerate();
      request.session.set('authenticated', true);
      if (request.body.remember) {
        request.session.cookie.maxAge = REMEMBER_ME_MS;
      }
      await request.session.save();
      return { ok: true };
    },
  );

  app.post('/auth/logout', async (request) => {
    await request.session.destroy();
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async () => ({ authenticated: true }));
};
