import { useEffect, useState } from 'react';
import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
  },
});

/** GET an API path with caching. Pass null to skip. */
/** GET an API path with caching. Pass null to skip. keep: show the old result while a new search loads. */
export function useApi<T>(path: string | null, opts: { refetchInterval?: number; keep?: boolean } = {}) {
  return useQuery<T, ApiError>({
    queryKey: [path],
    queryFn: () => api<T>(path!),
    enabled: path !== null,
    refetchInterval: opts.refetchInterval,
    placeholderData: opts.keep ? keepPreviousData : undefined,
  });
}

export const invalidate = (prefix: string) =>
  queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix) });

/** The value, once it has stopped changing for ms (so a search is not sent on every key). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}
