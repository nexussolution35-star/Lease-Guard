import type { EntityId } from '@leaseguard/domain'

import type { Tables } from '../database/database.types'
import type { DbClient } from '../database/rls-client.factory'
import { type ChannelUnavailable, ChannelLookupError } from './whatsapp-channels'

/**
 * Part of the WhatsApp channel module's interface: whether company C's channel is set up to send (an
 * account exists and is connected), without opening it. Unlike `WhatsAppChannels.forCompany` it never
 * resolves a credential and reads through the caller's own client, so the API can ask under the
 * signed-in user's Row Level Security while the service role and the tokens stay in the worker.
 * A credential that cannot be resolved is only found when the worker opens the channel.
 */
export type ChannelReadiness = { readonly ready: true } | ChannelUnavailable

/** The company has no WhatsApp account (or none matching what the caller asked for). */
export const NOT_CONFIGURED: ChannelUnavailable = {
  available: false,
  reason: 'not_configured',
  message: 'The company has no WhatsApp Business account configured',
}

/**
 * Why an existing account cannot send, or null when it is connected. DatabaseWhatsAppChannels applies
 * the same verdict before resolving a token, so approval and delivery agree.
 */
export function accountUnavailability(account: Pick<Tables<'whatsapp_accounts'>, 'connection_status'>): ChannelUnavailable | null {
  if (account.connection_status === 'connected') return null
  return { available: false, reason: 'not_connected', message: `The company WhatsApp account is ${account.connection_status.replaceAll('_', ' ')}` }
}

/** Company `companyId`'s channel readiness. Filters by company (safe with the service role). Throws ChannelLookupError. */
export async function channelReadiness(db: DbClient, companyId: EntityId): Promise<ChannelReadiness> {
  // One account per company today (company_id is unique); see DatabaseWhatsAppChannels.forCompany.
  const { data, error } = await db.from('whatsapp_accounts').select('connection_status').eq('company_id', companyId).maybeSingle()
  if (error) throw new ChannelLookupError('Load WhatsApp account', error.code, error.message)
  if (!data) return NOT_CONFIGURED
  return accountUnavailability(data) ?? { ready: true }
}
