import type { ExecutionContext } from '@nestjs/common'

import type { RlsClientFactory } from '../../infrastructure/database/rls-client.factory'
import type { LeaseGuardRequest } from '../request-context'

/** Test-only helpers: an HTTP ExecutionContext and a fake RlsClientFactory. */
export function httpContext(
  request: Partial<LeaseGuardRequest>,
  handler: () => void = () => undefined,
  controller: abstract new () => unknown = class {},
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext
}

export interface QueryCall {
  table: string
  columns: string
  filters: [string, unknown][]
  accessToken: string
}

/**
 * Fake factory. `getClaims` answers token verification; `membership` answers the
 * company_users lookup. Every database query is recorded in `queries`.
 */
export function fakeClients(options: {
  getClaims?: (token: string) => Promise<unknown>
  membership?: { data: unknown; error: { code: string; message: string } | null }
  notConfigured?: Error
}): { factory: RlsClientFactory; queries: QueryCall[] } {
  const queries: QueryCall[] = []
  const factory = {
    tokenVerifier: () => {
      if (options.notConfigured) throw options.notConfigured
      return { auth: { getClaims: options.getClaims ?? (async () => ({ data: null, error: null })) } }
    },
    forAccessToken: (accessToken: string) => ({
      from: (table: string) => ({
        select: (columns: string) => {
          const call: QueryCall = { table, columns, filters: [], accessToken }
          queries.push(call)
          const builder = {
            eq: (column: string, value: unknown) => {
              call.filters.push([column, value])
              return builder
            },
            maybeSingle: async () => options.membership ?? { data: null, error: null },
          }
          return builder
        },
      }),
    }),
  }
  return { factory: factory as unknown as RlsClientFactory, queries }
}
