import type { CompanyScoped, EntityId, EntityType } from './common.js'

export const NOTIFICATION_TYPES = [
  'monitoring_event',
  'statement_review',
  'approval_request',
  'arrangement',
  'message_failed',
  'system',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number]

export interface Notification extends CompanyScoped {
  userId: EntityId
  type: NotificationType
  severity: NotificationSeverity
  title: string
  body: string
  read: boolean
  readAt?: string
  link?: { entityType: EntityType; entityId: EntityId }
}
