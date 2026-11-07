import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import mongoose from 'mongoose';
import type { AppConfig } from './config.js';
import { registerSessions, requireAuth } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes, photoRoutes, routeRoutes, systemRoutes } from './routes/misc.js';
import { resourceRoutes } from './routes/resources.js';
import { syncRoutes } from './routes/sync.js';
import { PhotoStore } from './services/photoStore.js';
import { HttpError } from './util.js';

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_PHOTOS_PER_PACKAGE = 30;

/** Builds the Fastify app. Does not connect to Mongo or listen (see index.ts). */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.env === 'test' ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.name, message: err.message });
    }
    if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
      return reply.code(422).send({ error: 'Unprocessable Entity', message: err.message });
    }
    if (err.validation) {
      return reply.code(400).send({ error: 'Bad Request', message: err.message, issues: err.validation });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.name, message: err.message });
    }
    request.log.error(err);
    return reply.code(500).send({ error: 'Internal Server Error', message: 'Something went wrong' });
  });

  const photos = new PhotoStore(config.photoDir);

  await registerSessions(app, config);
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS_PER_PACKAGE, fieldSize: 5 * 1024 * 1024 },
  });

  await app.register(
    async (api) => {
      // Public routes
      await api.register(healthRoutes);
      await api.register(authRoutes, { config });

      // Everything else requires the session cookie
      await api.register(async (secured) => {
        secured.addHook('preHandler', requireAuth);
        await secured.register(resourceRoutes);
        await secured.register(routeRoutes);
        await secured.register(systemRoutes, config.backupDir ? { backupDir: config.backupDir } : {});
        await secured.register(syncRoutes, { photos });
        await secured.register(photoRoutes, { photos });
      });
    },
    { prefix: '/api' },
  );

  // Serve the built PWA (Phase 6 copies it into the image) with SPA fallback.
  if (config.clientDist && fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.clientDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not Found', message: `Route ${request.method} ${request.url} not found` });
    });
  }

  return app;
}
