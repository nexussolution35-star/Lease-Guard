/// <reference types="vitest/config" />
import { defineConfig, defaultClientConditions, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { devGatewayProxy, parseGatewayRoutes } from './src/services/api/devGateway.ts'
import { exposedSecretsMessage, findExposedSecrets, SERVER_ONLY_SETTINGS } from './src/services/api/exposedSecrets.ts'

// Workspace packages publish TypeScript source under this export condition,
// so the frontend compiles them directly without a separate build step.
const WORKSPACE_SOURCE_CONDITION = '@leaseguard/source'

// The web app's own `frontend/.env` holds public VITE_* values only; they are validated in
// src/services/api/config.ts. Server settings and secrets live in `backend/.env`, which the web app never
// reads except to compare values below.
const ENV_DIR = import.meta.dirname
const BACKEND_ENV_DIR = path.resolve(import.meta.dirname, '../backend')

// The gateway's routing table (ADR 0003), shared with the deployed gateway (infrastructure/gateway).
const GATEWAY_ROUTES_FILE = path.resolve(import.meta.dirname, '../infrastructure/gateway/routes.json')
/**
 * Where each service listens in development (`pnpm dev`). Override with GATEWAY_CORE_URL / GATEWAY_REPORTS_URL in
 * the process environment or frontend/.env; they are server-side settings of the dev server, never bundled.
 */
const DEFAULT_SERVICE_URLS = { core: 'http://127.0.0.1:3000', reports: 'http://127.0.0.1:3100' }

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  // Refuse to serve or build when a VITE_* variable holds a server-only secret: it would be bundled. The
  // server-only settings are loaded here only to compare values; they never reach the bundle.
  const serverSecrets = loadEnv(mode, BACKEND_ENV_DIR, [...SERVER_ONLY_SETTINGS])
  const exposed = findExposedSecrets(loadEnv(mode, ENV_DIR, 'VITE_'), serverSecrets)
  if (exposed.length > 0) throw new Error(`Refusing to start: ${exposedSecretsMessage(exposed)}`)

  // Development gateway: the dev server forwards /api/v1/reports to the reports service and every other API path to
  // the core service, so VITE_API_URL is this server's own origin.
  const gatewayEnv = { ...loadEnv(mode, ENV_DIR, 'GATEWAY_'), ...pickDefined(process.env, ['GATEWAY_CORE_URL', 'GATEWAY_REPORTS_URL']) }
  const serviceUrls = {
    core: gatewayEnv.GATEWAY_CORE_URL ?? DEFAULT_SERVICE_URLS.core,
    reports: gatewayEnv.GATEWAY_REPORTS_URL ?? DEFAULT_SERVICE_URLS.reports,
  }
  const gatewayProxy = devGatewayProxy(parseGatewayRoutes(JSON.parse(readFileSync(GATEWAY_ROUTES_FILE, 'utf8'))), serviceUrls)
  const apiUrl = { ...loadEnv(mode, ENV_DIR, 'VITE_API_URL'), ...pickDefined(process.env, ['VITE_API_URL']) }.VITE_API_URL
  if (command === 'serve' && apiUrl && Object.values(serviceUrls).some((url) => sameOrigin(url, apiUrl))) {
    console.warn(
      `[gateway] VITE_API_URL (${apiUrl}) points at a service directly, so paths another service owns (such as ` +
        '/api/v1/reports) will not be found. Set VITE_API_URL to this dev server\'s origin (frontend/.env.example).',
    )
  }

  return {
    envDir: ENV_DIR,
    server: { proxy: gatewayProxy },
    preview: { proxy: gatewayProxy },
    plugins: [
      // Route generation options live in tsr.config.json, shared with the `tsr` CLI.
      tanstackRouter(),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
      conditions: [WORKSPACE_SOURCE_CONDITION, ...defaultClientConditions],
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: ['./src/test/setup.ts'],
      // Fixed, unreachable endpoints: unit tests never use the developer's .env and never reach a
      // real API or Supabase project (tests fake the API client or the source they exercise).
      env: {
        VITE_API_URL: 'http://api.test',
        VITE_SUPABASE_URL: 'http://supabase.test',
        VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      },
    },
  }
})

function pickDefined(source: NodeJS.ProcessEnv, keys: readonly string[]): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const key of keys) {
    const value = source[key]?.trim()
    if (value) picked[key] = value
  }
  return picked
}

/** True when both URLs name the same port on a loopback or the same host (localhost and 127.0.0.1 are one machine). */
function sameOrigin(a: string, b: string): boolean {
  try {
    const [left, right] = [new URL(a), new URL(b)]
    const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
    const sameHost = left.hostname === right.hostname || (loopback(left.hostname) && loopback(right.hostname))
    return sameHost && left.port === right.port && left.protocol === right.protocol
  } catch {
    return false
  }
}
