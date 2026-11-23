import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailOutbox, PasswordReset, User } from '../src/models/index.js';
import { login, setupTestApp, TEST_PASSWORD, type TestContext } from './helpers.js';

let ctx: TestContext;
let backupDir: string;
let owner: string;
let techPw: string;
const inject = (method: string, url: string, payload?: unknown, cookie?: string) =>
  ctx.app.inject({ method: method as any, url: `/api${url}`, ...(cookie && { headers: { cookie } }), ...(payload !== undefined && { payload: payload as any }) });
/** The token in the newest reset email to `to`. */
async function tokenFor(to: string): Promise<string> {
  const m = await MailOutbox.findOne({ to, kind: 'reset' }).sort({ createdAt: -1 }).lean<{ raw: string }>();
  const body = Buffer.from(m!.raw.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8');
  return body.match(/reset\?token=([\w-]+)/)![1]!;
}

beforeAll(async () => {
  backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pool-mail-'));
  ctx = await setupTestApp({ backupDir, mailFlagDir: path.join(backupDir, 'flag'), publicUrl: 'https://pools.example.com', ownerEmail: 'boss@example.com', forgotRateLimit: { max: 100, timeWindow: '15 minutes' } });
  owner = await login(ctx.app, false, 'boss@example.com');
  const r = (await inject('POST', '/team', { email: 'tina@example.com', name: 'Tina' }, owner)).json();
  techPw = r.password;
});
afterAll(async () => {
  await ctx.close();
  await fs.rm(backupDir, { recursive: true, force: true });
});

describe('password reset by email', () => {
  it('offers email reset only when the sender has a mailbox (MAIL_READY)', async () => {
    expect((await inject('GET', '/auth/options')).json()).toEqual({ resetByEmail: false });
    await fs.writeFile(path.join(backupDir, 'MAIL_READY'), new Date().toISOString());
    expect((await inject('GET', '/auth/options')).json()).toEqual({ resetByEmail: true });
  });

  it('answers the same for an unknown login, and sends nothing', async () => {
    const res = await inject('POST', '/auth/forgot', { email: 'nobody@example.com' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await MailOutbox.countDocuments()).toBe(0);
  });

  it('a tech gets a link; the owner gets a notice without it', async () => {
    expect((await inject('POST', '/auth/forgot', { email: 'Tina@Example.com' })).json()).toEqual({ ok: true });
    const mails = await MailOutbox.find({}).lean<any[]>();
    expect(mails.map((m) => [m.kind, m.to])).toEqual(expect.arrayContaining([['reset', ['tina@example.com']], ['reset-notice', ['boss@example.com']]]));
    const notice = mails.find((m) => m.kind === 'reset-notice');
    expect(Buffer.from(notice.raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString()).not.toContain('token=');
    expect(notice.raw).not.toMatch(/^From:/m);
    expect(await tokenFor('tina@example.com')).toMatch(/^[\w-]{40,}$/);
    // The "mail waiting" flag for the server's sender.
    expect(await fs.readFile(path.join(backupDir, 'flag', 'pending'), 'utf8')).toMatch(/^\d{4}-/);
  });

  it('the link sets a new password once: old password and other devices stop working', async () => {
    const before = await login(ctx.app, false, 'tina@example.com', techPw);
    const token = await tokenFor('tina@example.com');
    expect((await inject('POST', '/auth/reset', { token, password: 'short' })).statusCode).toBe(400);
    const res = await inject('POST', '/auth/reset', { token, password: 'tina-new-password' });
    expect(res.statusCode).toBe(200);
    expect((await inject('GET', '/auth/me', undefined, before)).statusCode).toBe(401);
    await expect(login(ctx.app, false, 'tina@example.com', techPw)).rejects.toThrow();
    await login(ctx.app, false, 'tina@example.com', 'tina-new-password');
    expect((await User.findOne({ email: 'tina@example.com' }).lean<any>()).mustChangePassword).toBe(false);
    expect((await inject('POST', '/auth/reset', { token, password: 'another-password' })).statusCode).toBe(400);
  });

  it('an expired link is refused', async () => {
    await inject('POST', '/auth/forgot', { email: 'tina@example.com' });
    const token = await tokenFor('tina@example.com');
    await PasswordReset.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await inject('POST', '/auth/reset', { token, password: 'tina-password-3' })).statusCode).toBe(400);
  });

  it('at most 3 links per login per hour; a turned-off login gets none', async () => {
    await MailOutbox.deleteMany({});
    await PasswordReset.deleteMany({});
    for (let i = 0; i < 5; i++) await inject('POST', '/auth/forgot', { email: 'tina@example.com' });
    expect(await MailOutbox.countDocuments({ kind: 'reset' })).toBe(3);
    await User.updateOne({ email: 'tina@example.com' }, { $set: { active: false } });
    await MailOutbox.deleteMany({});
    await PasswordReset.deleteMany({});
    await inject('POST', '/auth/forgot', { email: 'tina@example.com' });
    expect(await MailOutbox.countDocuments()).toBe(0);
  });

  it('the owner can reset their own login too (no notice to themselves)', async () => {
    await MailOutbox.deleteMany({});
    await inject('POST', '/auth/forgot', { email: 'boss@example.com' });
    const mails = await MailOutbox.find({}).lean<any[]>();
    expect(mails.map((m) => m.kind)).toEqual(['reset']);
    const token = await tokenFor('boss@example.com');
    expect((await inject('POST', '/auth/reset', { token, password: 'boss-new-password' })).statusCode).toBe(200);
    await login(ctx.app, false, 'boss@example.com', 'boss-new-password');
    void TEST_PASSWORD;
  });
});
