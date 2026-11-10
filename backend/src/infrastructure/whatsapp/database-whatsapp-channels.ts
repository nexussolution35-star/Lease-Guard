import type { EntityId } from '@leaseguard/domain'

import type { Tables } from '../database/database.types'
import type { ServiceRoleClientFactory } from '../database/service-role-client.factory'
import { type AccessTokenReference, parseAccessTokenReference } from './access-token-reference'
import { type AccessTokenAdapter, EnvAccessTokens, VaultAccessTokens } from './access-tokens'
import { accountUnavailability, defaultNumber, NOT_CONFIGURED } from './channel-readiness'
import { WhatsAppClient, type WhatsAppClientOptions } from './whatsapp.client'
import {
  type ChannelLookup,
  ChannelLookupError,
  type ChannelOptions,
  type ChannelUnavailable,
  type ChannelUnavailableReason,
  type NumberManagementLookup,
  type ReceivingNumberOwner,
  type WhatsAppChannel,
  WhatsAppChannels,
} from './whatsapp-channels'

type AccountRow = Pick<
  Tables<'whatsapp_phone_numbers'>,
  'id' | 'company_id' | 'phone_number_id' | 'access_token_reference' | 'connection_status' | 'created_at'
>
const ACCOUNT_COLUMNS = 'id, company_id, phone_number_id, access_token_reference, connection_status, created_at'

/** One credential adapter per reference kind: adding a kind fails to compile until it has one. */
export type AccessTokenAdapters = Readonly<Record<AccessTokenReference['kind'], AccessTokenAdapter>>

/**
 * WhatsAppChannels backed by `whatsapp_phone_numbers` (read with the service role, so every query filters
 * by company or by the receiving number explicitly), the credential adapters and the Graph client.
 * Worker process only: it needs the service-role key.
 */
export class DatabaseWhatsAppChannels extends WhatsAppChannels {
  constructor(
    private readonly clients: ServiceRoleClientFactory,
    private readonly graph: WhatsAppClient,
    private readonly tokens: AccessTokenAdapters,
    private readonly app: MetaAppCredentials | null = null,
  ) {
    super()
  }

  async manageNumber(companyId: EntityId, numberId: EntityId): Promise<NumberManagementLookup> {
    const { data, error } = await this.clients
      .get()
      .from('whatsapp_phone_numbers')
      .select(`${ACCOUNT_COLUMNS}, business_account_id`)
      .eq('company_id', companyId)
      .eq('id', numberId)
      .maybeSingle()
    if (error) throw new ChannelLookupError('Load WhatsApp number', error.code, error.message)
    if (!data) return unavailable('not_configured', 'The company has no such WhatsApp number')
    if (data.connection_status === 'disconnected') return unavailable('not_connected', 'The WhatsApp number was disconnected')
    const token = await this.token(data)
    if ('refused' in token) return unavailable('credentials_unavailable', token.refused)
    const { graph, app } = this
    const { business_account_id: businessAccountId, phone_number_id: phoneNumberId } = data
    const accessToken = token.token
    // Closures, so logging or serialising the handle cannot print a token.
    return {
      available: true,
      businessAccountId,
      phoneNumberId,
      inspectToken: async () => (app ? graph.debugToken(accessToken, `${app.appId}|${app.appSecret}`) : null),
      accountPhoneNumbers: () => graph.listPhoneNumbers(businessAccountId, accessToken),
      subscribeApp: () => graph.subscribeApp(businessAccountId, accessToken),
      register: (pin) => graph.registerNumber(phoneNumberId, accessToken, pin),
      templates: () => graph.listTemplates(businessAccountId, accessToken),
    }
  }

  private async token(account: AccountRow): Promise<{ token: string } | { refused: string }> {
    const reference = parseAccessTokenReference(account.access_token_reference, account.company_id)
    if (!reference) return { refused: 'The WhatsApp access token reference is not supported' }
    return this.tokens[reference.kind].resolve({ accountId: account.id, companyId: account.company_id, reference })
  }

  async forCompany(companyId: EntityId, options: ChannelOptions = {}): Promise<ChannelLookup> {
    let query = this.clients.get().from('whatsapp_phone_numbers').select(ACCOUNT_COLUMNS).eq('company_id', companyId)
    // A company holds a phone_number_id at most once, so naming one selects at most one row.
    if (options.phoneNumberId !== undefined) query = query.eq('phone_number_id', options.phoneNumberId)
    const { data: rows, error } = await query
    if (error) throw new ChannelLookupError('Load WhatsApp account', error.code, error.message)
    // Without a named number, the company's default number (channelReadiness applies the same rule).
    const data = defaultNumber(rows ?? [])
    if (!data) {
      return options.phoneNumberId === undefined
        ? NOT_CONFIGURED
        : unavailable('not_configured', 'The company has no WhatsApp Business account for that phone number')
    }
    return this.open(data)
  }

  async forReceivingNumber(phoneNumberId: string): Promise<ReceivingNumberOwner | null> {
    // Only a connected account owns its number: admins can type any phone_number_id, but only the
    // service role marks a verified account connected, and at most one connected account holds a
    // number (migration 20261110100100). Pending rows for the same number are ignored.
    const { data, error } = await this.clients
      .get()
      .from('whatsapp_phone_numbers')
      .select(ACCOUNT_COLUMNS)
      .eq('phone_number_id', phoneNumberId)
      .eq('connection_status', 'connected')
      .maybeSingle()
    if (error) throw new ChannelLookupError('Find the company of a WhatsApp number', error.code, error.message)
    if (data?.connection_status !== 'connected') return null
    // The credential is resolved only when a caller opens the channel (see ReceivingNumberOwner).
    return { companyId: data.company_id, numberId: data.id, channel: () => this.open(data) }
  }

  private async open(account: AccountRow): Promise<ChannelLookup> {
    // The same verdict channelReadiness gives the outbound gate, so approval and delivery agree.
    const notConnected = accountUnavailability(account)
    if (notConnected) return notConnected
    const result = await this.token(account)
    if ('refused' in result) return unavailable('credentials_unavailable', result.refused)
    return graphChannel(this.graph, account.phone_number_id, result.token)
  }
}

/** LeaseGuard's Meta app (WHATSAPP_APP_ID, WHATSAPP_APP_SECRET): its app access token authenticates debug_token. */
export interface MetaAppCredentials {
  appId: string
  appSecret: string
}

/**
 * The worker's channels: env tokens from `secrets` (the process environment), vault tokens via RPC, and the
 * Meta app's credentials for inspecting business tokens (null when the worker has none).
 */
export function createWhatsAppChannels(
  clients: ServiceRoleClientFactory,
  graph: WhatsAppClientOptions,
  secrets: Readonly<Record<string, string | undefined>>,
  app: MetaAppCredentials | null = null,
): WhatsAppChannels {
  return new DatabaseWhatsAppChannels(
    clients,
    new WhatsAppClient(graph),
    { env: new EnvAccessTokens(secrets), vault: new VaultAccessTokens(clients) },
    app,
  )
}

function unavailable(reason: ChannelUnavailableReason, message: string): ChannelUnavailable {
  return { available: false, reason, message }
}

// A closure rather than an object field, so logging or serialising a channel cannot print the token.
function graphChannel(graph: WhatsAppClient, phoneNumberId: string, accessToken: string): WhatsAppChannel {
  return {
    available: true,
    send: (to, message) => graph.sendMessage(phoneNumberId, accessToken, to, message),
    uploadMedia: (file, fileName, mimeType) => graph.uploadMedia(phoneNumberId, accessToken, file, fileName, mimeType),
  }
}
