import type { EntityId } from '@leaseguard/domain'

import type { DbClient } from '../infrastructure/database/rls-client.factory'
import type { EnqueueResult } from '../infrastructure/queues/queue-producer'
import type { JobPayloads } from '../infrastructure/queues/queue-registry'
import {
  type CompanyMatch,
  IMPORT_OUTCOMES,
  type ImportOutcome,
  type ImportPlan,
  type NumberImportStore,
  type TestNumberSettings,
  type VerificationStarter,
} from './whatsapp-test-number-import'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isOutcome = (value: string): value is ImportOutcome => (IMPORT_OUTCOMES as readonly string[]).includes(value)

/**
 * The number import's database side, with the SERVICE ROLE (the operator command's own process, like
 * platform:create-company): the company lookup and public.import_whatsapp_number, which writes the token into Vault for
 * that company only. The token is sent to the database function and nowhere else.
 */
export class DatabaseNumberImportStore implements NumberImportStore {
  constructor(private readonly db: DbClient) {}

  async findCompanies(reference: string): Promise<CompanyMatch[]> {
    const query = this.db.from('companies').select('id, name, initials, status')
    const { data, error } = UUID.test(reference)
      ? await query.eq('id', reference.toLowerCase())
      : await query.eq('initials', reference.toUpperCase()).order('created_at')
    if (error) throw new Error(`Look up the company failed (${error.code}): ${error.message}`)
    return (data ?? []).map((row) => ({ id: row.id, name: row.name, initials: row.initials, status: row.status }))
  }

  async importNumber(companyId: EntityId, settings: TestNumberSettings, apply: boolean): Promise<ImportPlan> {
    const { data, error } = await this.db.rpc('import_whatsapp_number', {
      p_company_id: companyId,
      p_business_account_id: settings.businessAccountId,
      p_phone_number_id: settings.phoneNumberId,
      p_access_token: settings.accessToken,
      p_apply: apply,
    })
    if (error) throw new Error(`Import the WhatsApp number failed (${error.code}): ${error.message}`)
    const row = data?.[0]
    if (!row) throw new Error('import_whatsapp_number gave no answer')
    if (!isOutcome(row.outcome)) throw new Error(`import_whatsapp_number returned an unexpected outcome: ${row.outcome}`)
    // The generated types call every returned column non-null; the function returns null for what does not apply.
    const conflicting: { id: string | null; name: string | null } = { id: row.conflicting_company_id, name: row.conflicting_company_name }
    return {
      outcome: row.outcome,
      applied: row.applied,
      ...(row.company_name ? { companyName: row.company_name } : {}),
      ...(row.number_id ? { numberId: row.number_id } : {}),
      ...(row.previous_status ? { previousStatus: row.previous_status } : {}),
      ...(conflicting.id && conflicting.name ? { conflictingCompany: { id: conflicting.id, name: conflicting.name } } : {}),
      secretsDeleted: row.secrets_deleted ?? 0,
    }
  }
}

/** The part of QueueProducer the import uses. */
export interface VerificationQueue {
  enqueueOrRetry(queue: 'whatsapp-number-verification', payload: JobPayloads['whatsapp-number-verification']): Promise<EnqueueResult>
}

/**
 * Queues the number's verification exactly as the API does after Embedded Signup (WhatsAppNumbersService): the
 * worker's whatsapp-number-verification queue with its deterministic job id per number, run again when an earlier
 * run finished. Ids only; the token never reaches Redis.
 */
export class QueueVerificationStarter implements VerificationStarter {
  constructor(private readonly queues: VerificationQueue) {}

  async start(companyId: EntityId, numberId: EntityId): Promise<'queued' | 'already_running'> {
    const { outcome } = await this.queues.enqueueOrRetry('whatsapp-number-verification', { companyId, numberId })
    return outcome === 'already_queued' ? 'already_running' : 'queued'
  }
}
