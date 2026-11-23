import type { FastifyInstance } from 'fastify';

/**
 * Browser safety headers on every answer (security hardening, Nov 23). The app is all its own files
 * (no inline scripts, no outside scripts or fonts), so the content policy can be strict:
 * - scripts, styles, fonts, workers and API calls only from this address; Quasar sets some styles
 *   inline, so inline styles are allowed (inline scripts are not);
 * - images also from data: and blob: (the logo, photos taken on the phone before upload);
 * - the app can't be shown inside another site's frame (fake-site / clickjacking);
 * - HTTPS only (Cloudflare serves it), no MIME guessing, no referrer to other sites,
 *   no microphone or location access.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
};

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!reply.hasHeader(k)) reply.header(k, v);
  });
}
