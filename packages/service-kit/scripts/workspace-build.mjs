#!/usr/bin/env node
/**
 * Makes sure the workspace packages a Node service runs on are compiled before the service is compiled or run.
 *
 * Services (backend/, services/<name>) run on Node without the `@leaseguard/source` export condition, so they load
 * `@leaseguard/domain` and `@leaseguard/service-kit` from their `dist/`, and `tsc -p tsconfig.build.json` type-checks
 * against their `dist/*.d.ts`. A standalone service build therefore needs that output to exist and be current.
 *
 *   node packages/service-kit/scripts/workspace-build.mjs           build each package unless its dist is up to date
 *   node packages/service-kit/scripts/workspace-build.mjs --force   always build them
 *
 * Each build is the package's own `build` script (`pnpm --filter <name> build`), in dependency order (the kit
 * compiles against the domain package's dist). Processes started together (`pnpm dev` starts the API, the worker and
 * the reports service in parallel) are serialised with one lock so they never write the same dist files at the same
 * time; the later ones find the output current and skip the build.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The packages services run on, in build order. */
export const WORKSPACE_PACKAGES = [
  { name: '@leaseguard/domain', root: path.join(REPO_ROOT, 'packages', 'domain'), outputs: ['index.js', 'index.d.ts'] },
  { name: '@leaseguard/service-kit', root: path.join(REPO_ROOT, 'packages', 'service-kit'), outputs: ['index.js', 'index.d.ts', 'testing.js'] },
]
/** Their dist directories: a running dev server restarts when one changes. */
export const WORKSPACE_DISTS = WORKSPACE_PACKAGES.map((pkg) => path.join(pkg.root, 'dist'))

/** Scratch state for these scripts; node_modules is never committed. */
const STATE_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'leaseguard-dev')
const BUILD_LOCK = path.join(STATE_DIR, 'workspace-build.lock')

/** Files whose change makes a compiled package stale. */
const INPUTS = ['src', 'package.json', 'tsconfig.json', 'tsconfig.build.json']

const LOCK_POLL_MS = 200
const LOCK_TIMEOUT_MS = 5 * 60 * 1000

function newestMtime(entry) {
  if (!existsSync(entry)) return 0
  const stats = statSync(entry)
  if (!stats.isDirectory()) return stats.mtimeMs
  let newest = stats.mtimeMs
  for (const name of readdirSync(entry)) newest = Math.max(newest, newestMtime(path.join(entry, name)))
  return newest
}

/** True when every expected output of `pkg` exists and is newer than every input (and than the packages before it). */
function isCurrent(pkg, notBefore) {
  const outputs = pkg.outputs.map((name) => path.join(pkg.root, 'dist', name))
  if (!outputs.every((file) => existsSync(file))) return false
  const oldestOutput = Math.min(...outputs.map((file) => statSync(file).mtimeMs))
  const newestInput = Math.max(notBefore, ...INPUTS.map((name) => newestMtime(path.join(pkg.root, name))))
  return oldestOutput >= newestInput
}

/** True when every workspace package's dist is current. */
export function isWorkspaceBuildCurrent() {
  let notBefore = 0
  for (const pkg of WORKSPACE_PACKAGES) {
    if (!isCurrent(pkg, notBefore)) return false
    notBefore = Math.max(notBefore, ...INPUTS.map((name) => newestMtime(path.join(pkg.root, name))))
  }
  return true
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/** The pid recorded in a lock directory, or undefined when it cannot be read. */
function lockOwner(lockDir) {
  try {
    const pid = Number.parseInt(readFileSync(path.join(lockDir, 'pid'), 'utf8'), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Takes an exclusive lock (an atomically created directory holding the owner's pid). A lock whose
 * owner has exited is removed. Returns a release function, or undefined when `wait` is false and
 * another live process holds the lock.
 */
export async function acquireLock(lockDir, { wait = true, signal } = {}) {
  mkdirSync(path.dirname(lockDir), { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    signal?.throwIfAborted()
    try {
      mkdirSync(lockDir)
      writeFileSync(path.join(lockDir, 'pid'), String(process.pid))
      let released = false
      const release = () => {
        if (released) return
        released = true
        process.off('exit', release)
        rmSync(lockDir, { recursive: true, force: true })
      }
      process.on('exit', release)
      return release
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
    const owner = lockOwner(lockDir)
    if (owner === undefined) {
      // The owner may be between mkdir and writing its pid; only a lock that stays unreadable is stale.
      const stats = statSync(lockDir, { throwIfNoEntry: false })
      if (stats && Date.now() - stats.mtimeMs > 5000) rmSync(lockDir, { recursive: true, force: true })
    } else if (!isProcessAlive(owner)) {
      rmSync(lockDir, { recursive: true, force: true })
      continue
    } else if (!wait) {
      return undefined
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${lockDir}`)
    await delay(LOCK_POLL_MS)
  }
}

/**
 * The pnpm that is running this script (pnpm sets npm_execpath). Run directly with `node`, it falls
 * back to `pnpm` on PATH through the shell, because some installs make `pnpm` a shell script
 * without a shebang, which cannot be executed directly.
 */
function pnpmCommand() {
  const execPath = process.env.npm_execpath
  if (execPath && /pnpm/i.test(execPath)) {
    return /\.[cm]?js$/.test(execPath)
      ? { command: process.execPath, prefix: [execPath], shell: false }
      : { command: execPath, prefix: [], shell: false }
  }
  return { command: 'pnpm', prefix: [], shell: true }
}

/** `args` are fixed strings from this file, so running them through the shell needs no quoting. */
function run(command, args, { cwd, signal, shell }) {
  return new Promise((resolve, reject) => {
    const options = { cwd, stdio: 'inherit', signal }
    const child = shell ? spawn([command, ...args].join(' '), { ...options, shell: true }) : spawn(command, args, options)
    child.on('error', reject)
    child.on('exit', (code, exitSignal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed (${exitSignal ?? `exit code ${code}`})`))
    })
  })
}

/**
 * Builds each workspace package unless its dist is current (or `force` is set); a rebuilt package makes every
 * package after it rebuild too. Safe to call from several processes at once. `signal` aborts the wait for the lock
 * and stops a running build.
 */
export async function ensureWorkspaceBuilt({ force = false, signal, log = console.log } = {}) {
  const release = await acquireLock(BUILD_LOCK, { signal })
  try {
    const { command, prefix, shell } = pnpmCommand()
    let rebuilt = force
    let notBefore = 0
    for (const pkg of WORKSPACE_PACKAGES) {
      if (!rebuilt && isCurrent(pkg, notBefore)) {
        log(`[workspace-build] ${pkg.name} dist is up to date`)
      } else {
        await run(command, [...prefix, '--filter', pkg.name, 'build'], { cwd: REPO_ROOT, signal, shell })
        rebuilt = true
      }
      notBefore = Math.max(notBefore, ...INPUTS.map((name) => newestMtime(path.join(pkg.root, name))))
    }
  } finally {
    release?.()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureWorkspaceBuilt({ force: process.argv.includes('--force') }).catch((error) => {
    console.error(`[workspace-build] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
