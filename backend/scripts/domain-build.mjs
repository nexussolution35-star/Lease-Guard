#!/usr/bin/env node
/**
 * Makes sure `@leaseguard/domain` is compiled before the backend is compiled or run.
 *
 * The backend runs on Node without the `@leaseguard/source` export condition, so it loads the
 * domain package from `packages/domain/dist`, and `tsc -p tsconfig.build.json` type-checks against
 * `dist/index.d.ts`. A standalone backend build therefore needs that output to exist and be current.
 *
 *   node scripts/domain-build.mjs           build the domain package unless its dist is up to date
 *   node scripts/domain-build.mjs --force   always build it
 *
 * The build itself is the domain package's own `build` script (`pnpm --filter @leaseguard/domain
 * build`); nothing about it is duplicated here. Two backend processes started together (`pnpm dev`
 * starts the API and the worker in parallel) are serialised with a lock so they never write the same
 * dist files at the same time; the second one finds the output current and skips the build.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..')
export const DOMAIN_ROOT = path.join(REPO_ROOT, 'packages', 'domain')
export const DOMAIN_DIST = path.join(DOMAIN_ROOT, 'dist')

/** Scratch state for these scripts; node_modules is never committed. */
const STATE_DIR = path.join(BACKEND_ROOT, 'node_modules', '.cache', 'leaseguard-dev')
const DOMAIN_LOCK = path.join(STATE_DIR, 'domain-build.lock')

/** Files whose change makes the compiled domain package stale. */
const DOMAIN_INPUTS = ['src', 'package.json', 'tsconfig.json', 'tsconfig.build.json']
/** Files every successful domain build writes. */
const DOMAIN_OUTPUTS = ['index.js', 'index.d.ts']

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

/** True when every expected output exists and is newer than every input. */
export function isDomainBuildCurrent() {
  const outputs = DOMAIN_OUTPUTS.map((name) => path.join(DOMAIN_DIST, name))
  if (!outputs.every((file) => existsSync(file))) return false
  const oldestOutput = Math.min(...outputs.map((file) => statSync(file).mtimeMs))
  const newestInput = Math.max(...DOMAIN_INPUTS.map((name) => newestMtime(path.join(DOMAIN_ROOT, name))))
  return oldestOutput >= newestInput
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
    const child = shell
      ? spawn([command, ...args].join(' '), { ...options, shell: true })
      : spawn(command, args, options)
    child.on('error', reject)
    child.on('exit', (code, exitSignal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed (${exitSignal ?? `exit code ${code}`})`))
    })
  })
}

/**
 * Builds `@leaseguard/domain` unless its dist is current (or `force` is set). Safe to call from
 * several processes at once. `signal` aborts the wait for the lock and stops a running build.
 */
export async function ensureDomainBuilt({ force = false, signal, log = console.log } = {}) {
  const release = await acquireLock(DOMAIN_LOCK, { signal })
  try {
    if (!force && isDomainBuildCurrent()) {
      log('[domain-build] @leaseguard/domain dist is up to date')
      return
    }
    const { command, prefix, shell } = pnpmCommand()
    await run(command, [...prefix, '--filter', '@leaseguard/domain', 'build'], { cwd: REPO_ROOT, signal, shell })
  } finally {
    release?.()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureDomainBuilt({ force: process.argv.includes('--force') }).catch((error) => {
    console.error(`[domain-build] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
