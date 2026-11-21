import { Platform } from 'react-native';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export function setAuthToken(t: string | null) { authToken = t; }
export function setOnUnauthorized(fn: () => void) { onUnauthorized = fn; }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
  /** No connection or the server did not answer: worth retrying later. */
  get retryable() { return this.status === 0 || this.status >= 500; }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: ctrl.signal });
  } catch {
    throw new ApiError(0, 'network', 'No internet connection');
  } finally { clearTimeout(timer); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && authToken) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Something went wrong. Try again.');
  }
  return data as T;
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });

/** Photos are stored as paths like /doctors/x.webp and served by the web host. */
export const mediaUrl = (u: string | null | undefined) => {
  if (!u) return null;
  if (/^https?:/.test(u) || Platform.OS === 'web') return u;
  return `${API_URL}${u.startsWith('/') ? '' : '/'}${u}`;
};
