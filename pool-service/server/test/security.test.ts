import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUSINESS_SETTINGS_ID } from '@pool/shared';
import { login, setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
let cookie: string;
const req = (method: string, url: string, payload?: unknown) =>
  ctx.app.inject({ method: method as any, url: `/api${url}`, headers: { cookie }, ...(payload !== undefined && { payload: payload as any }) });

beforeAll(async () => {
  ctx = await setupTestApp();
  cookie = await login(ctx.app);
});
afterAll(async () => ctx.close());

describe('security hardening', () => {
  it('sends the browser safety headers on every answer', async () => {
    for (const url of ['/api/health', '/api/customers', '/api/nope']) {
      const res = await ctx.app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['referrer-policy']).toBe('same-origin');
    }
  });

  it('refuses text longer than its field allows (names 200, notes 20,000)', async () => {
    expect((await req('POST', '/customers', { name: 'N'.repeat(201) })).statusCode).toBe(400);
    expect((await req('POST', '/customers', { name: 'Nguyễn O’Brien-José', notes: 'x'.repeat(20_001) })).statusCode).toBe(400);
    const ok = await req('POST', '/customers', { name: 'Nguyễn O’Brien-José <b>', notes: 'x'.repeat(20_000) });
    expect(ok.statusCode).toBe(201);
    // Any characters are fine; they are stored as typed (the app shows them as plain text).
    expect(ok.json().name).toBe('Nguyễn O’Brien-José <b>');
  });

  it('accepts only a real picture format as the logo (no SVG)', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
    expect((await req('POST', '/settings', { _id: BUSINESS_SETTINGS_ID, logoDataUrl: svg })).statusCode).toBe(400);
    expect((await req('POST', '/settings', { _id: BUSINESS_SETTINGS_ID, logoDataUrl: png })).statusCode).toBeLessThan(300);
    expect((await req('PATCH', `/settings/${BUSINESS_SETTINGS_ID}`, { logoDataUrl: svg })).statusCode).toBe(400);
    expect((await req('PATCH', `/settings/${BUSINESS_SETTINGS_ID}`, { logoDataUrl: '' })).statusCode).toBe(200);
  });
});
