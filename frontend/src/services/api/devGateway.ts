/**
 * The development gateway (ADR 0003): the Vite dev server proxies every API path to the service that owns it, so
 * the web app keeps one base URL (`VITE_API_URL` = the dev server's own origin) while services move. The routing
 * table is infrastructure/gateway/routes.json, the same one the deployed gateway (gateway.conf.template) follows.
 *
 * Used by vite.config.ts (Node), so it is kept free of `import.meta.env` and path aliases, like exposedSecrets.ts.
 */
import { z } from 'zod'

const routesFileSchema = z.object({
  defaultService: z.string().min(1),
  routes: z.array(z.object({ prefix: z.string().regex(/^\/[a-z0-9/_-]*[a-z0-9_-]$/), service: z.string().min(1) })),
})

export type GatewayRoutes = z.infer<typeof routesFileSchema>

/** Paths the dev server forwards to the default (core) service; everything else is the web app itself. */
const DEFAULT_SERVICE_PREFIXES = ['/api', '/health'] as const

export interface DevProxyRule {
  target: string
  changeOrigin: false
  xfwd: true
}

/** Validates the parsed routes.json. Throws a readable error when the file is malformed. */
export function parseGatewayRoutes(value: unknown): GatewayRoutes {
  const parsed = routesFileSchema.safeParse(value)
  if (!parsed.success) throw new Error(`infrastructure/gateway/routes.json is invalid: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
  return parsed.data
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A Vite proxy key (a `^`-anchored regular expression) matching `prefix`, anything below it and its query strings. */
export function prefixPattern(prefix: string): string {
  return `^${escapeRegExp(prefix)}(?:[/?]|$)`
}

/**
 * Vite `server.proxy` rules for the routing table. Service routes come first: Vite uses the first key that
 * matches, so `/api/v1/reports` reaches the reports service before `/api` reaches the core service.
 *
 * @param targets origin of each service named in the table, e.g. `{ core: 'http://127.0.0.1:3000', reports: … }`
 */
export function devGatewayProxy(routes: GatewayRoutes, targets: Readonly<Record<string, string>>): Record<string, DevProxyRule> {
  const targetOf = (service: string) => {
    const target = targets[service]
    if (!target) throw new Error(`No development address for the "${service}" service named in infrastructure/gateway/routes.json`)
    return target
  }
  const rule = (service: string): DevProxyRule => ({ target: targetOf(service), changeOrigin: false, xfwd: true })
  const proxy: Record<string, DevProxyRule> = {}
  for (const route of routes.routes) proxy[prefixPattern(route.prefix)] = rule(route.service)
  for (const prefix of DEFAULT_SERVICE_PREFIXES) proxy[prefixPattern(prefix)] = rule(routes.defaultService)
  return proxy
}

/** The service a request path goes to under the routing table (what the proxy rules above do, for tests and checks). */
export function serviceForPath(routes: GatewayRoutes, path: string): string {
  const match = routes.routes.find((route) => new RegExp(prefixPattern(route.prefix)).test(path))
  return match?.service ?? routes.defaultService
}
