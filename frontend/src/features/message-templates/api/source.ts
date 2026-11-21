import type { EntityId, MessageTemplateSettings, MessageTypeTemplate, TemplatedMessageType } from '@leaseguard/domain'

/** The answer to a sync request: how many WhatsApp Business Accounts the worker syncs. */
export interface MessageTemplateSyncRequest {
  queued: number
  message: string
}

/** Settings → Message templates: which Meta template sends each message type. */
export interface MessageTemplateSource {
  getSettings(companyId: EntityId): Promise<MessageTemplateSettings>
  /** Company admins: the synced Meta template `whatsappTemplateId` now sends `messageType`. */
  choose(companyId: EntityId, messageType: TemplatedMessageType, whatsappTemplateId: EntityId): Promise<MessageTypeTemplate>
  /** Company admins: sync the templates from Meta again (queued for the worker). */
  sync(companyId: EntityId): Promise<MessageTemplateSyncRequest>
}
