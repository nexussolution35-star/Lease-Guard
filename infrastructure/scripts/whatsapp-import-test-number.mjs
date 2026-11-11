#!/usr/bin/env node
// Nexus platform operator tooling: connects Nexus Solution's own WhatsApp test number to one company before Meta
// approves LeaseGuard's app (ticket 15, the number import).
//
//   pnpm whatsapp:import-test-number -- --company NS                  dry run: shows the company and number
//   pnpm whatsapp:import-test-number -- --company NS --apply          asks for confirmation, then applies
//   pnpm whatsapp:import-test-number -- --company NS --apply --yes    applies without asking (non-interactive use)
//
// The command itself is TypeScript in the backend (backend/src/operator/, so it queues the verification exactly as
// the API does). This wrapper compiles the backend into backend/.dev-operator (ignored by git, like the other
// backend/.dev-* outputs; @leaseguard/domain is built first when stale) and runs it with the arguments given. In a
// deployed backend image, run `node dist/operator/import-whatsapp-test-number.js --company <id> ...` instead.
//
// The command reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REDIS_URL, QUEUE_PREFIX, WHATSAPP_ACCESS_TOKEN,
// WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID from the process environment, falling back to
// backend/.env only for those keys. This wrapper reads no environment file. `--help` lists every option.

import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BACKEND = join(ROOT, 'backend')
const OUT_DIR = '.dev-operator'
const TSC = join(BACKEND, 'node_modules', '.bin', 'tsc')
const ENTRY = join(BACKEND, OUT_DIR, 'operator', 'import-whatsapp-test-number.js')

function fail(message) {
  console.error(`whatsapp:import-test-number: ${message}`)
  process.exit(1)
}

/** Runs a build step quietly; its output is shown only when it fails. */
function run(command, args, label) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: BACKEND, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk.toString()))
    child.stderr.on('data', (chunk) => (output += chunk.toString()))
    child.on('error', (error) => reject(new Error(`${label} could not start: ${error.message}`)))
    child.on('exit', (code, signal) => (code === 0 ? resolvePromise() : reject(new Error(`${label} failed (${signal ?? `exit code ${code}`}):\n${output.trim()}`))))
  })
}

if (!existsSync(TSC)) fail('backend dependencies are missing; run `pnpm install` first')
try {
  await run(process.execPath, [join(BACKEND, 'scripts', 'domain-build.mjs')], '@leaseguard/domain build')
  rmSync(join(BACKEND, OUT_DIR), { recursive: true, force: true })
  await run(TSC, ['-p', 'tsconfig.build.json', '--outDir', OUT_DIR], 'backend build (tsc)')
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const child = spawn(process.execPath, [ENTRY, ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
