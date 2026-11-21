import type {
  MappingCandidate,
  MessageTypeTemplate,
  MessageTypeTemplateMapping,
  TemplateApprovalStatus,
  TemplateAudience,
  TemplatedMessageType,
} from '../types/index.js'
import { TEMPLATED_MESSAGE_TYPES } from '../types/index.js'
import { isTenantMessageType } from './communicationEligibility.js'
import { formatSADate } from './dates.js'
import { checkMessageContent, fillPlaceholders, templatePlaceholders } from './messageContent.js'
import { formatZAR } from './money.js'

/**
 * Pure rules for Settings → Message templates (ticket SG-01): which Meta template may serve a message type, how a
 * mapped type reads to a person, and the sample values a preview fills in. The database enforces the same mapping
 * rules (public.set_message_type_template); these give the API its 422 reasons and the screen its explanations.
 */

export function isTemplatedMessageType(type: string): type is TemplatedMessageType {
  return (TEMPLATED_MESSAGE_TYPES as readonly string[]).includes(type)
}

/** Tenant types go to tenants; every other templated type to property owners. */
export function messageTypeAudience(type: TemplatedMessageType): TemplateAudience {
  return isTenantMessageType(type) ? 'tenant' : 'property_owner'
}

/**
 * LeaseGuard's reading of Meta's template status, the same mapping as the database's
 * private.whatsapp_template_approval: Meta still sends a FLAGGED template, and a template in review or appeal is
 * submitted; anything else (REJECTED, PAUSED, DISABLED, …) cannot be sent.
 */
export function metaTemplateApproval(status: string): TemplateApprovalStatus {
  const s = status.trim().toUpperCase()
  if (s === 'APPROVED' || s === 'FLAGGED') return 'approved'
  if (s === 'PENDING' || s === 'IN_APPEAL') return 'submitted'
  return 'rejected'
}

/** `{{customer_name}}`: Meta's named parameters. LeaseGuard fills numbered ones only. */
const NAMED_PARAMETER = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/

const sentence = (value: string): string => {
  const words = value.trim().toLowerCase().replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Every reason Meta template `candidate` cannot serve message type `type` (empty when it can):
 * - Meta has approved it (APPROVED or FLAGGED);
 * - it is not an authentication template, and a tenant type uses a Utility template (statement and payment
 *   notifications; never marketing);
 * - LeaseGuard has its text, with numbered placeholders {{1}}…{{n}} only;
 * - the text carries no banking details (LeaseGuard never collects payments) and, for a tenant type, none of the
 *   forbidden tenant topics (escalation, expiry, renewal, dispute, guarantee, deposit).
 */
export function templateMappingProblems(type: TemplatedMessageType, candidate: MappingCandidate): string[] {
  const problems: string[] = []
  const audience = messageTypeAudience(type)
  const category = candidate.category.trim().toUpperCase()
  if (metaTemplateApproval(candidate.status) !== 'approved') {
    problems.push(`Meta has not approved "${candidate.name}" (${sentence(candidate.status)}). Only approved templates can be chosen.`)
  }
  if (category === 'AUTHENTICATION') {
    problems.push(`"${candidate.name}" is an authentication template; LeaseGuard messages use Utility templates.`)
  } else if (audience === 'tenant' && category !== 'UTILITY') {
    problems.push(`A tenant message needs a Utility template for statement and payment messages; "${candidate.name}" is ${sentence(category)}.`)
  } else if (category !== 'UTILITY' && category !== 'MARKETING') {
    problems.push(`"${candidate.name}" has Meta category ${sentence(category)}; choose a Utility template.`)
  }
  const body = candidate.body ?? ''
  if (body.trim() === '') {
    problems.push(`LeaseGuard does not have the text of "${candidate.name}" yet. Sync the templates again, then choose it.`)
    return problems
  }
  if (NAMED_PARAMETER.test(body)) {
    problems.push(`"${candidate.name}" uses named parameters; LeaseGuard fills numbered placeholders {{1}}, {{2}}… only.`)
  }
  problems.push(...checkMessageContent(body, audience).errors)
  return problems
}

/**
 * The other message type a Meta template already sends (a template sends one type), matched by Meta name and language;
 * undefined when it is free or already sends `type` itself.
 */
export function templateInUseBy(
  types: readonly MessageTypeTemplate[],
  candidate: Pick<MappingCandidate, 'name' | 'language'>,
  type: TemplatedMessageType,
): TemplatedMessageType | undefined {
  return types.find(
    (t) => t.messageType !== type && t.mapping?.metaTemplateName === candidate.name && t.mapping.language === candidate.language,
  )?.messageType
}

/** True when `candidate` may serve `type`. */
export function canMapTemplate(type: TemplatedMessageType, candidate: MappingCandidate): boolean {
  return templateMappingProblems(type, candidate).length === 0
}

// ---------------------------------------------------------------------------------- variables and preview

interface VariableSample {
  name: string
  sample: string
}

const TENANT = { name: 'Tenant name', sample: 'Sample Trading (Pty) Ltd' }
const OWNER = { name: 'Owner name', sample: 'Sample Owner' }

/** What each placeholder of a type usually holds, in order, with a clearly labelled sample value (en-ZA, ZAR). */
const VARIABLE_SAMPLES: Readonly<Record<TemplatedMessageType, readonly VariableSample[]>> = {
  monthly_statement: [
    TENANT,
    { name: 'Statement period', sample: 'November 2026' },
    { name: 'Amount due', sample: formatZAR(12450) },
    { name: 'Due date', sample: formatSADate('2026-12-07') },
  ],
  initial_payment_reminder: [TENANT, { name: 'Amount due', sample: formatZAR(12450) }, { name: 'Due date', sample: formatSADate('2026-12-07') }],
  overdue_payment_reminder: [TENANT, { name: 'Amount overdue', sample: formatZAR(12450) }, { name: 'Days overdue', sample: '14' }],
  follow_up_payment_reminder: [TENANT, { name: 'Amount overdue', sample: formatZAR(12450) }, { name: 'Days overdue', sample: '30' }],
  arrangement_installment_reminder: [
    TENANT,
    { name: 'Instalment amount', sample: formatZAR(2500) },
    { name: 'Instalment due date', sample: formatSADate('2026-12-15') },
  ],
  owner_weekly_summary: [OWNER, { name: 'Week', sample: formatSADate('2026-11-16') }, { name: 'Summary', sample: '3 events need attention' }],
  owner_query_response: [OWNER, { name: 'Answer', sample: 'Your statement for November 2026 has been verified.' }],
}

/** The names of placeholders {{1}}…{{count}} of a type; `Variable n` beyond the ones the type knows. */
export function messageTypeVariableNames(type: TemplatedMessageType, count: number): string[] {
  const known = VARIABLE_SAMPLES[type]
  return Array.from({ length: Math.max(0, count) }, (_, i) => known[i]?.name ?? `Variable ${i + 1}`)
}

/** Sample values for placeholders {{1}}…{{count}} of a type, keyed by placeholder number. */
export function sampleTemplateValues(type: TemplatedMessageType, count: number): Record<number, string> {
  const known = VARIABLE_SAMPLES[type]
  const values: Record<number, string> = {}
  for (let i = 0; i < count; i++) values[i + 1] = known[i]?.sample ?? `Sample ${i + 1}`
  return values
}

/** The template body with every numbered placeholder filled with the type's sample values. */
export function previewTemplateBody(type: TemplatedMessageType, body: string): string {
  const placeholders = templatePlaceholders(body)
  const highest = placeholders.length > 0 ? Math.max(...placeholders) : 0
  return fillPlaceholders(body, sampleTemplateValues(type, highest))
}

// ---------------------------------------------------------------------------------- how a type reads

export type MessageTypeTemplateStatus = 'not_mapped' | 'ready' | 'waiting_on_meta' | 'rejected' | 'removed' | 'text_changed'

export interface MessageTypeTemplateState {
  status: MessageTypeTemplateStatus
  /** Messages of the type can be sent now. */
  sendable: boolean
  /** What is the matter, in words. */
  summary: string
  /** What to do next; absent when nothing is needed. */
  nextStep?: string
}

const IN_WHATSAPP_MANAGER = 'Fix it in WhatsApp Manager and submit it to Meta again, or choose another approved template, then sync.'

/**
 * Whether a type's messages can be sent, and if not why and what to do next. A type sends only with a mapped
 * template Meta has approved whose text is still the text mapped (the approved text is rebuilt into Meta's template
 * parameters, so a template edited in WhatsApp Manager must be mapped again).
 */
export function messageTypeTemplateState(mapping: MessageTypeTemplateMapping | undefined): MessageTypeTemplateState {
  if (!mapping) {
    return {
      status: 'not_mapped',
      sendable: false,
      summary: 'No template chosen. Messages of this type cannot be sent.',
      nextStep: 'A company admin chooses an approved WhatsApp template for it.',
    }
  }
  if (mapping.metaStatus === undefined && mapping.approvalStatus !== 'approved') {
    return {
      status: 'removed',
      sendable: false,
      summary: `Meta no longer holds "${mapping.metaTemplateName}" (${mapping.language}). Messages of this type cannot be sent.`,
      nextStep: 'Sync the templates again, or choose another approved template.',
    }
  }
  if (mapping.approvalStatus === 'submitted' || mapping.approvalStatus === 'draft') {
    return {
      status: 'waiting_on_meta',
      sendable: false,
      summary: `Meta is reviewing "${mapping.metaTemplateName}". Messages of this type cannot be sent until Meta approves it.`,
      nextStep: 'Wait for Meta’s review; LeaseGuard updates the status when Meta decides. Sync again to check now.',
    }
  }
  if (mapping.approvalStatus === 'rejected') {
    const status = mapping.metaStatus ? sentence(mapping.metaStatus) : 'Rejected'
    const reason = mapping.rejectedReason ? `: ${sentence(mapping.rejectedReason)}` : ''
    return {
      status: 'rejected',
      sendable: false,
      summary: `${status} by Meta${reason}. Messages of this type cannot be sent.`,
      nextStep: IN_WHATSAPP_MANAGER,
    }
  }
  if (mapping.metaBodyChanged) {
    return {
      status: 'text_changed',
      sendable: false,
      summary: `The text of "${mapping.metaTemplateName}" changed in WhatsApp Manager since it was chosen. Messages of this type cannot be sent.`,
      nextStep: 'Choose the template again so LeaseGuard uses Meta’s current text.',
    }
  }
  return { status: 'ready', sendable: true, summary: 'Approved by Meta. Messages of this type can be sent once a property manager approves each one.' }
}
