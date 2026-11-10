import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import type { EntityId, WhatsAppAgentConfig } from '@leaseguard/domain'

import { unwrapDatabase } from '../../common/http/database-errors'
import type { DbClient } from '../../infrastructure/database/rls-client.factory'
import { memberNames } from '../whatsapp-conversations/member-names'
import { toAgentConfig, toConfigRecord } from './whatsapp-agent.mapper'
import type { SaveAgentConfigBody } from './whatsapp-agent.schemas'

/**
 * The active company's AI agent configuration (ticket 09). Every member reads it; company admins save it, through
 * save_whatsapp_agent_config, which replaces the configuration and its handover contacts in one transaction and checks
 * the caller is a company admin (RLS) and every handover contact an active admin or property manager of the company.
 * Whatever it says, tenants are never answered automatically (the agent runtime, ticket 10).
 */
@Injectable()
export class WhatsAppAgentService {
  async getConfig(db: DbClient, companyId: EntityId): Promise<WhatsAppAgentConfig> {
    const [config, contacts] = await Promise.all([
      db.from('whatsapp_agent_configs').select('*').eq('company_id', companyId).maybeSingle(),
      db.from('whatsapp_agent_handover_contacts').select('user_id').eq('company_id', companyId).order('created_at', { ascending: true }),
    ])
    const row = config.error ? unwrapDatabase(config, 'Load agent configuration') : config.data
    const contactIds = unwrapDatabase(contacts, 'Load handover contacts').map((contact) => contact.user_id)
    return toAgentConfig(companyId, row, contactIds, await memberNames(db, contactIds))
  }

  async saveConfig(db: DbClient, companyId: EntityId, body: SaveAgentConfigBody): Promise<WhatsAppAgentConfig> {
    unwrapDatabase(
      await db.rpc('save_whatsapp_agent_config', {
        p_company_id: companyId,
        p_config: toConfigRecord(body) as never,
        p_handover_user_ids: [...new Set(body.handoverContactUserIds)],
      }),
      'Save agent configuration',
      {
        '22023': () =>
          new UnprocessableEntityException(['Handover contacts must be active company admins or property managers of this company']),
      },
    )
    return this.getConfig(db, companyId)
  }
}
