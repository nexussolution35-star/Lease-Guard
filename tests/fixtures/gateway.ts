import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'

import { parseGatewayRoutes, serviceForPath } from '../../frontend/src/services/api/devGateway.ts'
import { REPO_ROOT } from './paths.ts'

/**
 * A suite's gateway (ADR 0003): a plain HTTP reverse proxy that routes each request by path with the gateway's own
 * routing table (infrastructure/gateway/routes.json) and the same matching as the Vite dev proxy, so tests reach every
 * service through one origin as the web app does. Requests and responses are streamed through unchanged.
 */
export interface RunningGateway {
  baseUrl: string
  stop: () => Promise<void>
}

const ROUTES = parseGatewayRoutes(JSON.parse(readFileSync(path.join(REPO_ROOT, 'infrastructure', 'gateway', 'routes.json'), 'utf8')))

export async function startGateway(services: Readonly<Record<string, string>>): Promise<RunningGateway> {
  const forward = (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const service = serviceForPath(ROUTES, new URL(incoming.url ?? '/', 'http://gateway').pathname)
    const origin = services[service]
    if (!origin) {
      outgoing.writeHead(502).end(`No address for the ${service} service`)
      return
    }
    const target = new URL(incoming.url ?? '/', origin)
    const upstream = httpRequest(
      target,
      { method: incoming.method, headers: { ...incoming.headers, host: target.host, 'x-forwarded-for': incoming.socket.remoteAddress ?? '' } },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(outgoing)
      },
    )
    upstream.on('error', (error) => {
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end(`Gateway error: ${error.message}`)
    })
    incoming.pipe(upstream)
  }

  const server = createServer(forward)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
