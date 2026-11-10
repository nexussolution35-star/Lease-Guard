import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { REPO_ROOT, SUPABASE_BIN } from './paths.ts'

const execFileAsync = promisify(execFile)

/**
 * SQL against the LOCAL database through `supabase db query` (the CLI targets the local stack unless
 * `--remote` is passed, which this helper never does, and it checks the CLI reported a local target).
 *
 * Used only where the Data API cannot do the job: whole-row snapshots, audit counts and the generic
 * world cleanup (tests/fixtures/world.ts).
 */
export async function localSql(sql: string): Promise<unknown[]> {
  let stdout: string
  let stderr: string
  try {
    ;({ stdout, stderr } = await execFileAsync(SUPABASE_BIN, ['db', 'query', '--output-format', 'json', sql], {
      cwd: REPO_ROOT,
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    }))
  } catch (error) {
    const output =
      typeof error === 'object' && error !== null && 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : ''
    throw new Error(`supabase db query failed: ${output.trim() || (error instanceof Error ? error.message : String(error))}`)
  }
  if (!/Target: local/i.test(stderr)) {
    throw new Error(`Refusing to continue: supabase db query did not report a local target (${stderr.trim()})`)
  }
  // Statements that return no rows (e.g. DO) print only their command tag.
  if (/^[A-Z]+(?: [A-Z]+)*(?: \d+)*$/.test(stdout.trim())) return []
  const parsed: unknown = JSON.parse(stdout)
  if (typeof parsed !== 'object' || parsed === null || !('rows' in parsed) || !Array.isArray(parsed.rows)) {
    throw new Error(`Unexpected supabase db query output: ${stdout.slice(0, 500)}`)
  }
  return parsed.rows
}
