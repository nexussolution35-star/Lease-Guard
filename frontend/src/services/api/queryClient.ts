import { isApiError } from '@leaseguard/api-client'
import { QueryClient } from '@tanstack/react-query'

/** Automatic retries for one failed query. */
export const MAX_QUERY_RETRIES = 2

/** Retry only transient API failures (network, 429, 5xx); 4xx responses are final. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return isApiError(error) && error.isRetryable && failureCount < MAX_QUERY_RETRIES
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}

/** The application's query client, shared by the providers and the router context. */
export const queryClient: QueryClient = createQueryClient()
