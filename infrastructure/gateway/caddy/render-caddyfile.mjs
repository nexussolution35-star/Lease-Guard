#!/usr/bin/env node
// Renders the production gateway's Caddyfile from Caddyfile.template and ../routes.json (ADR 0003), so the Vite dev
// proxy and the production gateway route the same prefixes from one table. Run at image build (Dockerfile) and by
// infrastructure/scripts/production-proof.sh:
//
//   node infrastructure/gateway/caddy/render-caddyfile.mjs > Caddyfile
//
// A service named in routes.json needs an entry in SERVICE_UPSTREAMS (its compose service name and port); the render
// fails otherwise, so a service cannot be routed in development and silently missing in production.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Each service's upstream: the DNS name every replica answers on and its port, overridable by environment at start. */
export const SERVICE_UPSTREAMS = {
  core: { env: 'CORE', host: 'api', port: 3000 },
  reports: { env: 'REPORTS', host: 'reports', port: 3100 },
}

const PREFIX = /^\/[a-z0-9/_-]*[a-z0-9_-]$/

function upstream(service) {
  const known = SERVICE_UPSTREAMS[service]
  if (!known) throw new Error(`routes.json names service "${service}", which has no entry in SERVICE_UPSTREAMS (render-caddyfile.mjs)`)
  return [
    '\t\treverse_proxy {',
    '\t\t\tdynamic a {',
    `\t\t\t\tname {$${known.env}_UPSTREAM_HOST:${known.host}}`,
    `\t\t\t\tport {$${known.env}_UPSTREAM_PORT:${known.port}}`,
    '\t\t\t\trefresh 5s',
    '\t\t\t}',
    '\t\t\timport upstream_policy',
    '\t\t}',
  ]
}

export function renderCaddyfile(template, table) {
  if (!template.includes('@@API_ROUTES@@')) throw new Error('Caddyfile.template has no @@API_ROUTES@@ marker')
  // Longest prefix first, so a nested prefix wins over the one containing it.
  const routes = [...table.routes].sort((a, b) => b.prefix.length - a.prefix.length)
  const lines = []
  routes.forEach((route, index) => {
    if (!PREFIX.test(route.prefix)) throw new Error(`routes.json prefix "${route.prefix}" must be a lowercase path without a trailing slash`)
    const matcher = `@route${index}`
    lines.push(`\t# ${route.prefix} and below it: the ${route.service} service`)
    lines.push(`\t${matcher} path ${route.prefix} ${route.prefix}/*`)
    lines.push(`\thandle ${matcher} {`, ...upstream(route.service), '\t}')
  })
  lines.push(`\t# Every other path: the ${table.defaultService} service`)
  lines.push('\thandle {', ...upstream(table.defaultService), '\t}')
  return template.replace('@@API_ROUTES@@', lines.join('\n'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const template = readFileSync(resolve(HERE, 'Caddyfile.template'), 'utf8')
  const table = JSON.parse(readFileSync(resolve(HERE, '../routes.json'), 'utf8'))
  process.stdout.write(renderCaddyfile(template, table))
}
