import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { parseEnv, promisify } from 'node:util'

import { REPO_ROOT, SUPABASE_BIN } from './paths.ts'

const execFileAsync = promisify(execFile)

/** Settings of the LOCAL Supabase stack, as printed by `supabase status -o env`. */
export interface LocalSupabase {
  url: string
  anonKey: string
  serviceRoleKey: string
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** True for http(s)/redis/postgres URLs that point at this machine. */
export function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname)
  } catch {
    return false
  }
}

/**
 * The suites create and delete data, so they only ever talk to services on this machine. The values
 * come from the Supabase CLI, never from `backend/.env` (which may point at a hosted project).
 */
export function assertLocal(name: string, value: string): void {
  if (!isLocalUrl(value)) {
    let host = '<not a URL>'
    try {
      host = new URL(value).host
    } catch {
      // Reported as not a URL.
    }
    throw new Error(
      `Refusing to run the tests: ${name} (${host}) is not a local address. ` +
        'They create and delete data, so they only run against services on this machine ' +
        '(the local Supabase stack from `pnpm db:start` and a local Redis).',
    )
  }
}

function errorOutput(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()) {
    return error.stderr.trim()
  }
  return error instanceof Error ? error.message : String(error)
}

function localSupabaseFrom(stdout: string): LocalSupabase {
  const values = parseEnv(stdout)
  const url = values.API_URL
  const anonKey = values.ANON_KEY
  const serviceRoleKey = values.SERVICE_ROLE_KEY
  const missing = Object.entries({ API_URL: url, ANON_KEY: anonKey, SERVICE_ROLE_KEY: serviceRoleKey })
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(`\`supabase status -o env\` did not print ${missing.join(', ')}; is the local stack fully started?`)
  }
  assertLocal('SUPABASE_URL', url)
  return { url, anonKey, serviceRoleKey }
}

const NOT_RUNNING = 'The local Supabase stack is not running. Start it with `pnpm db:start` (Docker must be running), then re-run.'

function assertCli(): void {
  if (!existsSync(SUPABASE_BIN)) {
    throw new Error(`The Supabase CLI is missing (${SUPABASE_BIN}). Run \`pnpm install\` at the repository root.`)
  }
}

export async function resolveLocalSupabase(): Promise<LocalSupabase> {
  assertCli()
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync(SUPABASE_BIN, ['status', '-o', 'env'], { cwd: REPO_ROOT, timeout: 60_000 }))
  } catch (error) {
    throw new Error(`${NOT_RUNNING}\nsupabase status said: ${errorOutput(error)}`)
  }
  return localSupabaseFrom(stdout)
}

/** The same, synchronously (for configuration files that cannot await). */
export function resolveLocalSupabaseSync(): LocalSupabase {
  assertCli()
  let stdout: string
  try {
    stdout = execFileSync(SUPABASE_BIN, ['status', '-o', 'env'], { cwd: REPO_ROOT, timeout: 60_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error(`${NOT_RUNNING}\nsupabase status said: ${errorOutput(error)}`)
  }
  return localSupabaseFrom(stdout)
}
