import type {
  EntityId,
  ISODate,
  MessageApproval,
  MessageType,
  OwnerMessageType,
  PaymentArrangement,
  Tenant,
  TenantMessageType,
  User,
} from '../types/index.js'
import { OWNER_MESSAGE_TYPES, TENANT_MESSAGE_TYPES } from '../types/index.js'
import { activeArrangementsForTenant, shouldSuppressArrearsReminder } from './arrangements.js'

/**
 * Topics tenants must NEVER be messaged about automatically (product rule). These are
 * property-manager / owner concerns only. Any message type outside TENANT_MESSAGE_TYPES is
 * rejected for tenants regardless; this list exists for explicit UI copy and guards.
 */
export const FORBIDDEN_TENANT_TOPICS = [
  'rental_escalation',
  'lease_expiry',
  'renewal_option',
  'dispute',
  'bank_guarantee',
  'deposit',
] as const
export type ForbiddenTenantTopic = (typeof FORBIDDEN_TENANT_TOPICS)[number]

export function isTenantMessageType(type: string): type is TenantMessageType {
  return (TENANT_MESSAGE_TYPES as readonly string[]).includes(type)
}

export function isOwnerMessageType(type: string): type is OwnerMessageType {
  return (OWNER_MESSAGE_TYPES as readonly string[]).includes(type)
}

export class ForbiddenTenantTopicError extends Error {
  readonly messageType: string
  constructor(messageType: string) {
    super(`Message type "${messageType}" may never be sent to a tenant`)
    this.name = 'ForbiddenTenantTopicError'
    this.messageType = messageType
  }
}

/** Throws unless `type` is a permitted tenant message type. Returns the narrowed type. */
export function assertNeverTenantTopic(type: string): TenantMessageType {
  if (!isTenantMessageType(type)) throw new ForbiddenTenantTopicError(type)
  return type
}

export interface EligibilityResult {
  eligible: boolean
  /** Empty when eligible; human-readable blockers otherwise. */
  reasons: string[]
}

export interface TenantMessageContext {
  /**
   * The approval that governs the message, if any. Always required: tenant communication needs a
   * property manager's approval before sending (product hard constraint, no per-company switch).
   */
  approval?: Pick<MessageApproval, 'decision'>
  arrangements: readonly Pick<
    PaymentArrangement,
    'tenantId' | 'status' | 'agreedOn' | 'closedOn' | 'suppressArrearsReminders'
  >[]
  today: ISODate
}

const ARREARS_REMINDER_TYPES: readonly MessageType[] = [
  'initial_payment_reminder',
  'overdue_payment_reminder',
  'follow_up_payment_reminder',
]

/**
 * Why `approval` does not allow sending, or undefined when it is approved. Tenant messages always need
 * an approved approval (canSendTenantMessage); the backend's outbound gate applies the same rule, with
 * the same wording, to owner messages.
 */
export function approvalBlocker(approval: Pick<MessageApproval, 'decision'> | undefined): string | undefined {
  if (approval?.decision === 'approved') return undefined
  return approval?.decision === 'rejected' ? 'Message approval was rejected' : 'Property manager approval is required before sending'
}

type EligibleTenant = Pick<Tenant, 'id' | 'whatsappVerified' | 'whatsappOptedOut' | 'status'>

/**
 * Can this message be sent to a tenant right now? Rules, all of which must hold:
 * - messageType is a TenantMessageType (statements & payment reminders only)
 * - tenant WhatsApp number verified, tenant not opted out, tenant not vacated
 * - an approved property-manager approval (always; there is no setting that relaxes it)
 * - arrears reminders suppressed while an active arrangement pauses them
 * - instalment reminders only when the tenant has an active arrangement
 */
export function canSendTenantMessage(
  tenant: EligibleTenant,
  messageType: MessageType,
  context: TenantMessageContext,
): EligibilityResult {
  const reasons: string[] = []

  if (!isTenantMessageType(messageType)) {
    reasons.push(`Message type "${messageType}" is not permitted for tenants`)
  }
  if (!tenant.whatsappVerified) reasons.push('Tenant WhatsApp number has not been verified')
  if (tenant.whatsappOptedOut) reasons.push('Tenant has opted out of WhatsApp communication')
  if (tenant.status === 'vacated') reasons.push('Tenant has vacated')
  if (tenant.status === 'prospective') reasons.push('Tenant is prospective and has no lease yet')

  const approval = approvalBlocker(context.approval)
  if (approval) reasons.push(approval)

  if (ARREARS_REMINDER_TYPES.includes(messageType)) {
    if (shouldSuppressArrearsReminder(tenant.id, context.arrangements, context.today)) {
      reasons.push('Arrears reminders are paused by an active payment arrangement')
    }
  }

  if (messageType === 'arrangement_installment_reminder') {
    if (activeArrangementsForTenant(tenant.id, context.arrangements, context.today).length === 0) {
      reasons.push('No active payment arrangement exists for this tenant')
    }
  }

  return { eligible: reasons.length === 0, reasons }
}

type OwnerUser = Pick<User, 'status' | 'whatsappNumber' | 'memberships'>

/**
 * Owners receive weekly summaries and query responses only. Requires an active user with a
 * WhatsApp number and, when `companyId` is given, a `property_owner` membership there.
 */
export function canSendOwnerMessage(owner: OwnerUser, messageType: MessageType, companyId?: EntityId): EligibilityResult {
  const reasons: string[] = []
  if (!isOwnerMessageType(messageType)) reasons.push(`Message type "${messageType}" is not an owner message`)
  if (owner.status !== 'active') reasons.push(`Owner user is ${owner.status}`)
  if (!owner.whatsappNumber) reasons.push('Owner has no WhatsApp number on record')
  if (companyId !== undefined) {
    const isOwnerHere = owner.memberships.some((m) => m.companyId === companyId && m.role === 'property_owner')
    if (!isOwnerHere) reasons.push('User is not a property owner in this company')
  }
  return { eligible: reasons.length === 0, reasons }
}
