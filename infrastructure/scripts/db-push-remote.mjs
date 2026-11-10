#!/usr/bin/env node
// Applies supabase/migrations to the hosted Supabase project named by SUPABASE_URL.
//
//   pnpm db:push:remote                  dry run: lists the migrations that would be applied
//   pnpm db:push:remote -- --apply       lists them, asks for confirmation, then applies them
//   pnpm db:push:remote -- --apply --yes applies without asking (non-interactive use)
//
// Reads SUPABASE_URL, SUPABASE_DB_PASSWORD and the optional SUPABASE_DB_POOLER_URL from the process
// environment, falling back to the repository-root .env (only those keys are read).
//
// By default it connects to the direct database host db.<ref>.supabase.co, which resolves to IPv6
// only. On an IPv4-only network or container, set SUPABASE_DB_POOLER_URL to the session-pooler
// connection string from the dashboard (Connect > Session pooler), for example
// postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
// The [YOUR-PASSWORD] placeholder (or a missing password) is replaced with SUPABASE_DB_PASSWORD.
// The pooler URL must name a *.pooler.supabase.com host and the project ref from SUPABASE_URL.
//
// The password is passed to the CLI inside the connection URL and never printed: all CLI output is
// redacted. The seed (supabase/seed.sql: demo users with a shared local password) is never pushed.
// Extra arguments are passed to `supabase db push` unchanged.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ENV_FILE = resolve(ROOT, '.env')
const SUPABASE_BIN = resolve(ROOT, 'node_modules/.bin/supabase')
const PASSWORD_PLACEHOLDERS = new Set(['[YOUR-PASSWORD]', '[PASSWORD]'])

function fail(message) {
  console.error(`db-push-remote: ${message}`)
  process.exit(1)
}

const fileValues = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {}
const read = (name) => (process.env[name] ?? fileValues[name] ?? '').trim()

const supabaseUrl = read('SUPABASE_URL')
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(supabaseUrl)?.[1]
if (!ref) fail('SUPABASE_URL must be a hosted project URL such as https://<project-ref>.supabase.co')

// Resolves the connection target. Error messages never include the URL itself (it may hold a password).
function connection() {
  const poolerUrl = read('SUPABASE_DB_POOLER_URL')
  if (!poolerUrl) {
    return { user: 'postgres', host: `db.${ref}.supabase.co`, port: '5432', password: read('SUPABASE_DB_PASSWORD') }
  }
  let parsed
  try {
    parsed = new URL(poolerUrl)
  } catch {
    fail('SUPABASE_DB_POOLER_URL is not a valid URL')
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    fail('SUPABASE_DB_POOLER_URL must start with postgresql://')
  }
  if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(parsed.hostname)) {
    fail('SUPABASE_DB_POOLER_URL must use a Supabase pooler host (*.pooler.supabase.com)')
  }
  const user = decodeURIComponent(parsed.username)
  if (!user.endsWith(`.${ref}`)) {
    fail('SUPABASE_DB_POOLER_URL must belong to the project named by SUPABASE_URL (user postgres.<project-ref>)')
  }
  if ((parsed.port || '5432') !== '5432') {
    fail('SUPABASE_DB_POOLER_URL must be the session pooler (port 5432), not the transaction pooler')
  }
  if (parsed.pathname !== '/postgres') fail('SUPABASE_DB_POOLER_URL must name the postgres database')
  const urlPassword = decodeURIComponent(parsed.password)
  const password = !urlPassword || PASSWORD_PLACEHOLDERS.has(urlPassword) ? read('SUPABASE_DB_PASSWORD') : urlPassword
  return { user, host: parsed.hostname, port: '5432', password }
}

const { user, host, port, password } = connection()
if (!password) fail('SUPABASE_DB_PASSWORD is not set (the database password of the hosted project; see .env.example)')
if (!existsSync(SUPABASE_BIN)) fail('the Supabase CLI is missing; run pnpm install')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const preapproved = args.includes('--yes')
const passThrough = args.filter((arg) => arg !== '--apply' && arg !== '--yes' && arg !== '--dry-run')
if (passThrough.some((arg) => arg.startsWith('--include-seed'))) fail('the seed is local-only and is never pushed')

const encoded = encodeURIComponent(password)
const dbUrl = `postgresql://${encodeURIComponent(user)}:${encoded}@${host}:${port}/postgres?sslmode=require`
const redact = (text) => text.split(encoded).join('***').split(password).join('***')

// Runs `supabase db push` with stdin inherited and stdout/stderr redacted line by line as they arrive.
// Records whether the CLI reported the remote database as up to date (its JSON result, printed when
// stdout is not a terminal).
let upToDate = false
function push(extraArgs) {
  const child = spawn(SUPABASE_BIN, ['db', 'push', `--remote=${dbUrl}`, ...extraArgs, ...passThrough], {
    cwd: ROOT,
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  for (const [source, sink] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    createInterface({ input: source, crlfDelay: Infinity }).on('line', (line) => {
      if (line.includes('"upToDate":true')) upToDate = true
      sink.write(`${redact(line)}\n`)
    })
  }
  return new Promise((done) => {
    child.on('error', (error) => fail(redact(error.message)))
    child.on('close', (code) => done(code ?? 1))
  })
}

function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((done) =>
    rl.question(question, (answer) => {
      rl.close()
      done(/^y(es)?$/i.test(answer.trim()))
    }),
  )
}

console.log(`Target: project ${ref} via ${host.endsWith('.pooler.supabase.com') ? 'session pooler' : 'direct host'}`)
const dryRunStatus = await push(['--dry-run'])
if (dryRunStatus !== 0 || !apply) {
  if (dryRunStatus === 0) console.log('\nDry run only. Re-run with -- --apply to apply these migrations.')
  process.exit(dryRunStatus)
}
if (upToDate) {
  console.log('\nNothing to apply.')
  process.exit(0)
}

// The CLI's own prompt needs stdout to be a terminal, which redaction prevents, so the script asks
// here and then passes --yes.
if (!preapproved) {
  if (!process.stdin.isTTY) fail('cannot ask for confirmation without a terminal; re-run with -- --apply --yes')
  const approved = await confirm(`\nApply the migrations listed above to project ${ref}? [y/N] `)
  if (!approved) {
    console.log('Nothing was applied.')
    process.exit(1)
  }
}
process.exit(await push(['--yes']))
