import { QueryClient, useQuery } from '@tanstack/react-query';
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
export function useApi<T>(path: string | null, opts: { refetchInterval?: number } = {}) {
  return useQuery<T, ApiError>({
    queryKey: [path],
    queryFn: () => api<T>(path!),
    enabled: path !== null,
    refetchInterval: opts.refetchInterval,
  });
}

export const invalidate = (prefix: string) =>
  queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix) });
