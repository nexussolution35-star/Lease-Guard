/**
 * Playwright webServer for the E2E suite: builds the real LeaseGuard API into backend/.dev-e2e, runs
 * `node .dev-e2e/main.js` with an explicit LOCAL environment (local Supabase from `supabase status`,
 * a unique QUEUE_PREFIX, port 3955) and cleans up when Playwright stops it (SIGTERM): stops the API,
 * deletes the run's Redis keys and removes the build directory. API output: tests/test-results/e2e/api.log.
 *
 * Beside the API it runs what statement processing needs (the statements acceptance spec): the document-processing
 * service (python-services/document-processing, its own .venv, port 3957, a per-run token) and the statement worker
 * (statement-worker.ts: statement processing and post-verification monitoring only, on the same queue prefix, with the
 * local service role). Both stop with the API. Output: tests/test-results/e2e/document-processing.log and worker.log.
 *
 * Run by Node directly (type stripping): `node tests/e2e/support/run-api.ts`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'

import { apiBuild, apiEnvironment, buildApi, removeApiBuild } from '../../fixtures/api-server.ts'
import { assertLocal, resolveLocalSupabase } from '../../fixtures/local-supabase.ts'
import { BACKEND_ROOT, REPO_ROOT, TEST_OUTPUT_ROOT } from '../../fixtures/paths.ts'
import { assertRedisReachable, deleteKeysWithPrefix } from '../../fixtures/redis.ts'

import {
  E2E_API_PORT,
  E2E_DOCUMENT_PROCESSING_PORT,
  E2E_DOCUMENT_PROCESSING_URL,
  E2E_REDIS_URL,
  E2E_WEB_URL,
  STATEMENT_WORKER_ENV_VARIABLE,
} from './env.ts'

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

/** Starts a child process with its output in `logFile` (truncated). */
function startLogged(command: string, args: readonly string[], cwd: string, childEnv: Record<string, string>, logFile: string): ChildProcess {
  mkdirSync(path.dirname(logFile), { recursive: true })
  const fd = openSync(logFile, 'w')
  const child = spawn(command, args, { cwd, env: childEnv, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  return child
}

const helpers: ChildProcess[] = []
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null

// The document-processing service, ready before anything can enqueue a statement.
const documentProcessingDir = path.join(REPO_ROOT, 'python-services', 'document-processing')
const python = path.join(documentProcessingDir, '.venv', 'bin', 'python')
if (!existsSync(python)) {
  removeApiBuild(BUILD)
  throw new Error('The document-processing service has no virtual environment: run `pnpm python:setup` first.')
}
const documentProcessingToken = randomBytes(24).toString('hex')
log(`starting the document-processing service on port ${E2E_DOCUMENT_PROCESSING_PORT}`)
const documentProcessing = startLogged(
  python,
  ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(E2E_DOCUMENT_PROCESSING_PORT)],
  documentProcessingDir,
  // Process variables win over backend/.env for the service's settings.
  { ...baseEnv, DOCUMENT_PROCESSING_TOKEN: documentProcessingToken, DOCUMENT_PROCESSING_MAX_FILE_MB: '20', LOG_LEVEL: 'warn' },
  path.join(TEST_OUTPUT_ROOT, 'e2e', 'document-processing.log'),
)
helpers.push(documentProcessing)
await waitForDocumentProcessing()

log('starting the statement worker')
helpers.push(
  startLogged(
    process.execPath,
    ['--enable-source-maps', path.join(REPO_ROOT, 'tests', 'e2e', 'support', 'statement-worker.ts')],
    REPO_ROOT,
    {
      ...baseEnv,
      [STATEMENT_WORKER_ENV_VARIABLE]: JSON.stringify({
        buildDir: BUILD.dirName,
        overrides: {
          NODE_ENV: 'development',
          LOG_LEVEL: 'info',
          SUPABASE_URL: supabase.url,
          SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
          REDIS_URL: E2E_REDIS_URL,
          QUEUE_PREFIX: queuePrefix,
          DOCUMENT_PROCESSING_URL: E2E_DOCUMENT_PROCESSING_URL,
          DOCUMENT_PROCESSING_TOKEN: documentProcessingToken,
          ANTHROPIC_API_KEY: '',
        },
      }),
    },
    path.join(TEST_OUTPUT_ROOT, 'e2e', 'worker.log'),
  ),
)

log(`starting the API on port ${E2E_API_PORT} (local Supabase ${supabase.url}, queue prefix ${queuePrefix})`)
const api = startLogged(process.execPath, ['--enable-source-maps', path.join(BUILD.dirName, 'main.js')], BACKEND_ROOT, { ...baseEnv, ...env }, BUILD.logFile)

/** Polls the service's liveness until it answers (or stops early). */
async function waitForDocumentProcessing(): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (!running(documentProcessing)) break
    try {
      const response = await fetch(`${E2E_DOCUMENT_PROCESSING_URL}/health`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  documentProcessing.kill('SIGKILL')
  removeApiBuild(BUILD)
  throw new Error('The document-processing service did not start; see tests/test-results/e2e/document-processing.log')
}

/** Stops the helpers (worker, document processing) and waits for them, at most 10 s each. */
async function stopHelpers(): Promise<void> {
  await Promise.all(
    helpers.filter(running).map(
      (child) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL')
            resolve()
          }, 10_000)
          child.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
          child.kill('SIGTERM')
        }),
    ),
  )
}

let cleaning = false
async function cleanUpAndExit(code: number): Promise<void> {
  if (cleaning) return
  cleaning = true
  await stopHelpers()
  log('stopped the statement worker and the document-processing service')
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
