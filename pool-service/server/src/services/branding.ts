import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BUSINESS_SETTINGS_ID } from '@pool/shared';
import { Settings } from '../models/index.js';

/**
 * Branding (GPF item 4). The product is Great Pool Friend (PRODUCT_NAME); each business shows its
 * own name and logo from Business details. The home-screen file (/manifest.json) and the icons
 * made from the logo (/icons/business/…) are public, like the app's files: they say nothing more
 * than the business's name, which the login screen shows too.
 */
const SIZES = { '192': 192, '512': 512, 'maskable-512': 512, 'apple-180': 180 } as const;
type IconKind = keyof typeof SIZES;

async function business(): Promise<{ name: string | null; logo: string | null }> {
  const s = await Settings.findOne({ _id: BUSINESS_SETTINGS_ID, deletedAt: null }, { businessName: 1, logoDataUrl: 1 }).lean<{ businessName?: string; logoDataUrl?: string }>();
  return { name: s?.businessName?.trim() || null, logo: s?.logoDataUrl?.startsWith('data:image/') ? s.logoDataUrl : null };
}
const logoKey = (dataUrl: string) => crypto.createHash('sha256').update(dataUrl).digest('hex').slice(0, 16);

/** "Evolution Home Solutions" → "Evolution": the home-screen label has room for about 12 letters. */
export function shortName(name: string): string {
  if (name.length <= 12) return name;
  const words = name.split(/\s+/);
  let out = words[0]!;
  for (const w of words.slice(1)) {
    if (`${out} ${w}`.length > 12) break;
    out = `${out} ${w}`;
  }
  return out.slice(0, 12);
}

let builtManifest: Record<string, any> | null | undefined;
function baseManifest(clientDist?: string): Record<string, any> {
  if (builtManifest === undefined) {
    try {
      builtManifest = clientDist ? JSON.parse(fs.readFileSync(path.join(clientDist, 'manifest.json'), 'utf8')) : null;
    } catch {
      builtManifest = null;
    }
  }
  return { start_url: '.', scope: '.', display: 'standalone', background_color: '#ffffff', theme_color: '#0277bd', icons: [], ...(builtManifest ?? {}) };
}

/** The home-screen file: the business's name and logo when set, else the product's. */
export async function manifest(product: string, clientDist?: string): Promise<Record<string, any>> {
  const base = baseManifest(clientDist);
  const b = await business();
  const name = b.name ?? product;
  const icons = b.logo
    ? [
        { src: `icons/business/${logoKey(b.logo)}-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `icons/business/${logoKey(b.logo)}-512.png`, sizes: '512x512', type: 'image/png' },
        { src: `icons/business/${logoKey(b.logo)}-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ]
    : base.icons;
  return {
    ...base,
    name,
    short_name: b.name ? shortName(b.name) : 'Pool Friend',
    description: b.name ? `${b.name}, on ${product}` : base.description,
    icons,
    // Read by the app's login screen (browsers ignore unknown keys).
    gpf: { product, business: b.name, logo: b.logo ? `/icons/business/${logoKey(b.logo)}-192.png` : null },
  };
}

const iconCache = new Map<string, Buffer>();
/** PNG made from the business's logo, or null if that logo is no longer the current one. */
export async function businessIcon(file: string): Promise<Buffer | null> {
  const m = /^([0-9a-f]{16})-(192|512|maskable-512|apple-180)\.png$/.exec(file);
  if (!m) return null;
  const [, key, kind] = m as unknown as [string, string, IconKind];
  const b = await business();
  if (!b.logo || logoKey(b.logo) !== key) return null;
  const cacheKey = `${key}-${kind}`;
  const hit = iconCache.get(cacheKey);
  if (hit) return hit;
  const input = Buffer.from(b.logo.slice(b.logo.indexOf(',') + 1), 'base64');
  const size = SIZES[kind];
  // The logo, whole, on white; maskable icons keep it inside the middle 70% (Android crops the rest).
  const inner = Math.round(size * (kind === 'maskable-512' ? 0.7 : 0.88));
  const logo = await sharp(input).resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  const png = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
  if (iconCache.size > 20) iconCache.clear();
  iconCache.set(cacheKey, png);
  return png;
}
