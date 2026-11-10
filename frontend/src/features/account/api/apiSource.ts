import { isApiError, unwrap, type ApiClient } from '@leaseguard/api-client'

import type { AccountSource } from './source'

/** The signed-in user from the LeaseGuard API (`/api/v1/me`, not company-scoped). */
export function createApiAccountSource(api: ApiClient): AccountSource {
  return {
    async getCurrentUser() {
      try {
        return await unwrap(api.GET('/api/v1/me'))
      } catch (error) {
        if (isApiError(error) && error.isNotFound) return null
        throw error
      }
    },
    updateCurrentUser(changes) {
      return unwrap(api.PATCH('/api/v1/me', { body: changes }))
    },
  }
}
