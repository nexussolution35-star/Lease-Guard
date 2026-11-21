/**
 * Query parameters whose values are secrets and must never reach a log. Meta's webhook handshake sends the
 * verify token in the query string (`GET /api/v1/webhooks/whatsapp?hub.verify_token=...`), and pino-http logs
 * every request's url and parsed query.
 */
export const SECRET_QUERY_PARAMS: ReadonlySet<string> = new Set(['hub.verify_token'])

export const REDACTED = '[Redacted]'

function decodedKey(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

/** The url with the value of every secret query parameter replaced, however the parameter name is encoded. */
export function redactUrl(url: string): string
export function redactUrl(url: string | undefined): string | undefined
export function redactUrl(url: string | undefined): string | undefined {
  if (url === undefined) return url
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return url
  const hashStart = url.indexOf('#', queryStart)
  const query = hashStart === -1 ? url.slice(queryStart + 1) : url.slice(queryStart + 1, hashStart)
  const rest = hashStart === -1 ? '' : url.slice(hashStart)
  const pairs = query.split('&').map((pair) => {
    const equals = pair.indexOf('=')
    const key = equals === -1 ? pair : pair.slice(0, equals)
    return SECRET_QUERY_PARAMS.has(decodedKey(key)) ? `${key}=${REDACTED}` : pair
  })
  return `${url.slice(0, queryStart + 1)}${pairs.join('&')}${rest}`
}

/** A copy of a parsed query with secret parameters replaced; the request's own query object is not changed. */
export function redactQuery(query: unknown): unknown {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) return query
  const entries = Object.entries(query as Record<string, unknown>)
  if (!entries.some(([key]) => SECRET_QUERY_PARAMS.has(key))) return query
  return Object.fromEntries(entries.map(([key, value]) => [key, SECRET_QUERY_PARAMS.has(key) ? REDACTED : value]))
}
