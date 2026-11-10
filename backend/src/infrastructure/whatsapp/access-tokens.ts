/**
 * The credential seam of the WhatsApp channel module: one adapter per access-token reference kind.
 * Internal to the module; callers of WhatsAppChannels never see a token.
 */

import type { EntityId } from '@leaseguard/domain'

import type { ServiceRoleClientFactory } from '../database/service-role-client.factory'
import type { AccessTokenReference } from './access-token-reference'
import { ChannelLookupError } from './whatsapp-channels'

/** The account whose token is wanted, with its parsed reference. */
export interface AccessTokenRequest {
  accountId: EntityId
  companyId: EntityId
  reference: AccessTokenReference
}

/**
 * The token, or a refusal whose `message` is safe to show a property manager (it never contains a
 * token). Refusals are permanent; a transient failure is thrown as ChannelLookupError.
 */
export type AccessTokenResult = { token: string } | { refused: string }

export interface AccessTokenAdapter {
  resolve(request: AccessTokenRequest): Promise<AccessTokenResult>
}

/**
 * `secret://env/…`: the worker's own environment. The parser has already bound the variable to the
 * account's company, so only that company's variable is ever read.
 */
export class EnvAccessTokens implements AccessTokenAdapter {
  constructor(private readonly env: Readonly<Record<string, string | undefined>>) {}

  async resolve({ reference }: AccessTokenRequest): Promise<AccessTokenResult> {
    if (reference.kind !== 'env') return { refused: 'The WhatsApp access token reference is not supported' }
    const token = this.env[reference.variable]?.trim()
    return token ? { token } : { refused: `The WhatsApp access token variable ${reference.variable} is not set in the worker environment` }
  }
}

/**
 * `secret://vault/…`: Supabase Vault, through `public.whatsapp_account_access_token` (service role
 * only). The function re-reads the reference from the account row and only returns a secret named for
 * the account's company, so this adapter passes the account id, never the secret id.
 */
export class VaultAccessTokens implements AccessTokenAdapter {
  constructor(private readonly clients: ServiceRoleClientFactory) {}

  async resolve({ accountId, reference }: AccessTokenRequest): Promise<AccessTokenResult> {
    if (reference.kind !== 'vault') return { refused: 'The WhatsApp access token reference is not supported' }
    const { data, error } = await this.clients.get().rpc('whatsapp_account_access_token', { p_account_id: accountId })
    if (error) throw new ChannelLookupError('Load the WhatsApp access token from the vault', error.code, error.message)
    // The generated type says string, but the function returns null when it refuses.
    const token = typeof data === 'string' ? data.trim() : ''
    return token ? { token } : { refused: "The WhatsApp access token is not in the vault for this company's account" }
  }
}
