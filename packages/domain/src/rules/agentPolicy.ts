import type {
  AgentDecision,
  AgentMessageCategory,
  AgentOperatingPeriod,
  AgentPermittedAction,
  ISODateTime,
} from '../types/index.js'
import { WEEKDAYS } from '../types/index.js'
import { CUSTOMER_SERVICE_WINDOW_MS } from './contactReply.js'
import { containsBankDetails } from './messageContent.js'

/**
 * The AI agent's policy (ticket 10): what actually happens to an inbound WhatsApp message after the model proposed a
 * decision. The model never decides alone; these rules do, so the business controls what the AI can say:
 *
 * - Tenants are never answered automatically: at most an internal suggestion for staff, and always a handover.
 * - Contacts are answered only when the company turned auto-reply on, the action is permitted, the 24-hour customer
 *   service window is open, it is within operating hours (else the out-of-hours message) and the reply passes the
 *   guards: no bank details, no payment, dispute, lease-expiry, renewal or escalation content, a length limit.
 * - Complaints, payments and arrangements, disputes, lease questions, refusals, model errors and low confidence go to
 *   a person.
 */

/** Below this confidence the agent hands over instead of answering. */
export const AGENT_CONFIDENCE_THRESHOLD = 0.7
/** Longest answer the agent sends (WhatsApp allows 4 096; answers to FAQs are short). */
export const AGENT_REPLY_MAX_LENGTH = 1000

// ------------------------------------------------------------------ operating hours

export interface OperatingHoursState {
  open: boolean
  /** When the current closed period began (the last closing time), when closed and ever open. */
  closedSince?: ISODateTime
}

const MINUTES_PER_DAY = 24 * 60
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY
const FALLBACK_TIMEZONE = 'Africa/Johannesburg'

function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** Minutes since Monday 00:00 in `timezone` at `now`. */
function weekMinute(now: Date, timezone: string): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  } catch {
    // An unknown timezone cannot be saved (the database checks the shape only), but never fail a run over it.
    return weekMinute(now, FALLBACK_TIMEZONE)
  }
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = WEEKDAYS.indexOf(value('weekday').toLowerCase() as (typeof WEEKDAYS)[number])
  return Math.max(0, day) * MINUTES_PER_DAY + Number(value('hour')) * 60 + Number(value('minute'))
}

/**
 * Whether the business is open at `now` in its timezone, and if not since when (the most recent closing time).
 * Without periods it is never open. Minute precision; South Africa has no daylight saving time.
 */
export function operatingHoursState(periods: readonly AgentOperatingPeriod[], timezone: string, now: Date): OperatingHoursState {
  if (periods.length === 0) return { open: false }
  const current = weekMinute(now, timezone)
  let sinceClose = Number.POSITIVE_INFINITY
  for (const period of periods) {
    const dayStart = WEEKDAYS.indexOf(period.day) * MINUTES_PER_DAY
    const opens = dayStart + minutesOf(period.opens)
    const closes = dayStart + minutesOf(period.closes)
    if (current >= opens && current < closes) return { open: true }
    const ago = (((current - closes) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK
    sinceClose = Math.min(sinceClose, ago)
  }
  // Whole minutes: the closing time itself, not `now` minus the seconds elapsed in this minute.
  const minuteStart = Math.floor(now.getTime() / 60_000) * 60_000
  return { open: false, closedSince: new Date(minuteStart - sinceClose * 60_000).toISOString() }
}

/**
 * The out-of-hours message is sent at most once per window: not again if one was sent to the conversation since the
 * business closed, nor within the last 24 hours (WhatsApp's customer service window).
 */
export function outOfHoursDedupeSince(state: OperatingHoursState, now: Date): ISODateTime {
  const dayAgo = now.getTime() - CUSTOMER_SERVICE_WINDOW_MS
  const closed = state.closedSince ? Date.parse(state.closedSince) : Number.NEGATIVE_INFINITY
  return new Date(Math.max(dayAgo, closed)).toISOString()
}

// ------------------------------------------------------------------ content guards

export const RESTRICTED_CONTACT_TOPICS = ['payment', 'dispute', 'lease_expiry', 'renewal', 'escalation'] as const
export type RestrictedContactTopic = (typeof RESTRICTED_CONTACT_TOPICS)[number]

const RESTRICTED_TOPIC_PATTERNS: Readonly<Record<RestrictedContactTopic, readonly RegExp[]>> = {
  payment: [
    /\b(?:pay|pays|paid|paying|payment|payments|repay|repayment)\b/i,
    /\b(?:arrears|overdue|outstanding|owe|owing|debt|instal(?:l)?ments?|arrangements?|debit\s+order|eft|invoices?|refunds?|balance)\b/i,
  ],
  dispute: [/\bdisput(?:e|es|ed|ing)\b/i],
  lease_expiry: [/\blease\s+(?:expir\w*|end(?:s|ing)?)\b/i, /\bexpiry\s+of\s+(?:my|your|the|our)\s+lease\b/i, /\b(?:lease|it)\s+runs\s+out\b/i],
  renewal: [/\brenew(?:al|als|ed|ing|s)?\b/i],
  escalation: [/\bescalat(?:e|es|ed|ion|ions)\b/i, /\brent(?:al)?\s+increases?\b/i],
}

/**
 * Topics the agent never discusses with anyone: payments and arrangements, disputes, lease expiry, renewals and
 * escalations belong to a person (and, for tenants, to approved statement and payment messages only).
 */
export function findRestrictedContactTopics(text: string): RestrictedContactTopic[] {
  return RESTRICTED_CONTACT_TOPICS.filter((topic) => RESTRICTED_TOPIC_PATTERNS[topic].some((re) => re.test(text)))
}

const TOPIC_LABELS: Readonly<Record<RestrictedContactTopic, string>> = {
  payment: 'payments',
  dispute: 'disputes',
  lease_expiry: 'lease expiry',
  renewal: 'renewals',
  escalation: 'rent escalations',
}

const CATEGORY_HANDOVER_REASONS: Partial<Readonly<Record<AgentMessageCategory, string>>> = {
  complaint: 'A complaint: a person must respond',
  payment_or_arrangement: 'About a payment or payment arrangement: a person must respond',
  dispute: 'About a dispute: a person must respond',
  lease_question: 'About a lease: a person must respond',
}

/** The permitted action that lets the agent answer each category; categories without one are always handed over. */
const ANSWER_ACTION: Partial<Readonly<Record<AgentMessageCategory, AgentPermittedAction>>> = {
  faq: 'answer_faq',
  business_info: 'share_business_info',
  document_request: 'share_approved_document',
}

// ------------------------------------------------------------------ the policy

/** What the model produced: a decision, a refusal, an error, or no agent runtime at all. */
export type AgentModelResult =
  | { kind: 'decision'; decision: AgentDecision }
  | { kind: 'refusal' }
  | { kind: 'error'; reason: string }
  | { kind: 'unavailable' }

export interface AgentPolicyInput {
  /** `tenant` when the contact is linked to (or has the number of) a tenant of the company. */
  sender: 'tenant' | 'contact'
  config: {
    autoReplyEnabled: boolean
    permittedActions: readonly AgentPermittedAction[]
    operatingHours: readonly AgentOperatingPeriod[]
    timezone: string
    outOfHoursMessage?: string | undefined
  }
  model: AgentModelResult
  /** The inbound message's text. */
  inboundText: string
  /** WhatsApp's 24-hour customer service window is open for this conversation. */
  windowOpen: boolean
  /** WhatsApp shared the contact's number (needed to send). */
  contactHasNumber: boolean
  /** The conversation has an unresolved handover: a person handles it. */
  humanHandling: boolean
  now: Date
}

export interface AgentPolicyResult {
  outcome: 'replied' | 'out_of_hours' | 'handed_over' | 'ignored'
  /** The message to send to the contact (never to a tenant). */
  reply?: { kind: 'answer' | 'out_of_hours'; text: string }
  handoverReason?: string
  /** Internal, for staff only. Never sent. */
  suggestedReply?: string
  /** For `out_of_hours`: not sent again if an out-of-hours message went to the conversation at or after this time. */
  outOfHoursSince?: ISODateTime
}

function modelFailureReason(model: Exclude<AgentModelResult, { kind: 'decision' }>): string {
  switch (model.kind) {
    case 'refusal':
      return 'The AI agent declined to answer this message'
    case 'error':
      return `The AI agent could not answer: ${model.reason}`
    case 'unavailable':
      return 'The AI agent is not available (no Anthropic API key on the worker)'
  }
}

/** The proposed reply, if it is safe to show staff (never anything with bank details). */
function safeSuggestion(decision: AgentDecision): string | undefined {
  const text = decision.replyText?.trim()
  if (!text || containsBankDetails(text)) return undefined
  return text.slice(0, 4000)
}

/** Why the proposed answer cannot be sent as it is, or undefined when it can. */
function answerProblem(decision: AgentDecision, permitted: readonly AgentPermittedAction[]): string | undefined {
  const action = ANSWER_ACTION[decision.category]
  if (!action) return 'The AI agent only answers FAQs, business information and document requests on its own'
  if (!permitted.includes(action)) return `Answering this kind of question (${action.replaceAll('_', ' ')}) is not permitted for the AI agent`
  const text = decision.replyText?.trim() ?? ''
  if (text === '') return 'The AI agent proposed no answer'
  if (text.length > AGENT_REPLY_MAX_LENGTH) return `The proposed answer is longer than ${AGENT_REPLY_MAX_LENGTH} characters`
  if (containsBankDetails(text)) return 'The proposed answer contained bank details, which are never sent on WhatsApp'
  const topics = findRestrictedContactTopics(text)
  if (topics.length > 0) return `The proposed answer mentions ${topics.map((t) => TOPIC_LABELS[t]).join(', ')}: a person must respond`
  return undefined
}

/** Applies the policy to one inbound message. Pure: the runtime records and carries out the result. */
export function applyAgentPolicy(input: AgentPolicyInput): AgentPolicyResult {
  const { model, config } = input
  const handover = (handoverReason: string, suggestedReply?: string): AgentPolicyResult => ({
    outcome: 'handed_over',
    handoverReason,
    ...(suggestedReply ? { suggestedReply } : {}),
  })

  if (input.sender === 'tenant') {
    const suggestion =
      model.kind === 'decision' && config.permittedActions.includes('draft_tenant_reply') ? safeSuggestion(model.decision) : undefined
    return handover('Message from a tenant: tenants are never answered automatically', suggestion)
  }
  if (model.kind !== 'decision') return handover(modelFailureReason(model))

  const { decision } = model
  // A reply with bank details is never kept, not even as an internal suggestion.
  const suggestion = safeSuggestion(decision)
  const inboundTopics = findRestrictedContactTopics(input.inboundText)

  let reason: string | undefined
  if (inboundTopics.length > 0) {
    reason = `The message is about ${inboundTopics.map((t) => TOPIC_LABELS[t]).join(', ')}: a person must respond`
  } else if (CATEGORY_HANDOVER_REASONS[decision.category]) {
    reason = CATEGORY_HANDOVER_REASONS[decision.category]
  } else if (decision.action === 'handover') {
    reason = decision.handoverReason?.trim() || 'The AI agent asked for a person'
  } else if (decision.action === 'ignore') {
    if (decision.confidence >= AGENT_CONFIDENCE_THRESHOLD) return { outcome: 'ignored' }
    reason = 'The AI agent was not confident enough to leave this message unanswered'
  } else if (decision.confidence < AGENT_CONFIDENCE_THRESHOLD) {
    reason = 'The AI agent was not confident enough to answer'
  } else if (!config.autoReplyEnabled) {
    reason = 'Auto-reply is off: a person answers contacts'
  } else if (input.humanHandling) {
    reason = 'A person is handling this conversation'
  } else {
    reason = answerProblem(decision, config.permittedActions)
  }
  const hours = operatingHoursState(config.operatingHours, config.timezone, input.now)
  const maySend = config.autoReplyEnabled && !input.humanHandling && input.windowOpen && input.contactHasNumber
  if (!hours.open) {
    const outOfHoursMessage = config.outOfHoursMessage?.trim()
    const handoverReason = reason ?? 'The message arrived outside operating hours'
    if (maySend && outOfHoursMessage) {
      return {
        outcome: 'out_of_hours',
        reply: { kind: 'out_of_hours', text: outOfHoursMessage },
        handoverReason,
        ...(suggestion ? { suggestedReply: suggestion } : {}),
        outOfHoursSince: outOfHoursDedupeSince(hours, input.now),
      }
    }
    return handover(handoverReason, suggestion)
  }
  if (reason) return handover(reason, suggestion)
  if (!input.windowOpen) return handover("WhatsApp's 24-hour customer service window has closed", suggestion)
  if (!input.contactHasNumber) return handover("WhatsApp has not shared the contact's number", suggestion)
  return { outcome: 'replied', reply: { kind: 'answer', text: (decision.replyText ?? '').trim() } }
}
