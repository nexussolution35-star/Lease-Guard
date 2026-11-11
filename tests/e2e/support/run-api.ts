/**
 * Playwright webServer for the E2E suite: builds the real LeaseGuard API into backend/.dev-e2e, runs
 * `node .dev-e2e/main.js` with an explicit LOCAL environment (local Supabase from `supabase status`,
 * a unique QUEUE_PREFIX, port 3955) and cleans up when Playwright stops it (SIGTERM): stops the API,
 * deletes the run's Redis keys and removes the build directory. API output: tests/test-results/e2e/api.log.
 *
 * Run by Node directly (type stripping): `node tests/e2e/support/run-api.ts`.
 */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'

import { apiBuild, apiEnvironment, buildApi, removeApiBuild } from '../../fixtures/api-server.ts'
import { assertLocal, resolveLocalSupabase } from '../../fixtures/local-supabase.ts'
import { BACKEND_ROOT } from '../../fixtures/paths.ts'
import { assertRedisReachable, deleteKeysWithPrefix } from '../../fixtures/redis.ts'

import { E2E_API_PORT, E2E_REDIS_URL, E2E_WEB_URL } from './env.ts'

const BUILD = apiBuild('e2e')
// Playwright shows this process's stderr; the API's own output goes to tests/test-results/e2e/api.log.
const log = (message: string) => console.error(`[e2e api] ${message}`)

const supabase = await resolveLocalSupabase()
assertLocal('REDIS_URL', E2E_REDIS_URL)
await assertRedisReachable(E2E_REDIS_URL)
const queuePrefix = `lg-e2e-${process.pid}-${Date.now().toString(36)}`

log('building @leaseguard/domain (if stale) and the API into backend/.dev-e2e …')
try {
  await buildApi(BUILD)
} catch (error) {
  removeApiBuild(BUILD)
  throw error
}
const env = apiEnvironment(BUILD, {
  NODE_ENV: 'development',
  API_PORT: String(E2E_API_PORT),
  API_CORS_ORIGINS: E2E_WEB_URL,
  SUPABASE_URL: supabase.url,
  SUPABASE_ANON_KEY: supabase.anonKey,
  REDIS_URL: E2E_REDIS_URL,
  QUEUE_PREFIX: queuePrefix,
  // Address suggestions stay off (no Google calls, no billing) unless E2E_GOOGLE_MAPS_API_KEY is set on purpose.
  ...(process.env.E2E_GOOGLE_MAPS_API_KEY ? { GOOGLE_MAPS_API_KEY: process.env.E2E_GOOGLE_MAPS_API_KEY } : {}),
})
const baseEnv: Record<string, string> = {}
for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG']) {
  const value = process.env[key]
  if (value !== undefined) baseEnv[key] = value
}

log(`starting the API on port ${E2E_API_PORT} (local Supabase ${supabase.url}, queue prefix ${queuePrefix})`)
mkdirSync(path.dirname(BUILD.logFile), { recursive: true })
const logFd = openSync(BUILD.logFile, 'w')
const api = spawn(process.execPath, ['--enable-source-maps', path.join(BUILD.dirName, 'main.js')], {
  cwd: BACKEND_ROOT,
  env: { ...baseEnv, ...env },
  stdio: ['ignore', logFd, logFd],
})
closeSync(logFd)

let cleaning = false
async function cleanUpAndExit(code: number): Promise<void> {
  if (cleaning) return
  cleaning = true
  try {
    const deleted = await deleteKeysWithPrefix(E2E_REDIS_URL, queuePrefix)
    log(`deleted ${deleted} Redis key(s) under ${queuePrefix}:`)
  } catch (error) {
    log(`could not delete Redis keys under ${queuePrefix}: ${error instanceof Error ? error.message : String(error)}`)
  }
  removeApiBuild(BUILD)
  log(`removed backend/${BUILD.dirName}${existsSync(path.join(BACKEND_ROOT, BUILD.dirName)) ? ' (FAILED)' : ''}`)
  process.exit(code)
}

api.on('exit', (code, signal) => {
  log(`API stopped (${signal ?? `exit code ${code}`})`)
  void cleanUpAndExit(cleaning ? 0 : (code ?? 1))
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    // The API may already have received the signal (Playwright signals the process group).
    if (api.exitCode === null && api.signalCode === null) api.kill('SIGTERM')
    setTimeout(() => api.kill('SIGKILL'), 10_000).unref()
  })
}
