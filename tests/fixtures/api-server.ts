import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { BACKEND_ROOT, REPO_ROOT, TEST_OUTPUT_ROOT } from './paths.ts'

/**
 * A suite's own API process. Its build output lives directly under backend/ (compiled code resolves
 * paths relative to itself) in a per-suite directory ignored by git (the backend/.dev-* pattern), and
 * its log goes to tests/test-results/<suite>/api.log.
 */
export interface ApiBuild {
  /** Directory name under backend/, e.g. `.dev-integration` or `.dev-e2e`. */
  dirName: string
  logFile: string
}

export function apiBuild(suite: 'integration' | 'e2e'): ApiBuild {
  return { dirName: `.dev-${suite}`, logFile: path.join(TEST_OUTPUT_ROOT, suite, 'api.log') }
}

const DOMAIN_BUILD_SCRIPT = path.join(BACKEND_ROOT, 'scripts', 'domain-build.mjs')
const BACKEND_TSC = path.join(BACKEND_ROOT, 'node_modules', '.bin', 'tsc')
const READY_TIMEOUT_MS = 60_000

/** Runs a command to completion, collecting its output for the error message. */
function run(command: string, args: readonly string[], cwd: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', (error) => reject(new Error(`${label} could not start: ${error.message}`)))
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} failed (${signal ?? `exit code ${code}`}):\n${output.trim()}`))
    })
  })
}

/**
 * Compiles the real API into backend/<build.dirName>. `@leaseguard/domain` must be built first because
 * the compiled backend loads it from packages/domain/dist; backend/scripts/domain-build.mjs runs
 * `pnpm --filter @leaseguard/domain build` when that output is missing or stale, under a lock shared
 * with `pnpm dev`, so concurrent backend processes never write it at the same time.
 */
export async function buildApi(build: ApiBuild): Promise<void> {
  if (!existsSync(BACKEND_TSC)) throw new Error(`Backend dependencies are missing (${BACKEND_TSC}). Run \`pnpm install\`.`)
  await run(process.execPath, [DOMAIN_BUILD_SCRIPT], BACKEND_ROOT, '@leaseguard/domain build')
  removeApiBuild(build)
  await run(BACKEND_TSC, ['-p', 'tsconfig.build.json', '--outDir', build.dirName], BACKEND_ROOT, 'API build (tsc)')
}

export function removeApiBuild(build: ApiBuild): void {
  rmSync(path.join(BACKEND_ROOT, build.dirName), { recursive: true, force: true })
}

/** The API's own list of the variables it reads (backend/src/config/env.ts), from the fresh build. */
function apiEnvKeys(build: ApiBuild): readonly string[] {
  const requireFromBuild = createRequire(path.join(BACKEND_ROOT, build.dirName, 'main.js'))
  const envModule: unknown = requireFromBuild('./config/env.js')
  if (typeof envModule !== 'object' || envModule === null || !('API_ENV_KEYS' in envModule) || !Array.isArray(envModule.API_ENV_KEYS)) {
    throw new Error('backend config/env.js does not export API_ENV_KEYS')
  }
  return envModule.API_ENV_KEYS.filter((key): key is string => typeof key === 'string')
}

/**
 * Explicit API environment: `overrides` (local Supabase, Redis, queue prefix, port) and every other
 * API variable from backend/.env.example. The process gets nothing else that LeaseGuard reads, so
 * backend/.env is never consulted (the API only loads keys that are not already set).
 */
export function apiEnvironment(build: ApiBuild, overrides: Readonly<Record<string, string>>): Record<string, string> {
  const example = parseEnv(readFileSync(path.join(REPO_ROOT, 'backend', '.env.example'), 'utf8'))
  const env: Record<string, string> = {}
  const missing: string[] = []
  for (const key of apiEnvKeys(build)) {
    const value = overrides[key] ?? example[key]
    if (value === undefined) missing.push(key)
    else env[key] = value
  }
  if (missing.length > 0) throw new Error(`No value for API variable(s) ${missing.join(', ')} (not in backend/.env.example)`)
  return env
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('Could not allocate a port'))))
    })
  })
}

function logTail(logFile: string, lines = 40): string {
  if (!existsSync(logFile)) return '(no API log)'
  return readFileSync(logFile, 'utf8').trim().split('\n').slice(-lines).join('\n')
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface RunningApi {
  baseUrl: string
  pid: number
  stop: () => Promise<void>
}

/**
 * Starts the compiled API with exactly `env` (plus PATH/HOME for Node itself), logs to
 * `build.logFile`, and resolves once GET /health/ready answers 200.
 */
export async function startApi(build: ApiBuild, env: Readonly<Record<string, string>>): Promise<RunningApi> {
  const port = env.API_PORT
  if (!port) throw new Error('API_PORT is required')
  mkdirSync(path.dirname(build.logFile), { recursive: true })
  const logFd = openSync(build.logFile, 'w')
  const baseEnv: Record<string, string> = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG']) {
    const value = process.env[key]
    if (value !== undefined) baseEnv[key] = value
  }
  const child: ChildProcess = spawn(process.execPath, ['--enable-source-maps', path.join(build.dirName, 'main.js')], {
    cwd: BACKEND_ROOT,
    env: { ...baseEnv, ...env },
    stdio: ['ignore', logFd, logFd],
  })
  closeSync(logFd)
  const pid = child.pid
  if (pid === undefined) throw new Error('The API process did not start')

  let exited: string | undefined
  child.once('exit', (code, signal) => {
    exited = signal ?? `exit code ${code}`
  })
  // Never leave the API running if the test runner itself goes away.
  const killOnExit = () => child.kill('SIGKILL')
  process.once('exit', killOnExit)

  const stop = async () => {
    process.off('exit', killOnExit)
    if (child.exitCode !== null || child.signalCode !== null) return
    const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    await gone
    clearTimeout(timer)
  }

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastStatus = 'no response'
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The API exited during startup (${exited}). Last log lines:\n${logTail(build.logFile)}`)
    try {
      const response = await fetch(`${baseUrl}/health/ready`)
      if (response.ok) return { baseUrl, pid, stop }
      lastStatus = `${response.status} ${await response.text()}`
    } catch {
      lastStatus = 'not listening yet'
    }
    await delay(250)
  }
  await stop()
  throw new Error(`The API was not ready within ${READY_TIMEOUT_MS / 1000}s (last /health/ready: ${lastStatus}). Last log lines:\n${logTail(build.logFile)}`)
}
