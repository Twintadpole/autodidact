import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { SessionDoc, User } from '../models/index.js';
import type { AppConfig } from '../config.js';
import { firstOwnerId, touchActive, type Actor } from '../services/users.js';

declare module 'fastify' {
  interface Session {
    authenticated?: boolean;
    /** GPF item 3. Sessions from before accounts have none: they belong to the first owner. */
    userId?: string;
    device?: string;
    signedInAt?: string;
    lastSeenAt?: string;
  }
  interface FastifyRequest {
    actor?: Actor;
  }
}

/** Sessions without "remember this device" are kept server-side for a day. */
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const REMEMBER_ME_MS = 90 * 24 * 60 * 60 * 1000;

type Callback = (err?: unknown, result?: any) => void;

const METADATA_KEY = '__fastifySessionMetadata';

function generationOf(sid: string, session: any): string {
  return session?.[METADATA_KEY]?.generation ?? sid;
}

function toStored(sid: string, session: any) {
  const expires: Date | null = session?.cookie?.expires ? new Date(session.cookie.expires) : null;
  return {
    session: JSON.parse(JSON.stringify(session)),
    generation: generationOf(sid, session),
    expiresAt: expires ?? new Date(Date.now() + DEFAULT_SESSION_TTL_MS),
  };
}

/** Minimal session store backed by the `sessions` collection (TTL index cleans up). */
const mongoSessionStore = {
  set(sid: string, session: any, cb: Callback) {
    SessionDoc.updateOne({ _id: sid }, { $set: toStored(sid, session) }, { upsert: true })
      .then(() => cb())
      .catch(cb);
  },
  /** Only overwrite if nobody regenerated the session since we loaded it. */
  compareAndSet(sid: string, expectedGeneration: string, session: any, cb: Callback) {
    SessionDoc.updateOne({ _id: sid, generation: expectedGeneration }, { $set: toStored(sid, session) })
      .then((res) => {
        if (res.matchedCount === 1) return cb();
        const err = Object.assign(new Error('The session does not exist or has changed'), { code: 'ENOENT' });
        cb(err);
      })
      .catch(cb);
  },
  get(sid: string, cb: Callback) {
    SessionDoc.findById(sid)
      .lean<{ session: Record<string, unknown>; generation: string; expiresAt: Date }>()
      .then((doc) => {
        if (!doc || doc.expiresAt <= new Date()) return cb(null, null);
        cb(null, { ...doc.session, [METADATA_KEY]: { generation: doc.generation } });
      })
      .catch(cb);
  },
  destroy(sid: string, cb: Callback) {
    SessionDoc.deleteOne({ _id: sid })
      .then(() => cb())
      .catch(cb);
  },
};

export async function registerSessions(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: config.sessionSecret,
    cookieName: 'pool.sid',
    saveUninitialized: false,
    cookie: {
      path: '/',
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
    },
    store: mongoSessionStore,
  });
}

/** Short device description for the Devices list, from the browser's user agent. */
export function deviceName(ua: string | undefined): string {
  const s = ua ?? '';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iPhone/iPad' : /Windows/.test(s) ? 'Windows' : /Mac OS/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(s) ? 'Edge' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'browser';
  return `${browser} on ${os}`;
}

const SEEN_EVERY_MS = 60 * 60 * 1000;

/** preHandler for every protected route: a live session of an active user. Sets request.actor. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.session.get('authenticated')) {
    await reply.code(401).send({ error: 'Unauthorized', message: 'Login required' });
    return;
  }
  let userId = request.session.get('userId');
  if (!userId) {
    userId = (await firstOwnerId()) ?? undefined;
    if (userId) request.session.set('userId', userId);
  }
  const user = userId ? await User.findById(userId).lean<{ _id: string; role: Actor['role']; name: string; active: boolean }>() : null;
  if (!user || user.active === false) {
    await request.session.destroy();
    await reply.code(401).send({ error: 'Unauthorized', message: 'Login required' });
    return;
  }
  request.actor = { userId: user._id, role: user.role, name: user.name };
  await touchActive(user._id);
  const seen = request.session.get('lastSeenAt');
  if (!seen || Date.now() - new Date(seen).getTime() > SEEN_EVERY_MS) {
    request.session.set('lastSeenAt', new Date().toISOString());
    if (!request.session.get('device')) request.session.set('device', deviceName(request.headers['user-agent']));
  }
}

/** preHandler for owner-only routes (after requireAuth). */
export async function requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.actor?.role !== 'owner') {
    await reply.code(403).send({ error: 'Forbidden', message: 'Only an owner can do that' });
  }
}
