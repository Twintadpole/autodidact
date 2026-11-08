/** Small fetch wrapper for the API (same origin, session cookie). Phase 4 routes writes through the outbox instead. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Set by the router: called when a request comes back 401 (session expired) so the app can show the login screen. */
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const req: RequestInit = { method: init.method ?? 'GET', credentials: 'same-origin' };
  if (init.body !== undefined) {
    req.headers = { 'content-type': 'application/json' };
    req.body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, req);
  } catch {
    throw new ApiError(0, 'No connection to the server. Check your signal and try again.');
  }
  const text = await res.text();
  let data: { message?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) unauthorizedHandler?.();
    throw new ApiError(res.status, data?.message ?? `${res.status} ${res.statusText}`);
  }
  return data as T;
}

/** multipart/form-data POST (photo uploads). */
export async function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', body: form });
  } catch {
    throw new ApiError(0, 'No connection to the server. Check your signal and try again.');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as { message?: string }) : null;
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    throw new ApiError(res.status, data?.message ?? `${res.status} ${res.statusText}`);
  }
  return data as T;
}

/** A readable message for notifications. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tells the server about a problem on the phone (e.g. a photo that wouldn't load),
 * so it can be diagnosed from the server logs. Best effort; never throws.
 */
export async function reportClientProblem(where: string, message: string, details: Record<string, unknown> = {}): Promise<void> {
  try {
    await fetch('/api/client-log', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where, message: message.slice(0, 500), details, userAgent: navigator.userAgent }),
    });
  } catch {
    // offline: nothing to do
  }
}
