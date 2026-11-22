import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClientError, Feedback } from '../src/models/index.js';
import { login, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
let owner: string;
let tech: string;
const req = (cookie: string, method: string, url: string, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url: `/api${url}`, headers: { cookie }, ...(payload !== undefined && { payload: payload as any }) });

beforeAll(async () => {
  ctx = await setupTestApp();
  owner = await login(ctx.app);
  const member = (await req(owner, 'POST', '/team', { email: 'fran@example.com', name: 'Fran' })).json();
  tech = await login(ctx.app, false, 'fran@example.com', member.password);
});
afterAll(async () => ctx.close());

describe('beta feedback', () => {
  it('needs a login', async () => {
    expect((await ctx.app.inject({ method: 'POST', url: '/api/feedback', payload: { text: 'hi' } })).statusCode).toBe(401);
  });

  it('a tech sends feedback with the screen and version; a resend is not a second copy', async () => {
    const _id = crypto.randomUUID();
    const body = { _id, kind: 'problem', text: 'The timer stopped', screen: '/pools/x', appVersion: '0.3.0', language: 'es' };
    expect((await req(tech, 'POST', '/feedback', body)).statusCode).toBe(201);
    expect((await req(tech, 'POST', '/feedback', body)).statusCode).toBe(200);
    expect(await Feedback.countDocuments({ _id })).toBe(1);
    expect(await Feedback.findById(_id).lean()).toMatchObject({ userName: 'Fran', role: 'tech', kind: 'problem', screen: '/pools/x', appVersion: '0.3.0' });
  });

  it('refuses empty text', async () => {
    expect((await req(tech, 'POST', '/feedback', { text: '   ' })).statusCode).toBe(400);
  });

  it('the owner sees everyone’s and marks one done; a tech sees only their own and can’t mark', async () => {
    await req(owner, 'POST', '/feedback', { kind: 'idea', text: 'Owner idea' });
    const all = (await req(owner, 'GET', '/feedback')).json().items;
    expect(all.map((f: any) => f.text).sort()).toEqual(['Owner idea', 'The timer stopped']);
    const mine = (await req(tech, 'GET', '/feedback')).json().items;
    expect(mine.map((f: any) => f.text)).toEqual(['The timer stopped']);
    const id = all.find((f: any) => f.text === 'Owner idea')._id;
    expect((await req(tech, 'PATCH', `/feedback/${id}`, { done: true })).statusCode).toBe(403);
    expect((await req(owner, 'PATCH', `/feedback/${id}`, { done: true })).statusCode).toBe(200);
    expect((await Feedback.findById(id).lean<any>()).doneAt).toBeInstanceOf(Date);
  });
});

describe('app errors (client-log)', () => {
  it('keeps one counted record per kind of problem and version', async () => {
    const send = (message: string, appVersion = '0.3.0') =>
      req(tech, 'POST', '/client-log', { where: 'app-error', message, stack: 'at x (a.js:1:2)', screen: '/', appVersion });
    expect((await send('Cannot read properties of undefined (reading 12)')).statusCode).toBe(200);
    await send('Cannot read properties of undefined (reading 13)');
    await send('Cannot read properties of undefined (reading 13)', '0.3.1');
    const rows = await ClientError.find({ where: 'app-error' }).sort({ appVersion: 1 }).lean<any[]>();
    expect(rows.map((r) => [r.appVersion, r.count])).toEqual([['0.3.0', 2], ['0.3.1', 1]]);
    expect(rows[0].stack).toContain('a.js');
  });
});
