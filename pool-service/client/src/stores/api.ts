/** Small fetch wrapper for the API (same origin, session cookie). Phase 4 routes writes through the outbox instead. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const req: RequestInit = { method: init.method ?? 'GET', credentials: 'same-origin' };
  if (init.body !== undefined) {
    req.headers = { 'content-type': 'application/json' };
    req.body = JSON.stringify(init.body);
  }
  const res = await fetch(`/api${path}`, req);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `${res.status} ${res.statusText}`);
  return data as T;
}
