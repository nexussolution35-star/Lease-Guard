import type { EntityId, WhatsAppConnectionStatus } from '@leaseguard/domain'

/**
 * Number import (ticket 15): a Nexus operator connects Nexus Solution's own WhatsApp test number, the one configured
 * for this installation, to one named company, so the team can send and receive real WhatsApp messages before Meta
 * approves LeaseGuard's app (until then Embedded Signup only works for the app's own test numbers and app-role users).
 *
 * The token is stored in Vault for that company only and the number is recorded pending verification
 * (public.import_whatsapp_number, migration 20261111100500); then the same number verification Embedded Signup uses is
 * queued, so the number is connected only once LeaseGuard has verified it with Meta. A dry run by default; applying
 * needs the operator's confirmation on a terminal, or --yes. Nothing here ever prints the token: every line goes
 * through `redact`, including database errors.
 */

/** The installation's single test number (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID). */
export interface TestNumberSettings {
  accessToken: string
  phoneNumberId: string
  businessAccountId: string
}

export interface CompanyMatch {
  id: EntityId
  name: string
  initials: string
  status: string
}

/** What import_whatsapp_number decided (see the migration for each outcome). */
export const IMPORT_OUTCOMES = [
  'company_not_found',
  'company_not_active',
  'number_in_use',
  'account_in_use',
  'new_number',
  'token_stored',
  'token_unchanged',
  'already_connected',
] as const
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number]

export interface ImportPlan {
  outcome: ImportOutcome
  /** False for a dry run (and for refusals). */
  applied: boolean
  companyName?: string
  /** The company's number with this phone number id; absent for a new number in a dry run. */
  numberId?: EntityId
  previousStatus?: WhatsAppConnectionStatus
  /** Who holds the number or account, for number_in_use and account_in_use. */
  conflictingCompany?: { id: EntityId; name: string }
  /** Earlier tokens of the company the import deleted from Vault. */
  secretsDeleted: number
}

/** Where the import reads and writes: the database with the service role (a fake in tests). */
export interface NumberImportStore {
  /** Companies whose id or initials are `reference`. */
  findCompanies(reference: string): Promise<CompanyMatch[]>
  /** Plans (apply = false) or applies the import. */
  importNumber(companyId: EntityId, settings: TestNumberSettings, apply: boolean): Promise<ImportPlan>
}

/** Queues the number's verification (the worker's whatsapp-number-verification queue). Throws when it cannot. */
export interface VerificationStarter {
  start(companyId: EntityId, numberId: EntityId): Promise<'queued' | 'already_running'>
}

export interface OperatorTerminal {
  /** Whether a person can answer a question (stdin and stdout are a terminal). */
  interactive: boolean
  print(line: string): void
  confirm(question: string): Promise<boolean>
}

export interface ImportOptions {
  /** The company's id or initials. */
  company: string
  apply: boolean
  /** Apply without asking (non-interactive use). */
  yes: boolean
  /** Where the import writes, e.g. "local Supabase (127.0.0.1:54321)". */
  target: string
}

export interface ImportDeps {
  store: NumberImportStore
  verification: VerificationStarter
  terminal: OperatorTerminal
}

const REFUSALS: ReadonlySet<ImportOutcome> = new Set(['company_not_found', 'company_not_active', 'number_in_use', 'account_in_use'])
const STATUS_TEXT: Record<WhatsAppConnectionStatus, string> = {
  not_configured: 'not configured',
  pending_verification: 'pending verification',
  connected: 'connected',
  disconnected: 'disconnected',
  error: 'verification failed',
}
const label = (name: string) => `${name}:`.padEnd(14)

/** `text` with every secret replaced, so nothing printed can carry the token. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets.filter((secret) => secret.length > 0).reduce((out, secret) => out.split(secret).join('[redacted]'), text)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function refusal(plan: ImportPlan, settings: TestNumberSettings, company: CompanyMatch): string {
  const holder = plan.conflictingCompany ? `${plan.conflictingCompany.name} (${plan.conflictingCompany.id})` : 'another company'
  switch (plan.outcome) {
    case 'company_not_found':
      return `Refused: company ${company.id} no longer exists.`
    case 'company_not_active':
      return `Refused: ${company.name} is not active (${company.status}); WhatsApp numbers are connected to active companies only.`
    case 'number_in_use':
      return `Refused: phone number id ${settings.phoneNumberId} belongs to another company: ${holder}. A number is connected to one company only: disconnect it there first.`
    default:
      return `Refused: WhatsApp Business Account ${settings.businessAccountId} belongs to another company: ${holder}. Import the number into that company, or remove LeaseGuard's access there first.`
  }
}

function planText(plan: ImportPlan, company: CompanyMatch): string {
  const status = plan.previousStatus ? STATUS_TEXT[plan.previousStatus] : 'unknown'
  switch (plan.outcome) {
    case 'new_number':
      return `add the number to ${company.name}, store the token in Vault for this company only, and verify the number with Meta.`
    case 'token_stored':
      return `${company.name} already lists this number (${status}): store the token in Vault for this company only, replacing its current credential, and verify the number again.`
    case 'token_unchanged':
      return `this token is already stored for this number (${status}): keep it and verify the number with Meta again.`
    default:
      return `the number is already connected to ${company.name} with this token: nothing to do. A company admin can click Verify again on Settings → Integrations → WhatsApp.`
  }
}

/** Runs the number import; resolves with the process exit code (0 done or dry run, 1 refused or failed). */
export async function importTestNumber(options: ImportOptions, settings: TestNumberSettings, deps: ImportDeps): Promise<number> {
  const say = (line: string) => deps.terminal.print(redact(line, [settings.accessToken]))
  try {
    const matches = await deps.store.findCompanies(options.company)
    if (matches.length === 0) {
      say(`No company matches ${options.company}. Pass its id or its initials (pnpm platform:create-company creates companies).`)
      return 1
    }
    if (matches.length > 1) {
      say(`${matches.length} companies match ${options.company}; pass the id of one of them:`)
      for (const match of matches) say(`  ${match.id}  ${match.name} (${match.initials}, ${match.status})`)
      return 1
    }
    const company = matches[0]!

    say(`${label('Target')}${options.target}`)
    say(`${label('Company')}${company.name} (${company.initials}) ${company.id}`)
    say(`${label('Number')}phone number id ${settings.phoneNumberId} in WhatsApp Business Account ${settings.businessAccountId}`)
    say(`${label('Token')}WHATSAPP_ACCESS_TOKEN (not shown)`)

    const planned = await deps.store.importNumber(company.id, settings, false)
    if (REFUSALS.has(planned.outcome)) {
      say(refusal(planned, settings, company))
      return 1
    }
    say(`${label('Plan')}${planText(planned, company)}`)
    if (planned.outcome === 'already_connected') return 0

    if (!options.apply) {
      say('')
      say('Dry run: nothing was changed. Re-run with --apply to connect the number (add --yes when there is no terminal to confirm on).')
      return 0
    }
    if (!options.yes) {
      if (!deps.terminal.interactive) {
        say('Cannot ask for confirmation without a terminal; re-run with --apply --yes.')
        return 1
      }
      const question = redact(
        `Connect phone number id ${settings.phoneNumberId} to ${company.name} (${company.initials}) on ${options.target}? [y/N] `,
        [settings.accessToken],
      )
      if (!(await deps.terminal.confirm(question))) {
        say('Cancelled: nothing was changed.')
        return 1
      }
    }

    const applied = await deps.store.importNumber(company.id, settings, true)
    if (REFUSALS.has(applied.outcome)) {
      say(refusal(applied, settings, company))
      return 1
    }
    if (applied.outcome === 'already_connected' || !applied.numberId) {
      say(`${label('Result')}${planText(applied, company)}`)
      return 0
    }
    const deleted = applied.secretsDeleted > 0 ? ` (${applied.secretsDeleted} earlier token${applied.secretsDeleted === 1 ? '' : 's'} deleted)` : ''
    say(`${label('Result')}the number is pending verification; its token is stored in Vault for ${company.name} only${deleted}.`)
    say(`${label('Number id')}${applied.numberId}`)

    let started: 'queued' | 'already_running'
    try {
      started = await deps.verification.start(company.id, applied.numberId)
    } catch (error) {
      say(`${label('Verification')}could not be queued (${message(error)}).`)
      say(
        'The number stays pending verification. Start the worker and Redis, then re-run this command, or have a company admin click Verify again on Settings → Integrations → WhatsApp.',
      )
      return 1
    }
    say(
      `${label('Verification')}${
        started === 'queued'
          ? 'queued with the LeaseGuard worker.'
          : 'a verification of this number was already queued or running; if it was running, click Verify again once it finishes so the new token is checked.'
      }`,
    )
    say('')
    say(
      'The number shows as Connected only after every check passes (token scopes, the number in its WhatsApp Business Account, webhook subscription, registration, message templates); Settings → Integrations → WhatsApp shows each check and how to fix a failure.',
    )
    say(
      `The installation-wide WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_BUSINESS_MESSAGING_ACCOUNT_ID are not used for sending: ${company.name} sends through its own stored token. You may remove them from the environment.`,
    )
    return 0
  } catch (error) {
    say(`whatsapp:import-test-number: ${message(error)}`)
    return 1
  }
}
