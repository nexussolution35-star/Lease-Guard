import type { EntityId } from '@leaseguard/domain'

import { type MetaMessageTemplate, WhatsAppApiError, type WhatsAppChannels } from '../../infrastructure/whatsapp/whatsapp-channels'

/** Where the sync writes (the database with the service role; a fake in tests). */
export interface TemplateSyncStore {
  syncTemplates(companyId: EntityId, businessAccountId: string, templates: readonly MetaMessageTemplate[]): Promise<number>
}

export interface TemplateSyncDeps {
  channels: WhatsAppChannels
  store: TemplateSyncStore
}

export type TemplateSyncOutcome =
  | { outcome: 'synced'; businessAccountId: string; count: number; approved: number }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'failed'; message: string; metaErrorCode?: number }

/**
 * Syncs the message templates of one number's WhatsApp Business Account from Meta (ticket SG-01: Settings → Message
 * templates → Sync again): Meta's status, text and header format replace the account's synced catalogue, and the
 * company's own templates follow Meta's status (sync_whatsapp_message_templates). The same sync as step 5 of number
 * verification, without re-checking the number.
 *
 * Transient failures (Meta unreachable or throttling, the vault or database) throw so the job is retried with backoff,
 * except on the final attempt; Meta refusing the request is not retried. A number that is no longer the company's,
 * disconnected or without a credential is skipped.
 */
export async function syncNumberTemplates(
  { companyId, numberId }: { companyId: EntityId; numberId: EntityId },
  { finalAttempt }: { finalAttempt: boolean },
  { channels, store }: TemplateSyncDeps,
): Promise<TemplateSyncOutcome> {
  const lookup = await channels.manageNumber(companyId, numberId)
  if (!lookup.available) return { outcome: 'skipped', reason: lookup.reason }

  let templates: MetaMessageTemplate[]
  try {
    templates = await lookup.templates()
  } catch (error) {
    if (error instanceof WhatsAppApiError && (!error.retryable || finalAttempt)) {
      return { outcome: 'failed', message: error.message, ...(error.graphCode !== undefined ? { metaErrorCode: error.graphCode } : {}) }
    }
    throw error
  }
  const count = await store.syncTemplates(companyId, lookup.businessAccountId, templates)
  const approved = templates.filter((t) => t.status.toUpperCase() === 'APPROVED').length
  return { outcome: 'synced', businessAccountId: lookup.businessAccountId, count, approved }
}
