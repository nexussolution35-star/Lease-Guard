/**
 * Interface of the WhatsApp channel module: "send as company C" and "which company owns this receiving
 * number". Everything else (the whatsapp_accounts row, the connection check, the credential seam with
 * its env and vault adapters, the Graph API client) is implementation behind it, so callers never see
 * an access token and a new credential store changes one module.
 *
 * Callers: the message delivery processor today; the shared Meta webhook (routes by the receiving
 * phone_number_id), Embedded Signup's connection check and per-business AI agents next. The outbound
 * gate asks `channelReadiness` (channel-readiness.ts), the part of this interface that needs no
 * credential, so the API can check a channel is connected before a message is approved.
 */

import type { EntityId } from '@leaseguard/domain'

import type { WhatsAppMessage } from './whatsapp.client'

// Graph failures keep their classification (retryable / outcomeUnknown) through the channel.
export { WhatsAppApiError } from './whatsapp.client'
export type { TemplateComponent, TemplateParameter, WhatsAppMessage } from './whatsapp.client'

/** A company's connected WhatsApp number, ready to send. Errors are WhatsAppApiError. */
export interface WhatsAppChannel {
  readonly available: true
  /** Sends one message to `to` (E.164); resolves with the WhatsApp message id (`wamid…`). */
  send(to: string, message: WhatsAppMessage): Promise<{ messageId: string }>
  /** Uploads a document for a later message from this number; resolves with the media id. */
  uploadMedia(file: Blob, fileName: string, mimeType: string): Promise<{ mediaId: string }>
}

/**
 * Why there is no channel. Permanent until someone changes the configuration:
 * - `not_configured`: the company has no WhatsApp account (or none with that phone_number_id);
 * - `not_connected`: the account exists but is not `connected` (pending verification, disconnected…);
 * - `credentials_unavailable`: the access token reference cannot be resolved.
 */
export type ChannelUnavailableReason = 'not_configured' | 'not_connected' | 'credentials_unavailable'

export interface ChannelUnavailable {
  readonly available: false
  readonly reason: ChannelUnavailableReason
  /** Safe to show a property manager; never contains a token. */
  readonly message: string
}

export type ChannelLookup = WhatsAppChannel | ChannelUnavailable

export interface ChannelOptions {
  /** A specific receiving number of the company; without it, the company's account. */
  phoneNumberId?: string
}

/** The company that owns a receiving phone_number_id. */
export interface ReceivingNumberOwner {
  readonly companyId: EntityId
  /**
   * Opens the owner's channel for this number (which may be unavailable). The credential is resolved
   * here, not by forReceivingNumber, so routing a webhook event never decrypts a token or fails when
   * the vault is unreachable. Throws ChannelLookupError when transient.
   */
  channel(): Promise<ChannelLookup>
}

/**
 * A lookup failed transiently (database or vault unreachable); retrying may succeed. Never carries a
 * token.
 */
export class ChannelLookupError extends Error {
  readonly code: string

  constructor(operation: string, code: string, message: string) {
    super(`${operation} failed (${code}): ${message}`)
    this.name = 'ChannelLookupError'
    this.code = code
  }
}

/** The module's interface; also the Nest injection token. */
export abstract class WhatsAppChannels {
  /** Company `companyId`'s channel, or why it has none. Throws ChannelLookupError when transient. */
  abstract forCompany(companyId: EntityId, options?: ChannelOptions): Promise<ChannelLookup>

  /**
   * The company that owns receiving number `phoneNumberId`, or null when no company does. Only a
   * connected (verified) account owns a number; the database allows one connected account per number.
   * An admin-entered, unverified number is never an owner. Throws ChannelLookupError when transient.
   */
  abstract forReceivingNumber(phoneNumberId: string): Promise<ReceivingNumberOwner | null>
}
