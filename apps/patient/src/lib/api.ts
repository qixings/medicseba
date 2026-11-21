export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(t: string | null) { authToken = t; }
export function setOnUnauthorized(fn: () => void) { onUnauthorized = fn; }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError(0, 'network', 'No internet connection. Check your data or Wi-Fi and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && authToken) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Something went wrong. Try again.');
  }
  return data as T;
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
