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
 * One of a company's WhatsApp business numbers. Only non-secret fields: the credential reference and the
 * token never leave the server. Meta's view of the number (verified name, quality rating, code
 * verification, display-name status, Meta status) is recorded by LeaseGuard's worker, never typed in.
 */
export interface WhatsAppPhoneNumber {
  id: EntityId
  /** Meta id of the WhatsApp Business Account the number belongs to. */
  businessAccountId: string
  /** Meta phone number id; the receiving number that routes inbound messages to the company. */
  phoneNumberId: string
  displayName: string
  /** International number, e.g. `+27 11 555 0100`. */
  displayNumber: string
  verifiedName?: string
  /** Meta quality rating, e.g. `GREEN`. */
  qualityRating?: string
  /** Meta code verification status, e.g. `VERIFIED`. */
  codeVerificationStatus?: string
  /** Meta display-name review status, e.g. `APPROVED`. */
  nameStatus?: string
  /** Meta's own status of the number, e.g. `CONNECTED`. */
  metaStatus?: string
  webhookConfigured: boolean
  /** LeaseGuard's verified connection status; `connected` only after the worker verified it. */
  connectionStatus: WhatsAppConnectionStatus
  lastVerifiedAt?: ISODateTime
  /** Meta locked registration after too many attempts (error 133016); no new attempt before this time. */
  registrationBlockedUntil?: ISODateTime
  /** The outcome of each verification step, in step order; empty until verification first ran. */
  verificationSteps: WhatsAppVerificationStepResult[]
  createdAt: ISODateTime
}

/**
 * The checks LeaseGuard makes with Meta before a number is connected, in order: the business token's scopes,
 * the number in its account, the webhook subscription, Cloud API registration and the template sync.
 */
export const WHATSAPP_VERIFICATION_STEPS = [
  'token_scopes',
  'phone_number',
  'webhook_subscription',
  'registration',
  'message_templates',
] as const
export type WhatsAppVerificationStep = (typeof WHATSAPP_VERIFICATION_STEPS)[number]

/** `action_needed`: waiting for the admin (the registration PIN). `not_required`: counts as passed. */
export const WHATSAPP_VERIFICATION_STEP_STATUSES = ['pending', 'passed', 'failed', 'action_needed', 'not_required'] as const
export type WhatsAppVerificationStepStatus = (typeof WHATSAPP_VERIFICATION_STEP_STATUSES)[number]

/** One verification step of a number as the worker last recorded it. Messages are safe to show the admin. */
export interface WhatsAppVerificationStepResult {
  step: WhatsAppVerificationStep
  status: WhatsAppVerificationStepStatus
  /** What happened, for the admin. */
  message?: string
  /** How to recover, when the step failed or needs action. */
  recovery?: string
  /** Meta's error code, when Meta refused. */
  metaErrorCode?: string
  checkedAt?: ISODateTime
}

/** A message template Meta holds for a company's WhatsApp Business Account, as last synced. */
export interface WhatsAppMessageTemplate {
  id: EntityId
  /** Meta id of the WhatsApp Business Account. */
  businessAccountId: string
  metaTemplateId: string
  name: string
  /** Meta language code, e.g. `en_ZA`. */
  language: string
  /** Meta's category, e.g. `UTILITY`. */
  category: string
  /** Meta's review status, e.g. `APPROVED`, `PENDING`, `REJECTED`, `PAUSED`. */
  status: string
  rejectedReason?: string
  syncedAt: ISODateTime
}

/** A company's WhatsApp Business Account (Meta WABA) with its numbers. A company may hold several. */
export interface WhatsAppBusinessAccount {
  id: EntityId
  /** Meta id of the WhatsApp Business Account. */
  businessAccountId: string
  /** Name Meta reports for the account, once LeaseGuard has read it. */
  name?: string
  numbers: WhatsAppPhoneNumber[]
  createdAt: ISODateTime
}

/**
 * A company's WhatsApp numbers at a glance. `connectionStatus` is `connected` when the company can send
 * (one of its numbers is connected), otherwise the status of its earliest number, and `not_configured`
 * without numbers. Details are on the WhatsApp integration endpoints.
 */
export interface WhatsAppSummary {
  connectionStatus: WhatsAppConnectionStatus
  numberCount: number
  connectedNumberCount: number
}

/**
 * Where a Meta Embedded Signup attempt (onboarding session) stands. `exchanged`: the business token is
 * stored and the shared number is pending verification; `completed` is reserved for after verification.
 */
export const WHATSAPP_ONBOARDING_STATUSES = [
  'started',
  'code_received',
  'exchanged',
  'completed',
  'cancelled',
  'failed',
  'expired',
] as const
export type WhatsAppOnboardingStatus = (typeof WHATSAPP_ONBOARDING_STATUSES)[number]

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

/**
 * Configurable monitoring intervals and communication defaults per company. Tenant-message approval is
 * not a setting: every tenant message needs property-manager approval (product hard constraint).
 */
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
  whatsapp: WhatsAppSummary
  settings: CompanySettings
}

export type CompanyId = EntityId
