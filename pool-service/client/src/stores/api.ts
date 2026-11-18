import { API_REDIRECT, isAccessBlocked, reportAccess } from '@/offline/access';

const ACCESS_MESSAGE = 'Cloudflare login needed. Tap "Log in again".';

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
  const req: RequestInit = { method: init.method ?? 'GET', credentials: 'same-origin', redirect: API_REDIRECT };
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
  if (isAccessBlocked(res)) {
    reportAccess(true);
    throw new ApiError(0, ACCESS_MESSAGE);
  }
  reportAccess(false);
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
    res = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', body: form, redirect: API_REDIRECT });
  } catch {
    throw new ApiError(0, 'No connection to the server. Check your signal and try again.');
  }
  if (isAccessBlocked(res)) {
    reportAccess(true);
    throw new ApiError(0, ACCESS_MESSAGE);
  }
  reportAccess(false);
  const text = await res.text();
  const data = text ? (JSON.parse(text) as { message?: string }) : null;
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    throw new ApiError(res.status, data?.message ?? `${res.status} ${res.statusText}`);
  }
  return data as T;
}

/**
 * Downloads a file the server makes (Excel exports): GET, or POST with a JSON body.
 * The browser saves it under the name the server gives.
 */
export async function apiDownload(path: string, body?: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      redirect: API_REDIRECT,
      ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'Excel files are made on the server: this needs a connection (CSV works offline).');
  }
  if (isAccessBlocked(res)) {
    reportAccess(true);
    throw new ApiError(0, ACCESS_MESSAGE);
  }
  reportAccess(false);
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    const text = await res.text();
    let message = `${res.status} ${res.statusText}`;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export.xlsx';
  saveBlob(await res.blob(), name);
}

/** Hands a file to the browser's download. */
export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
      redirect: API_REDIRECT,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where, message: message.slice(0, 500), details, userAgent: navigator.userAgent }),
    });
  } catch {
    // offline: nothing to do
  }
}
