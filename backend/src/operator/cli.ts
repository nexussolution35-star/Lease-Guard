import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

import { Logger } from '@nestjs/common'
import { createClient } from '@supabase/supabase-js'

import { InvalidEnvironmentError, loadNumberImportEnv } from '../config/env'
import type { Database } from '../infrastructure/database/database.types'
import { SERVER_AUTH_OPTIONS } from '../infrastructure/database/supabase-config'
import { QueueProducer } from '../infrastructure/queues/queue-producer'
import { DatabaseNumberImportStore, QueueVerificationStarter } from './number-import-store'
import { importTestNumber, type OperatorTerminal, redact } from './whatsapp-test-number-import'

export const USAGE = `Connects Nexus Solution's own WhatsApp test number (this installation's WHATSAPP_ACCESS_TOKEN,
WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID) to one company, before Meta approves
LeaseGuard's app. The token is stored in Vault for that company only; the number stays pending verification
until LeaseGuard has verified it with Meta (the same verification as Embedded Signup).

  pnpm whatsapp:import-test-number -- --company <company id | initials>                 dry run (default)
  pnpm whatsapp:import-test-number -- --company <company id | initials> --apply         asks, then applies
  pnpm whatsapp:import-test-number -- --company <company id | initials> --apply --yes   applies without asking

Options:
  --company <id | initials>  the company to connect the number to (it must exist and be active)
  --apply                    store the token and queue the verification (otherwise nothing is changed)
  --yes                      with --apply: do not ask for confirmation (non-interactive use)
  --hosted                   allow a hosted Supabase project (SUPABASE_URL not on this machine)
  -h, --help                 show this help

Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REDIS_URL, QUEUE_PREFIX and the three test-number settings from the
process environment, falling back to backend/.env only for those keys. The token is never printed.
Re-running is safe: the same token is kept, a newer token replaces the stored one. See docs/integrations/whatsapp.md.`

export class UsageError extends Error {}

export type ImportArgs = { help: true } | { help: false; company: string; apply: boolean; yes: boolean; hosted: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', 'host.docker.internal'])

/** The command line; throws UsageError for anything it does not accept. */
export function parseImportArgs(argv: readonly string[]): ImportArgs {
  // pnpm forwards a leading `--` from `pnpm whatsapp:import-test-number -- --company NS`.
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  let values
  try {
    ;({ values } = parseArgs({
      args,
      options: {
        company: { type: 'string' },
        apply: { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
        hosted: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: false,
      strict: true,
    }))
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  if (values.help) return { help: true }
  const company = values.company?.trim() ?? ''
  if (!company) throw new UsageError('--company is required: the id of the company or its two-letter initials')
  if (!UUID.test(company) && !/^[A-Za-z]{2}$/.test(company)) {
    throw new UsageError(`--company must be the company's id (a uuid) or its two-letter initials, not "${company}"`)
  }
  if (values.yes && !values.apply) throw new UsageError('--yes only applies with --apply')
  return { help: false, company, apply: values.apply, yes: values.yes, hosted: values.hosted }
}

/** Where the import writes; a hosted project only with --hosted. */
export function describeTarget(supabaseUrl: string, allowHosted: boolean): { hosted: boolean; target: string } {
  const url = new URL(supabaseUrl)
  const hosted = !LOCAL_HOSTS.has(url.hostname)
  if (hosted && !allowHosted) {
    throw new UsageError(`SUPABASE_URL points at a hosted project (${url.host}); pass --hosted to import the number there`)
  }
  return { hosted, target: `${hosted ? 'HOSTED' : 'local'} Supabase (${url.host})` }
}

function terminal(secrets: readonly string[]): OperatorTerminal & { close(): void } {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined
  return {
    interactive,
    print: (line) => console.log(redact(line, secrets)),
    confirm: async (question) => /^y(es)?$/i.test((await rl?.question(question))?.trim() ?? ''),
    close: () => rl?.close(),
  }
}

/** The number import command; resolves with the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  let args: ImportArgs
  try {
    args = parseImportArgs(argv)
  } catch (error) {
    console.error(`whatsapp:import-test-number: ${(error as Error).message}\n\n${USAGE}`)
    return 1
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }

  let env
  let target
  try {
    env = loadNumberImportEnv()
    target = describeTarget(env.SUPABASE_URL, args.hosted)
  } catch (error) {
    if (error instanceof InvalidEnvironmentError || error instanceof UsageError) {
      console.error(`whatsapp:import-test-number: ${error.message}`)
      return 1
    }
    throw error
  }
  const secrets = [env.WHATSAPP_ACCESS_TOKEN, env.SUPABASE_SERVICE_ROLE_KEY]

  // The shared queue producer logs through NestJS; the command reports every outcome itself.
  Logger.overrideLogger(false)
  const db = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: SERVER_AUTH_OPTIONS })
  const queues = new QueueProducer({ REDIS_URL: env.REDIS_URL, QUEUE_PREFIX: env.QUEUE_PREFIX })
  const io = terminal(secrets)
  try {
    return await importTestNumber(
      { company: args.company, apply: args.apply, yes: args.yes, target: target.target },
      { accessToken: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, businessAccountId: env.WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID },
      { store: new DatabaseNumberImportStore(db), verification: new QueueVerificationStarter(queues), terminal: io },
    )
  } finally {
    io.close()
    // Redis may be down: never wait long for the connection to close.
    await Promise.race([queues.onApplicationShutdown(), new Promise((resolve) => setTimeout(resolve, 2_000).unref())])
  }
}
