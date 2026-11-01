import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { syncPackageSchema, syncPullQuerySchema, type SyncPullResponse } from '@pool/shared';
import { Issue, Photo, SYNC_MODELS, Visit } from '../models/index.js';
import { applyPackage } from '../services/applyPackage.js';
import type { PhotoStore } from '../services/photoStore.js';
import { HttpError } from '../util.js';

/** Re-read a few seconds back so writes committing during a pull aren't missed. */
const PULL_OVERLAP_MS = 5_000;
const RESOLVED_ISSUE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const VISITS_PER_POOL_ON_FIRST_PULL = 2;

function stripServerFields<T extends Record<string, any>>(doc: T): T {
  const { syncedAt: _s, file: _f, ...rest } = doc;
  return rest as T;
}

interface ParsedUpload {
  body: unknown;
  /** photoId → absolute temp path */
  temps: Map<string, string>;
}

async function readUpload(request: FastifyRequest, store: PhotoStore): Promise<ParsedUpload> {
  if (!request.isMultipart()) return { body: request.body, temps: new Map() };

  const temps = new Map<string, string>();
  let body: unknown;
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        temps.set(part.fieldname, await store.writeTemp(part.file));
        if (part.file.truncated) throw new HttpError(413, `Photo ${part.fieldname} is too large`);
      } else if (part.fieldname === 'package') {
        try {
          body = JSON.parse(String(part.value));
        } catch {
          throw new HttpError(400, 'Field "package" is not valid JSON');
        }
      }
    }
  } catch (err) {
    await Promise.all([...temps.values()].map((t) => store.remove(t)));
    throw err;
  }
  return { body, temps };
}

export const syncRoutes: FastifyPluginAsync<{ photos: PhotoStore }> = async (app, { photos: store }) => {
  app.get('/sync/pull', async (request) => {
    const { since } = syncPullQuerySchema.parse(request.query);
    const serverTime = new Date();
    const result: Record<string, unknown[]> = {};

    if (since) {
      const filter = { syncedAt: { $gt: new Date(since.getTime() - PULL_OVERLAP_MS) } };
      for (const [name, model] of Object.entries(SYNC_MODELS)) {
        result[name] = (await model.find(filter).lean()).map(stripServerFields);
      }
    } else {
      // First pull: everything live, but only what the phone keeps locally:
      // the last 2 visits per pool and open + recently resolved issues.
      for (const [name, model] of Object.entries(SYNC_MODELS)) {
        if (model === Visit || model === Issue) continue;
        result[name] = (await model.find({ deletedAt: null }).lean()).map(stripServerFields);
      }
      const grouped = await Visit.aggregate<{ docs: Record<string, any>[] }>([
        { $match: { deletedAt: null } },
        {
          $group: {
            _id: '$poolId',
            docs: { $topN: { n: VISITS_PER_POOL_ON_FIRST_PULL, sortBy: { visitedAt: -1 }, output: '$$ROOT' } },
          },
        },
      ]);
      result.visits = grouped.flatMap((g) => g.docs).map(stripServerFields);
      result.issues = (
        await Issue.find({
          deletedAt: null,
          $or: [{ status: { $ne: 'resolved' } }, { resolvedAt: { $gte: new Date(serverTime.getTime() - RESOLVED_ISSUE_WINDOW_MS) } }],
        }).lean()
      ).map(stripServerFields);
    }

    return { serverTime: serverTime.toISOString(), ...result } as unknown as SyncPullResponse;
  });

  app.post('/sync/package', async (request, reply) => {
    const { body, temps } = await readUpload(request, store);
    const placed: string[] = [];
    try {
      const parsed = syncPackageSchema.safeParse(body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Invalid package', issues: parsed.error.issues });
      }
      const pkg = parsed.data;

      const knownPhotoIds = new Set(pkg.photos.map((p) => p._id));
      for (const fieldname of temps.keys()) {
        if (!knownPhotoIds.has(fieldname)) throw new HttpError(400, `File "${fieldname}" has no matching photo metadata`);
      }

      // Move images into place before the transaction so a committed photo
      // document never points at a missing file.
      const photoFiles = new Map<string, string>();
      for (const p of pkg.photos) {
        const tmp = temps.get(p._id);
        if (!tmp) continue;
        const rel = store.relPath(p._id, p.takenAt);
        await store.place(tmp, rel);
        temps.delete(p._id);
        placed.push(p._id);
        photoFiles.set(p._id, rel);
      }

      try {
        const result = await applyPackage(pkg, { photoFiles });
        return result;
      } catch (err) {
        // Roll back files that no committed photo document refers to.
        for (const id of placed) {
          if (!(await Photo.exists({ _id: id }))) await store.remove(store.absPath(photoFiles.get(id)!));
        }
        throw err;
      }
    } finally {
      await Promise.all([...temps.values()].map((t) => store.remove(t)));
    }
  });
};
