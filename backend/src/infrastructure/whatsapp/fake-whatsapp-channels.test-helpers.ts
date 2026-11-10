import type { EntityId } from '@leaseguard/domain'

import {
  type ChannelLookup,
  type ChannelOptions,
  type ChannelUnavailable,
  type ReceivingNumberOwner,
  WhatsAppChannels,
  type WhatsAppMessage,
} from './whatsapp-channels'

export interface FakeChannelOptions {
  /** Every company's channel is unavailable with this reason when set. */
  unavailable?: Omit<ChannelUnavailable, 'available'>
  /** Answers each send; default resolves `wamid.SENT`. */
  send?: (to: string, message: WhatsAppMessage) => Promise<{ messageId: string }>
  /** Answers each upload; default resolves `media-1`. */
  upload?: (fileName: string, mimeType: string) => Promise<{ mediaId: string }>
  /** Thrown by every lookup (a transient failure). */
  lookupError?: Error
}

/**
 * In-memory WhatsAppChannels for callers' tests: one adapter instead of fake account rows, secrets and
 * Graph client. Records every lookup, send and upload.
 */
export class FakeWhatsAppChannels extends WhatsAppChannels {
  readonly lookups: { companyId: EntityId; options: ChannelOptions }[] = []
  readonly sends: { companyId: EntityId; to: string; message: WhatsAppMessage }[] = []
  readonly uploads: { companyId: EntityId; fileName: string; mimeType: string }[] = []

  constructor(private readonly options: FakeChannelOptions = {}) {
    super()
  }

  async forCompany(companyId: EntityId, options: ChannelOptions = {}): Promise<ChannelLookup> {
    this.lookups.push({ companyId, options })
    if (this.options.lookupError) throw this.options.lookupError
    if (this.options.unavailable) return { available: false, ...this.options.unavailable }
    return {
      available: true,
      send: async (to, message) => {
        this.sends.push({ companyId, to, message })
        return (this.options.send ?? (async () => ({ messageId: 'wamid.SENT' })))(to, message)
      },
      uploadMedia: async (_file, fileName, mimeType) => {
        this.uploads.push({ companyId, fileName, mimeType })
        return (this.options.upload ?? (async () => ({ mediaId: 'media-1' })))(fileName, mimeType)
      },
    }
  }

  /** No caller routes inbound traffic yet; extend when the webhook's tests need owners. */
  async forReceivingNumber(): Promise<ReceivingNumberOwner | null> {
    return null
  }
}
