/**
 * Prints a short-lived app login (session cookie value) for the e2e tests on the VPS, so no
 * password has to be stored for them. Uses the app's own session code: the session is saved in
 * the `sessions` collection (expires in 30 minutes) and signed with SESSION_SECRET, exactly like
 * a normal login.
 *
 * In the production image:
 *   docker compose exec -T api node server/dist/cli/e2e-session.js     → prints the pool.sid value
 * Used with e2e/local-cookies.cjs (E2E_SESSION=<value>).
 */
import Fastify from 'fastify';
import mongoose from 'mongoose';
import { loadConfig } from '../config.js';
import { registerSessions } from '../plugins/auth.js';

const TTL_MS = 30 * 60 * 1000;

const config = loadConfig();
await mongoose.connect(config.mongoUrl);
const app = Fastify({ logger: false });
await registerSessions(app, config);
app.post('/e2e-session', async (request) => {
  await request.session.regenerate();
  request.session.set('authenticated', true);
  request.session.cookie.maxAge = TTL_MS;
  await request.session.save();
  return { ok: true };
});
try {
  const res = await app.inject({ method: 'POST', url: '/e2e-session' });
  const cookie = res.cookies.find((c) => c.name === 'pool.sid');
  if (res.statusCode !== 200 || !cookie) throw new Error(`no session cookie (status ${res.statusCode})`);
  console.log(cookie.value);
} finally {
  await app.close();
  await mongoose.disconnect();
}
