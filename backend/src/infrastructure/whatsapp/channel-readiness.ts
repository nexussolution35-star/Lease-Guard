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

type NumberRow = Tables<'whatsapp_phone_numbers'>

/**
 * Why an existing number cannot send, or null when it is connected. DatabaseWhatsAppChannels applies
 * the same verdict before resolving a token, so approval and delivery agree.
 */
export function accountUnavailability(account: Pick<NumberRow, 'connection_status'>): ChannelUnavailable | null {
  if (account.connection_status === 'connected') return null
  return { available: false, reason: 'not_connected', message: `The company WhatsApp account is ${account.connection_status.replaceAll('_', ' ')}` }
}

/**
 * The number a company sends from when the caller names none: its earliest-added connected number, so
 * the choice is stable while numbers are added; without a connected one, its earliest number (whose
 * status explains why there is no channel). Null when the company has no number. Ties are broken by id.
 */
export function defaultNumber<T extends Partial<Pick<NumberRow, 'created_at' | 'id'>> & Pick<NumberRow, 'connection_status'>>(
  numbers: readonly T[],
): T | null {
  const ordered = [...numbers].sort(
    (a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || (a.id ?? '').localeCompare(b.id ?? ''),
  )
  return ordered.find((number) => number.connection_status === 'connected') ?? ordered[0] ?? null
}

/** Company `companyId`'s channel readiness. Filters by company (safe with the service role). Throws ChannelLookupError. */
export async function channelReadiness(db: DbClient, companyId: EntityId): Promise<ChannelReadiness> {
  // The same default-number rule as DatabaseWhatsAppChannels.forCompany without a phone number.
  const { data, error } = await db.from('whatsapp_phone_numbers').select('id, connection_status, created_at').eq('company_id', companyId)
  if (error) throw new ChannelLookupError('Load WhatsApp account', error.code, error.message)
  const number = defaultNumber(data ?? [])
  if (!number) return NOT_CONFIGURED
  return accountUnavailability(number) ?? { ready: true }
}
