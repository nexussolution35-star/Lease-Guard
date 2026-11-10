import type { QueryClient } from '@tanstack/react-query'

import type { AuthContextValue } from '@/features/auth/authContext'

/** Context available to every route's `beforeLoad` / `loader` (passed by AppRouter). */
export interface RouterContext {
  queryClient: QueryClient
  auth: AuthContextValue
}
