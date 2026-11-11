import { COMPANY_ID_HEADER } from '@leaseguard/api-client'
import { describe, expect, it } from 'vitest'

import { integration, world } from './support/clients.ts'

/**
 * Company isolation at the HTTP layer. The company travels in the Authorization and X-Company-Id headers,
 * never in the URL, so a browser, proxy or CDN that stored an API response could hand one company's data
 * to another. Every response, whatever its status, must therefore say `Cache-Control: no-store`.
 */
interface Case {
  name: string
  path: string
  status: number
  headers?: () => Record<string, string>
}

/** The admin belongs to company A only. */
function asAdminOf(company: 'a' | 'b'): () => Record<string, string> {
  return () => ({
    Authorization: `Bearer ${integration().accessTokens.admin}`,
    [COMPANY_ID_HEADER]: world().companies[company].id,
  })
}

const CASES: readonly Case[] = [
  { name: 'liveness', path: '/health', status: 200 },
  { name: 'readiness', path: '/health/ready', status: 200 },
  { name: 'a request without a bearer token', path: '/api/v1/me', status: 401 },
  { name: "a company-scoped list for the caller's own company", path: '/api/v1/properties', status: 200, headers: asAdminOf('a') },
  { name: 'a company the caller is not a member of', path: '/api/v1/properties', status: 403, headers: asAdminOf('b') },
  { name: 'a route that does not exist', path: '/api/v1/no-such-route', status: 404, headers: asAdminOf('a') },
]

describe('API responses are never cacheable', () => {
  for (const { name, path, status, headers } of CASES) {
    it(`answers ${name} (${status}) with Cache-Control: no-store`, async () => {
      const response = await fetch(`${integration().apiBaseUrl}${path}`, { headers: headers?.() ?? {} })
      await response.arrayBuffer()
      expect(response.status).toBe(status)
      expect(response.headers.get('cache-control')).toBe('no-store')
    })
  }
})
