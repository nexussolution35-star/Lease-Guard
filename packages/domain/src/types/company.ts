import type { Address, BaseEntity, EntityId, ISODateTime } from './common.js'

export const COMPANY_STATUSES = ['active', 'suspended', 'archived'] as const
export type CompanyStatus = (typeof COMPANY_STATUSES)[number]

export const WHATSAPP_CONNECTION_STATUSES = [
  'not_configured',
  'pending_verification',
  'connected',
  'disconnected',
  'error',
] as const
export type WhatsAppConnectionStatus = (typeof WHATSAPP_CONNECTION_STATUSES)[number]

/**
 * Company-specific WhatsApp Business configuration.
 * Only non-secret references live in the frontend; the access token itself never does.
 */
export interface WhatsAppAccountConfig {
  businessAccountId: string
  phoneNumberId: string
  displayName: string
  /** E.164 number shown to tenants, e.g. `+27 11 555 0100`. */
  displayNumber: string
  /** Opaque reference to the server-side secret (never the token). */
  accessTokenReference: string
  webhookConfigured: boolean
  connectionStatus: WhatsAppConnectionStatus
  lastVerifiedAt?: ISODateTime
}

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** Configurable monitoring intervals and communication defaults per company. */
export interface CompanySettings {
  /** Days before lease expiry at which expiry events are raised. */
  leaseExpiryNoticeDays: readonly number[]
  /** Days before a renewal notice deadline at which warnings are raised. */
  renewalDeadlineWarningDays: readonly number[]
  /** Days before guarantee expiry at which expiry events are raised. */
  guaranteeExpiryNoticeDays: readonly number[]
  /** Days after statement date for the initial, overdue and follow-up payment reminders. */
  paymentReminderOffsetsDays: { initial: number; overdue: number; followUp: number }
  /** Days before an instalment due date to send the instalment reminder. */
  installmentReminderLeadDays: number
  ownerSummaryWeekday: Weekday
  /** Pilot safety switch: tenant messages require approval before sending. */
  requireApprovalForTenantMessages: boolean
  timezone: 'Africa/Johannesburg'
}

export interface Company extends BaseEntity {
  name: string
  tradingName?: string
  registrationNumber?: string
  vatNumber?: string
  address: Address
  contactEmail: string
  contactPhone: string
  status: CompanyStatus
  /** Two-letter initials used in the workspace switcher avatar. */
  initials: string
  whatsapp: WhatsAppAccountConfig
  settings: CompanySettings
}

export type CompanyId = EntityId
