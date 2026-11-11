import type { EntityId, ISODateTime } from './common.js'

/**
 * The ten WhatsApp setup steps of a company, in order. Each is done only when LeaseGuard has verified it
 * (Meta's answers recorded during WhatsApp signup and number verification, Meta's delivery status of a test
 * message, or LeaseGuard's own records); never from what someone typed.
 */
export const WHATSAPP_SETUP_STEPS = [
  'business_profile',
  'meta_account',
  'business_account',
  'phone_number',
  'webhook',
  'message_templates',
  'ai_agent',
  'knowledge_base',
  'test_message',
  'ready_for_activation',
] as const
export type WhatsAppSetupStep = (typeof WHATSAPP_SETUP_STEPS)[number]

/**
 * - `done`: verified;
 * - `action_needed`: a company admin does the next thing;
 * - `waiting_on_meta`: LeaseGuard is waiting for Meta (a signup in progress, a verification running, a template in
 *   review, a test message without a delivery status yet);
 * - `blocked`: an earlier step must be done first.
 */
export const WHATSAPP_SETUP_STATES = ['done', 'action_needed', 'waiting_on_meta', 'blocked'] as const
export type WhatsAppSetupState = (typeof WHATSAPP_SETUP_STATES)[number]

export interface WhatsAppSetupStepStatus {
  step: WhatsAppSetupStep
  /** Required for activation; the AI agent and knowledge base are recommended only. */
  required: boolean
  state: WhatsAppSetupState
  title: string
  /** What is verified, or what to do next. */
  guidance: string
}

/** The company's WhatsApp go-live, recorded by a company admin once every required step was verified. */
export interface WhatsAppActivation {
  active: boolean
  activatedAt?: ISODateTime
  activatedByUserId?: EntityId
}

export const WHATSAPP_TEST_MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'delivered', 'read', 'failed'] as const
export type WhatsAppTestMessageStatus = (typeof WHATSAPP_TEST_MESSAGE_STATUSES)[number]

/** A Meta-approved template a company admin sent from a connected number to check the channel end to end. */
export interface WhatsAppTestMessage {
  id: EntityId
  numberId: EntityId
  templateName: string
  templateLanguage: string
  /** E.164; never a tenant of the company. */
  toNumber: string
  status: WhatsAppTestMessageStatus
  failureReason?: string
  /** The send's outcome is unknown: check the recipient's phone before sending another. */
  mayHaveBeenSent: boolean
  requestedByUserId?: EntityId
  createdAt: ISODateTime
  sentAt?: ISODateTime
  deliveredAt?: ISODateTime
  readAt?: ISODateTime
  failedAt?: ISODateTime
}

export interface WhatsAppSetup {
  steps: WhatsAppSetupStepStatus[]
  /** Steps done, out of `totalSteps` (all ten, recommended included). */
  completedSteps: number
  totalSteps: number
  /** Every required step is done: a company admin may activate WhatsApp. */
  readyForActivation: boolean
  activation: WhatsAppActivation
  /** The company's most recent test message (company admins only; absent for other members). */
  latestTestMessage?: WhatsAppTestMessage
}
