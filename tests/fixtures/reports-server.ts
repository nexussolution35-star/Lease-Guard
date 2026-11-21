import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { REPO_ROOT, TEST_OUTPUT_ROOT } from './paths.ts'

/**
 * A suite's own reports service process (services/reports, ADR 0003), built and started like the suite's API
 * (fixtures/api-server.ts): compiled into services/reports/.dev-<suite> (ignored by git), run with an explicit
 * environment, logged to tests/test-results/<suite>/reports.log and ready once GET /health/ready answers 200.
 */
export const REPORTS_ROOT = path.join(REPO_ROOT, 'services', 'reports')
const WORKSPACE_BUILD_SCRIPT = path.join(REPO_ROOT, 'packages', 'service-kit', 'scripts', 'workspace-build.mjs')
const REPORTS_TSC = path.join(REPORTS_ROOT, 'node_modules', '.bin', 'tsc')
const READY_TIMEOUT_MS = 60_000

export interface ReportsBuild {
  /** Directory name under services/reports/, e.g. `.dev-integration`. */
  dirName: string
  logFile: string
}

export function reportsBuild(suite: 'integration' | 'e2e'): ReportsBuild {
  return { dirName: `.dev-${suite}`, logFile: path.join(TEST_OUTPUT_ROOT, suite, 'reports.log') }
}

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
 * Compiles the real reports service. `@leaseguard/domain` and `@leaseguard/service-kit` are built first when stale
 * (packages/service-kit/scripts/workspace-build.mjs, under the lock `pnpm dev` and the API build share).
 */
export async function buildReports(build: ReportsBuild): Promise<void> {
  if (!existsSync(REPORTS_TSC)) throw new Error(`Reports service dependencies are missing (${REPORTS_TSC}). Run \`pnpm install\`.`)
  await run(process.execPath, [WORKSPACE_BUILD_SCRIPT], REPO_ROOT, 'workspace package build')
  removeReportsBuild(build)
  await run(REPORTS_TSC, ['-p', 'tsconfig.build.json', '--outDir', build.dirName], REPORTS_ROOT, 'reports service build (tsc)')
}

export function removeReportsBuild(build: ReportsBuild): void {
  rmSync(path.join(REPORTS_ROOT, build.dirName), { recursive: true, force: true })
}

/**
 * Explicit environment: `overrides` and every other variable the service reads (its REPORTS_ENV_KEYS) from
 * services/reports/.env.example. Every variable is set, so neither services/reports/.env nor backend/.env is read.
 */
export function reportsEnvironment(build: ReportsBuild, overrides: Readonly<Record<string, string>>): Record<string, string> {
  const requireFromBuild = createRequire(path.join(REPORTS_ROOT, build.dirName, 'main.js'))
  const envModule: unknown = requireFromBuild('./config/env.js')
  if (typeof envModule !== 'object' || envModule === null || !('REPORTS_ENV_KEYS' in envModule) || !Array.isArray(envModule.REPORTS_ENV_KEYS)) {
    throw new Error('services/reports config/env.js does not export REPORTS_ENV_KEYS')
  }
  const example = parseEnv(readFileSync(path.join(REPORTS_ROOT, '.env.example'), 'utf8'))
  const env: Record<string, string> = {}
  const missing: string[] = []
  for (const key of envModule.REPORTS_ENV_KEYS.filter((value): value is string => typeof value === 'string')) {
    const value = overrides[key] ?? example[key]
    if (value === undefined) missing.push(key)
    else env[key] = value
  }
  if (missing.length > 0) throw new Error(`No value for reports variable(s) ${missing.join(', ')} (not in services/reports/.env.example)`)
  return env
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function logTail(logFile: string, lines = 40): string {
  if (!existsSync(logFile)) return '(no reports log)'
  return readFileSync(logFile, 'utf8').trim().split('\n').slice(-lines).join('\n')
}

export interface RunningReports {
  baseUrl: string
  pid: number
  stop: () => Promise<void>
}

/** Starts the compiled reports service with exactly `env` (plus PATH/HOME for Node itself). */
export async function startReports(build: ReportsBuild, env: Readonly<Record<string, string>>): Promise<RunningReports> {
  const port = env.REPORTS_PORT
  if (!port) throw new Error('REPORTS_PORT is required')
  mkdirSync(path.dirname(build.logFile), { recursive: true })
  const logFd = openSync(build.logFile, 'w')
  const baseEnv: Record<string, string> = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG']) {
    const value = process.env[key]
    if (value !== undefined) baseEnv[key] = value
  }
  const child: ChildProcess = spawn(process.execPath, ['--enable-source-maps', path.join(build.dirName, 'main.js')], {
    cwd: REPORTS_ROOT,
    env: { ...baseEnv, ...env },
    stdio: ['ignore', logFd, logFd],
  })
  closeSync(logFd)
  const pid = child.pid
  if (pid === undefined) throw new Error('The reports service did not start')

  let exited: string | undefined
  child.once('exit', (code, signal) => {
    exited = signal ?? `exit code ${code}`
  })
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
    if (exited) throw new Error(`The reports service exited during startup (${exited}). Last log lines:\n${logTail(build.logFile)}`)
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
  throw new Error(
    `The reports service was not ready within ${READY_TIMEOUT_MS / 1000}s (last /health/ready: ${lastStatus}). Last log lines:\n${logTail(build.logFile)}`,
  )
}
