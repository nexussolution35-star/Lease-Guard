import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Marks every API response `Cache-Control: no-store`. Responses depend on the caller's bearer token and
 * X-Company-Id while the URL is the same for every company, so no browser, proxy or CDN may store them.
 */
export function noStore() {
  return (_req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  }
}
