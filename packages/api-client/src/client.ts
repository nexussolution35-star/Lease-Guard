import createClient, { type Middleware } from 'openapi-fetch'

import { ApiError, apiErrorFromResponse, NETWORK_ERROR_STATUS } from './errors.js'
import type { paths } from './generated/schema.js'

export const COMPANY_ID_HEADER = 'x-company-id'

export interface ApiClientOptions {
  /** API origin, e.g. `http://127.0.0.1:3000`. Paths already include `/api/v1`. */
  baseUrl: string
  /** Current Supabase access token, or null when signed out. Called before every request. */
  getAccessToken: () => string | null | Promise<string | null>
  /** Active company (workspace) id sent as X-Company-Id, or null for routes not tied to a company. */
  getCompanyId?: () => string | null
  /** Called once per 401 response, e.g. to sign the user out. */
  onUnauthorized?: () => void
  fetch?: typeof globalThis.fetch
}

/**
 * Typed LeaseGuard API client. Request and response types come from the backend's OpenAPI document,
 * so a backend change that breaks the frontend fails type checking after `pnpm api:generate`.
 *
 * Use with `unwrap`: `const page = await unwrap(api.GET('/api/v1/properties', { params: { query } }))`.
 */
export function createApiClient(options: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl: options.baseUrl.replace(/\/+$/, ''), fetch: options.fetch })

  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getAccessToken()
      if (token) request.headers.set('Authorization', `Bearer ${token}`)
      const companyId = options.getCompanyId?.()
      if (companyId && !request.headers.has(COMPANY_ID_HEADER)) request.headers.set(COMPANY_ID_HEADER, companyId)
      return request
    },
    onResponse({ response }) {
      if (response.status === 401) options.onUnauthorized?.()
      return response
    },
  }
  client.use(auth)
  return client
}

export type ApiClient = ReturnType<typeof createApiClient>

/** The resolved value of an openapi-fetch call. */
interface FetchResult<T> {
  data?: T
  error?: unknown
  response: Response
}

/**
 * Resolves with the response body of a successful call, or rejects with an ApiError. Network failures
 * (the request never reached the API) reject with status 0.
 */
export async function unwrap<T>(call: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>
  try {
    result = await call
  } catch (cause) {
    throw new ApiError(NETWORK_ERROR_STATUS, ['The LeaseGuard API could not be reached'], null, { cause })
  }
  if (!result.response.ok || result.error !== undefined) throw apiErrorFromResponse(result.response, result.error)
  return result.data as T
}
