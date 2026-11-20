/**
 * Cloudflare Access (the emailed-code login in front of the whole site) can expire while the
 * app keeps running from the phone's saved copy. Then API calls get Cloudflare's redirect to
 * its login page instead of an answer. API requests use `redirect: 'manual'`, so that shows
 * up as an "opaqueredirect" response instead of looking like no signal. Waiting changes stay
 * in the outbox (never marked failed) until the owner logs in again.
 *
 * Shared by the app and the service worker (no Vue here).
 */

/** Opening this page goes to the network (the service worker never serves /api/ pages), so
 *  Cloudflare shows its login; once through, the server sends the browser back to the app. */
export const ACCESS_LOGIN_URL = '/api/access-login';

/** Fetch options for API calls: don't follow Cloudflare's redirect to another site. */
export const API_REDIRECT: RequestRedirect = 'manual';

/** True when the response came from Cloudflare Access, not from our server. Our API always answers in JSON. */
export function isAccessBlocked(res: Response): boolean {
  if (res.type === 'opaqueredirect') return true;
  if (res.status === 401 || res.status === 403) return !(res.headers.get('content-type') ?? '').includes('application/json');
  return false;
}

let listener: ((blocked: boolean) => void) | null = null;
/** The app registers one listener (the sync store); in the service worker nobody listens. */
export function onAccessChange(fn: (blocked: boolean) => void): void {
  listener = fn;
}
export function reportAccess(blocked: boolean): void {
  listener?.(blocked);
}
