/**
 * Development runner shared by every Node service (backend/scripts/dev.mjs, services/<name>/scripts/dev.mjs).
 *
 * 1. Builds `@leaseguard/domain` and `@leaseguard/service-kit` when their dist is missing or stale (workspace-build.mjs).
 * 2. Runs `tsc --watch` into an output directory owned by this process (e.g. `.dev-api`), so several processes of
 *    one service can run at the same time without racing on, or cleaning, each other's output or the `dist/` that
 *    `pnpm build` produces.
 * 3. Starts `node --watch-path` on the compiled entry once the first compile finishes without type errors; Node
 *    restarts the process whenever tsc rewrites the output or a workspace package's dist changes.
 * 4. Forwards SIGINT, SIGTERM and SIGHUP to both children (each runs in its own process group, so the shell shim
 *    and the compiler it launches stop together) and exits only after they have exited.
 *
 * The output directory sits directly under the service root, at the same depth as dist/, because compiled code
 * resolves paths relative to itself (a service finds its .env as `<outDir>/config/../../.env`).
 */
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'

import { acquireLock, ensureWorkspaceBuilt, WORKSPACE_DISTS } from './workspace-build.mjs'

const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']
/** Children that ignore the forwarded signal for this long are killed. */
const SHUTDOWN_GRACE_MS = 10_000
const TSC_SUMMARY = /Found (\d+) errors?\. Watching for file changes\./

/**
 * @param {{ root: string, name: string, entry: string, outDir: string }} target
 *   root: the service directory; name: label and lock name (e.g. `api`); entry: compiled file to run (e.g. `main.js`);
 *   outDir: output directory name under root (e.g. `.dev-api`).
 */
export function runDev({ root, name, entry, outDir: outDirName }) {
  const tag = `[dev:${name}]`
  const log = (message) => console.log(`${tag} ${message}`)
  const outDir = path.join(root, outDirName)
  const tscBin = path.join(root, 'node_modules', '.bin', 'tsc')

  /** @type {Set<import('node:child_process').ChildProcess>} */
  const children = new Set()
  const aborter = new AbortController()
  let shuttingDown = false
  let exitCode = 0

  function signalChild(child, signal) {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
    try {
      // Negative pid: the child's whole process group.
      process.kill(-child.pid, signal)
    } catch {
      try {
        child.kill(signal)
      } catch {
        // Already gone.
      }
    }
  }

  function waitForExit(child) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise((resolve) => child.once('exit', () => resolve()))
  }

  async function shutdown(signal, code) {
    if (shuttingDown) return
    shuttingDown = true
    exitCode = code
    aborter.abort()
    const running = [...children]
    for (const child of running) signalChild(child, signal)
    const killTimer = setTimeout(() => {
      for (const child of running) signalChild(child, 'SIGKILL')
    }, SHUTDOWN_GRACE_MS)
    await Promise.all(running.map(waitForExit))
    clearTimeout(killTimer)
    process.exit(exitCode)
  }

  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => {
      log(`${signal} received, stopping`)
      void shutdown(signal, 0)
    })
  }
  // Last resort if this process exits some other way: never leave a compiler or server running.
  process.on('exit', () => {
    for (const child of children) signalChild(child, 'SIGTERM')
  })

  function track(child, label) {
    children.add(child)
    child.on('error', (error) => {
      console.error(`${tag} ${label} failed to start: ${error.message}`)
      void shutdown('SIGTERM', 1)
    })
    child.on('exit', (code, signal) => {
      children.delete(child)
      if (shuttingDown) return
      console.error(`${tag} ${label} exited unexpectedly (${signal ?? `exit code ${code}`}); stopping`)
      void shutdown('SIGTERM', code === 0 || code === null ? 1 : code)
    })
    return child
  }

  function startServer() {
    log(`starting ${path.join(outDirName, entry)}`)
    track(
      spawn(
        process.execPath,
        [
          '--enable-source-maps',
          '--watch-preserve-output',
          `--watch-path=${outDir}`,
          ...WORKSPACE_DISTS.map((dist) => `--watch-path=${dist}`),
          path.join(outDir, entry),
        ],
        { cwd: root, stdio: 'inherit', detached: true },
      ),
      'node',
    )
  }

  function startCompiler() {
    const tsc = track(
      spawn(tscBin, ['-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput', '--outDir', outDir], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'inherit'],
        detached: true,
      }),
      'tsc',
    )
    let serverStarted = false
    let pending = ''
    tsc.stdout.setEncoding('utf8')
    tsc.stdout.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim() !== '') console.log(`${tag} ${line}`)
        const summary = TSC_SUMMARY.exec(line)
        if (!summary || serverStarted || shuttingDown) continue
        if (summary[1] === '0') {
          serverStarted = true
          startServer()
        } else {
          log('fix the type errors above; the process starts after the first clean compile')
        }
      }
    })
  }

  async function main() {
    // One runner per target: a second `pnpm dev` would otherwise wipe this runner's output.
    const release = await acquireLock(path.join(root, 'node_modules', '.cache', 'leaseguard-dev', `${name}.lock`), { wait: false })
    if (!release) {
      console.error(`${tag} another dev:${name} runner is already running for this checkout`)
      process.exit(1)
    }
    await ensureWorkspaceBuilt({ signal: aborter.signal, log })
    if (shuttingDown) return
    rmSync(outDir, { recursive: true, force: true })
    log(`compiling into ${outDirName}/ (watch mode)`)
    startCompiler()
  }

  main().catch((error) => {
    if (shuttingDown) return
    console.error(`${tag} ${error instanceof Error ? error.message : String(error)}`)
    void shutdown('SIGTERM', 1)
  })
}
