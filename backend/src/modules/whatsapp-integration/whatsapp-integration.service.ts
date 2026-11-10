import { Injectable } from '@nestjs/common'
import type { EntityId, WhatsAppBusinessAccount } from '@leaseguard/domain'

import { httpErrorFromDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { BUSINESS_ACCOUNT_COLUMNS, NUMBER_COLUMNS, STEP_COLUMNS, toWhatsAppBusinessAccounts } from './whatsapp-numbers.mapper'

/**
 * A company's WhatsApp Business Accounts and numbers, read with the caller's client (Row Level Security
 * plus an explicit company filter). Read-only: numbers are added by Embedded Signup or an admin's
 * identifiers, and their status is recorded by the worker, never by the API.
 */
@Injectable()
export class WhatsAppIntegrationService {
  async listBusinessAccounts(db: DbClient, companyId: EntityId): Promise<WhatsAppBusinessAccount[]> {
    const [accounts, numbers, steps] = await Promise.all([
      db.from('whatsapp_business_accounts').select(BUSINESS_ACCOUNT_COLUMNS).eq('company_id', companyId),
      db.from('whatsapp_phone_numbers').select(NUMBER_COLUMNS).eq('company_id', companyId),
      db.from('whatsapp_number_verification_steps').select(STEP_COLUMNS).eq('company_id', companyId),
    ])
    if (accounts.error) throw httpErrorFromDatabase(accounts.error, 'List WhatsApp Business Accounts')
    if (numbers.error) throw httpErrorFromDatabase(numbers.error, 'List WhatsApp numbers')
    if (steps.error) throw httpErrorFromDatabase(steps.error, 'List WhatsApp verification steps')
    return toWhatsAppBusinessAccounts(accounts.data ?? [], numbers.data ?? [], steps.data ?? [])
  }
}
