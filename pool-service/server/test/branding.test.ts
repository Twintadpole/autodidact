import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUSINESS_SETTINGS_ID } from '@pool/shared';
import { buildApp } from '../src/app.js';
import { Settings } from '../src/models/index.js';
import { shortName } from '../src/services/branding.js';
import { setupTestApp, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(async () => {
  await ctx.close();
});
const get = (url: string, app = ctx.app) => app.inject({ method: 'GET', url });

describe('GPF item 4: branding', () => {
  it('a blank business: the product’s name and icons, no login needed', async () => {
    const res = await get('/manifest.json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/manifest+json');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.json()).toMatchObject({ name: 'Great Pool Friend', short_name: 'Pool Friend', gpf: { product: 'Great Pool Friend', business: null, logo: null } });
  });

  it('a business name and logo: on the home screen, with icons made from the logo', async () => {
    const logo = await sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
    const now = new Date();
    await Settings.updateOne(
      { _id: BUSINESS_SETTINGS_ID },
      { $set: { businessName: 'Evolution Home Solutions', logoDataUrl: `data:image/png;base64,${logo.toString('base64')}`, createdAt: now, updatedAt: now, syncedAt: now, deletedAt: null } },
      { upsert: true },
    );
    const m = (await get('/manifest.json')).json();
    expect(m).toMatchObject({ name: 'Evolution Home Solutions', short_name: 'Evolution', gpf: { business: 'Evolution Home Solutions' } });
    expect(m.icons).toHaveLength(3);
    expect(m.icons[2].purpose).toBe('maskable');
    for (const [src, size] of [[m.icons[0].src, 192], [m.icons[1].src, 512], [m.icons[2].src, 512], [m.gpf.logo, 192]]) {
      const icon = await get(`/${String(src).replace(/^\//, '')}`);
      expect(icon.statusCode, src).toBe(200);
      expect(icon.headers['content-type']).toBe('image/png');
      const meta = await sharp(icon.rawPayload).metadata();
      expect([meta.width, meta.height]).toEqual([size, size]);
    }
    expect((await get('/icons/business/0000000000000000-192.png')).statusCode).toBe(404); // an old logo's icon
    expect((await get('/icons/business/whatever.png')).statusCode).toBe(404);
  });

  it('PRODUCT_NAME names the product for an install', async () => {
    await Settings.updateOne({ _id: BUSINESS_SETTINGS_ID }, { $unset: { businessName: 1, logoDataUrl: 1 } });
    const app = await buildApp({ ...ctx.config, productName: 'Pool Service' });
    await app.ready();
    try {
      expect((await get('/manifest.json', app)).json()).toMatchObject({ name: 'Pool Service', gpf: { product: 'Pool Service', business: null } });
    } finally {
      await app.close();
    }
  });

  it('short home-screen labels', () => {
    expect(shortName('Bluewave')).toBe('Bluewave');
    expect(shortName('Evolution Home Solutions')).toBe('Evolution');
    expect(shortName('Al Pools of Texas')).toBe('Al Pools of');
    expect(shortName('Supercalifragilistic Pools')).toBe('Supercalifra');
  });
});
