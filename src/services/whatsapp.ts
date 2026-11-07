import { useMemo } from 'react'

import {
  addDaysISO,
  addMonthsISO,
  canSendOwnerMessage,
  canSendTenantMessage,
  compareISODate,
  findBankDetails,
  formatSADate,
  formatZAR,
  MONITORED_LEASE_STATUSES,
  type EligibilityResult,
} from '@/domain'
import { useAppStore } from '@/store/appStore'
import { nowISO, todayISO } from '@/store/ids'
import {
  TEMPLATE_APPROVAL_STATUSES,
  type Communication,
  type Company,
  type DeliveryStatus,
  type EntityId,
  type ISODate,
  type MessageType,
  type Property,
  type RecipientType,
  type TemplateApprovalStatus,
  type User,
  type WhatsAppAccountConfig,
  type ZAR,
} from '@/types'

import { arrangementsRepo } from '@/services/arrangements'
import { getActiveCompany } from '@/services/companies'
import {
  approvalsRepo,
  communicationsRepo,
  draftOwnerMessage,
  recordDeliveryStatus,
  sortConversation,
} from '@/services/communications'
import { pseudoSha256 } from '@/services/extraction'
import { pushNotification } from '@/services/notifications'
import { computeArrears, computeLeaseExpiry, computePortfolioOverview } from '@/services/reports'
import { diffScalarFields, recordAudit } from '@/services/repository'
import { getScopedData, indexById, useScopedData, type ScopedData } from '@/services/snapshot'
import { tenantsRepo } from '@/services/tenants'
import { getUserById } from '@/services/users'

/**
 * WhatsApp Business channel — ALL SIMULATED. There is no network access: connection checks,
 * sending and delivery receipts are deterministic state changes for the demo. Only non-secret
 * configuration lives in the frontend; the access token is a server-side reference.
 */

export const MAX_SEND_ATTEMPTS = 3

export class SendRefusedError extends Error {
  readonly reasons: readonly string[]
  constructor(communicationId: EntityId, reasons: readonly string[]) {
    super(`Message ${communicationId} cannot be sent: ${reasons.join('; ')}`)
    this.name = 'SendRefusedError'
    this.reasons = reasons
  }
}

// ---------------------------------------------------------------------------------- channel

export interface WhatsAppChannelOverview {
  companyId: EntityId
  companyName: string
  config: WhatsAppAccountConfig
  requireApprovalForTenantMessages: boolean
  templates: Record<TemplateApprovalStatus, number> & { total: number }
}

function buildChannel(company: Company, data: ScopedData): WhatsAppChannelOverview {
  const counts = Object.fromEntries(TEMPLATE_APPROVAL_STATUSES.map((s) => [s, 0])) as Record<TemplateApprovalStatus, number>
  for (const t of data.templates) counts[t.approvalStatus] += 1
  return {
    companyId: company.id,
    companyName: company.tradingName ?? company.name,
    config: company.whatsapp,
    requireApprovalForTenantMessages: company.settings.requireApprovalForTenantMessages,
    templates: { ...counts, total: data.templates.length },
  }
}

export function getChannel(): WhatsAppChannelOverview {
  return buildChannel(getActiveCompany(), getScopedData())
}

/** Non-secret fields a company admin may edit. The access token reference and status are not editable here. */
export type WhatsAppChannelSettings = Partial<
  Pick<WhatsAppAccountConfig, 'businessAccountId' | 'phoneNumberId' | 'displayName' | 'displayNumber' | 'webhookConfigured'>
>

const EDITABLE_FIELDS: readonly (keyof WhatsAppChannelSettings)[] = [
  'businessAccountId',
  'phoneNumberId',
  'displayName',
  'displayNumber',
  'webhookConfigured',
]
const IDENTITY_FIELDS: readonly (keyof WhatsAppChannelSettings)[] = ['businessAccountId', 'phoneNumberId', 'displayNumber', 'webhookConfigured']

function writeWhatsApp(before: Company, whatsapp: WhatsAppAccountConfig, summary: string): Company {
  const after: Company = { ...before, whatsapp, updatedAt: nowISO() }
  useAppStore.getState().upsert('companies', after)
  recordAudit({ action: 'update', entityType: 'company', entityId: after.id, summary, changes: diffScalarFields(before.whatsapp, whatsapp) })
  return after
}

/**
 * Update non-secret channel settings. Changing an identity field (ids, number, webhook) puts the
 * channel back to `pending_verification` until the next connection check.
 */
export function updateChannelSettings(patch: WhatsAppChannelSettings): WhatsAppAccountConfig {
  const before = getActiveCompany()
  const clean: WhatsAppChannelSettings = {}
  for (const key of EDITABLE_FIELDS) {
    if (patch[key] !== undefined) (clean as Record<string, unknown>)[key] = patch[key]
  }
  const identityChanged = IDENTITY_FIELDS.some((k) => clean[k] !== undefined && clean[k] !== before.whatsapp[k])
  const whatsapp: WhatsAppAccountConfig = {
    ...before.whatsapp,
    ...clean,
    ...(identityChanged ? { connectionStatus: 'pending_verification' as const } : {}),
  }
  return writeWhatsApp(before, whatsapp, 'WhatsApp channel settings updated').whatsapp
}

/** Simulated verification: connected when the account id, phone number id and webhook are all set. */
export function simulateConnectionCheck(): WhatsAppAccountConfig {
  const before = getActiveCompany()
  const w = before.whatsapp
  const ok = Boolean(w.businessAccountId.trim() && w.phoneNumberId.trim() && w.webhookConfigured)
  const whatsapp: WhatsAppAccountConfig = {
    ...w,
    connectionStatus: ok ? 'connected' : 'pending_verification',
    ...(ok ? { lastVerifiedAt: nowISO() } : {}),
  }
  return writeWhatsApp(before, whatsapp, ok ? 'WhatsApp connection verified (simulated)' : 'WhatsApp connection check incomplete (simulated)')
    .whatsapp
}

// ---------------------------------------------------------------------------------- sending

/** Number of send attempts, counted from `send` audit entries for the message. */
export function getSendAttempts(communicationId: EntityId): number {
  return getScopedData().auditLogs.filter(
    (l) => l.action === 'send' && l.entityType === 'communication' && l.entityId === communicationId,
  ).length
}

/** Every rule that must hold to send this message now (empty when sendable). */
export function sendBlockers(communication: Communication, today: ISODate): string[] {
  const reasons: string[] = []
  if (communication.direction !== 'outbound') reasons.push('Only outbound messages can be sent')
  if (communication.status !== 'approved' && communication.status !== 'queued') {
    reasons.push(`Message is ${communication.status.replace(/_/g, ' ')}; only approved messages can be sent`)
  }
  const company = getActiveCompany()
  if (company.whatsapp.connectionStatus !== 'connected') {
    reasons.push(`WhatsApp channel is ${company.whatsapp.connectionStatus.replace(/_/g, ' ')}`)
  }
  if (findBankDetails(communication.body).length > 0) reasons.push('Message contains banking details')
  if (communication.recipientType === 'tenant') {
    const tenant = tenantsRepo.getById(communication.tenantId)
    if (!tenant) {
      reasons.push('Tenant not found in this workspace')
    } else {
      const approval = communication.approvalId ? approvalsRepo.getById(communication.approvalId) : undefined
      const eligibility = canSendTenantMessage(tenant, communication.messageType, {
        settings: company.settings,
        ...(approval ? { approval } : {}),
        arrangements: arrangementsRepo.listAll(),
        today,
      })
      reasons.push(...eligibility.reasons)
    }
  } else {
    const owner = communication.ownerUserId ? getUserById(communication.ownerUserId) : undefined
    if (!owner) reasons.push('Owner not found')
    else reasons.push(...canSendOwnerMessage(owner, communication.messageType, company.id).reasons)
  }
  if (getSendAttempts(communication.id) >= MAX_SEND_ATTEMPTS) reasons.push(`Maximum of ${MAX_SEND_ATTEMPTS} send attempts reached`)
  return reasons
}

/**
 * Simulated send. Refuses (SendRefusedError) unless the message is approved/queued, the approval is
 * approved when the company requires it, and every eligibility rule passes AT SEND TIME. Then
 * advances approved → queued → sent with a simulated `wamid.SIM-…` id.
 */
export function sendApprovedMessage(communicationId: EntityId, today: ISODate = todayISO()): Communication {
  const communication = communicationsRepo.require(communicationId)
  const reasons = sendBlockers(communication, today)
  if (reasons.length > 0) throw new SendRefusedError(communicationId, reasons)
  if (communication.status === 'approved') recordDeliveryStatus(communicationId, 'queued')
  const attempt = getSendAttempts(communicationId) + 1
  const externalMessageId = `wamid.SIM-${pseudoSha256(`${communicationId}:${attempt}`).slice(0, 20).toUpperCase()}`
  return recordDeliveryStatus(communicationId, 'sent', { externalMessageId })
}

export type SimulatedReceipt = Extract<DeliveryStatus, 'delivered' | 'read' | 'failed'>

const RECEIPT_TRANSITIONS: Readonly<Partial<Record<DeliveryStatus, readonly SimulatedReceipt[]>>> = {
  queued: ['failed'],
  sent: ['delivered', 'read', 'failed'],
  delivered: ['read'],
}

/** Simulated webhook receipt using communications.recordDeliveryStatus. */
export function simulateDeliveryProgress(communicationId: EntityId, to: SimulatedReceipt, reason?: string): Communication {
  const communication = communicationsRepo.require(communicationId)
  const allowed = RECEIPT_TRANSITIONS[communication.status] ?? []
  if (!allowed.includes(to)) throw new Error(`Cannot move message from "${communication.status}" to "${to}"`)
  const updated = recordDeliveryStatus(communicationId, to, to === 'failed' ? { failureReason: reason ?? 'Delivery failed (simulated)' } : {})
  if (to === 'failed') {
    pushNotification({
      type: 'message_failed',
      severity: 'warning',
      title: 'WhatsApp message failed',
      body: updated.failureReason ?? 'Delivery failed',
      link: { entityType: 'communication', entityId: communicationId },
    })
  }
  return updated
}

/** failed → queued, at most MAX_SEND_ATTEMPTS sends in total. Send it again with sendApprovedMessage. */
export function retryFailedMessage(communicationId: EntityId): Communication {
  const communication = communicationsRepo.require(communicationId)
  if (communication.status !== 'failed') throw new Error(`Only failed messages can be retried (message is ${communication.status})`)
  const attempts = getSendAttempts(communicationId)
  if (attempts >= MAX_SEND_ATTEMPTS) throw new Error(`Maximum of ${MAX_SEND_ATTEMPTS} send attempts reached`)
  return communicationsRepo.update(
    communicationId,
    { status: 'queued', failureReason: undefined },
    { summary: `Message re-queued for retry (attempt ${attempts + 1} of ${MAX_SEND_ATTEMPTS})` },
  )
}

// ---------------------------------------------------------------------------------- conversations

export interface ConversationSummary {
  /** `tenant:<id>` or `owner:<id>` (or `number:<e164>` when unlinked). */
  key: string
  counterpartType: RecipientType
  tenantId?: EntityId
  ownerUserId?: EntityId
  name: string
  number: string
  lastMessage: Communication
  lastMessageAt: string
  /** Inbound messages received after the latest outbound message (awaiting a response). */
  unreadInbound: number
  status: DeliveryStatus
  messageCount: number
  pendingApproval: number
  optedOut: boolean
}

export function conversationKey(c: Pick<Communication, 'tenantId' | 'ownerUserId' | 'counterpartyNumber'>): string {
  if (c.tenantId) return `tenant:${c.tenantId}`
  if (c.ownerUserId) return `owner:${c.ownerUserId}`
  return `number:${c.counterpartyNumber}`
}

const timestamp = (c: Communication) => c.sentAt ?? c.createdAt

export function buildConversations(data: ScopedData): ConversationSummary[] {
  const groups = new Map<string, Communication[]>()
  for (const c of data.communications) {
    const key = conversationKey(c)
    const list = groups.get(key)
    if (list) list.push(c)
    else groups.set(key, [c])
  }
  const tenants = indexById(data.tenants)
  const users = indexById(data.users)
  const rows: ConversationSummary[] = []
  for (const [key, list] of groups) {
    const thread = sortConversation(list)
    const last = thread[thread.length - 1]
    const lastOutboundAt = thread.filter((c) => c.direction === 'outbound').map(timestamp).pop() ?? ''
    const tenant = last.tenantId ? tenants.get(last.tenantId) : undefined
    const owner = last.ownerUserId ? users.get(last.ownerUserId) : undefined
    rows.push({
      key,
      counterpartType: last.recipientType,
      ...(last.tenantId ? { tenantId: last.tenantId } : {}),
      ...(last.ownerUserId ? { ownerUserId: last.ownerUserId } : {}),
      name: tenant?.tradingName ?? owner?.fullName ?? last.counterpartyNumber,
      number: last.counterpartyNumber,
      lastMessage: last,
      lastMessageAt: timestamp(last),
      unreadInbound: thread.filter((c) => c.direction === 'inbound' && timestamp(c) > lastOutboundAt).length,
      status: last.status,
      messageCount: thread.length,
      pendingApproval: thread.filter((c) => c.status === 'pending_approval').length,
      optedOut: tenant?.whatsappOptedOut ?? false,
    })
  }
  return rows.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
}

export function listConversations(): ConversationSummary[] {
  return buildConversations(getScopedData())
}

export function getConversationThread(key: string): Communication[] {
  return sortConversation(getScopedData().communications.filter((c) => conversationKey(c) === key))
}

// ---------------------------------------------------------------------------------- tenant status

export interface OptOutStatus {
  tenantId: EntityId
  whatsappNumber: string
  whatsappVerified: boolean
  optedOut: boolean
  /** Verified, not opted out, and not vacated/prospective. */
  canReceiveMessages: boolean
}

export function getOptOutStatus(tenantId: EntityId): OptOutStatus {
  const t = tenantsRepo.require(tenantId)
  return {
    tenantId,
    whatsappNumber: t.whatsappNumber,
    whatsappVerified: t.whatsappVerified,
    optedOut: t.whatsappOptedOut,
    canReceiveMessages: t.whatsappVerified && !t.whatsappOptedOut && t.status !== 'vacated' && t.status !== 'prospective',
  }
}

export interface SuppressionStatus {
  suppressed: boolean
  reasons: string[]
}

/**
 * Would a message of this type to this tenant be blocked right now, ignoring the per-message
 * approval step? Uses @/domain canSendTenantMessage (which applies shouldSuppressArrearsReminder).
 */
export function getSuppressionStatus(tenantId: EntityId, messageType: MessageType, today: ISODate = todayISO()): SuppressionStatus {
  const tenant = tenantsRepo.require(tenantId)
  const result: EligibilityResult = canSendTenantMessage(tenant, messageType, {
    settings: { requireApprovalForTenantMessages: false },
    arrangements: arrangementsRepo.listAll(),
    today,
  })
  return { suppressed: !result.eligible, reasons: result.reasons }
}

// ---------------------------------------------------------------------------------- owner summaries

function ownerContext(ownerUserId: EntityId, data: ScopedData): { owner: User; properties: Property[] } {
  const owner = getUserById(ownerUserId)
  if (!owner) throw new Error(`Owner ${ownerUserId} not found`)
  if (!owner.memberships.some((m) => m.companyId === data.companyId && m.role === 'property_owner')) {
    throw new Error(`${owner.fullName} is not a property owner in this workspace`)
  }
  return { owner, properties: data.properties.filter((p) => p.ownerUserId === ownerUserId && p.status !== 'archived') }
}

const firstName = (u: User) => u.fullName.split(' ')[0]
const pct = (rate: number) => `${Math.round(rate * 100)}%`
const dateOf = (ts: string | undefined) => ts?.slice(0, 10)

export interface OwnerWeeklySummary {
  ownerUserId: EntityId
  ownerName: string
  propertyIds: EntityId[]
  periodStart: ISODate
  periodEnd: ISODate
  totals: {
    properties: number
    units: number
    occupiedUnits: number
    occupancyRate: number
    monthlyRentalRoll: ZAR
    totalOutstanding: ZAR
    tenantsInArrears: number
    openEvents: number
    leasesExpiringWithin90Days: number
  }
  changes: {
    newEvents: number
    resolvedEvents: number
    statementsVerified: number
    arrangementsAgreed: number
    messagesSent: number
  }
  highlights: string[]
  body: string
}

/** Weekly owner summary over [today − 6, today], composed only from report figures. */
export function buildOwnerWeeklySummaryFrom(data: ScopedData, ownerUserId: EntityId, today: ISODate): OwnerWeeklySummary {
  const { owner, properties } = ownerContext(ownerUserId, data)
  const propertyIds = properties.map((p) => p.id)
  const periodStart = addDaysISO(today, -6)
  const periodEnd = today
  const inPeriod = (d: string | undefined) => d !== undefined && d >= periodStart && d <= periodEnd
  const ids = new Set(propertyIds)
  const filters = { propertyIds }
  const portfolio = propertyIds.length > 0 ? computePortfolioOverview(data, filters, today) : undefined
  const arrears = propertyIds.length > 0 ? computeArrears(data, filters, today) : undefined
  const expiry = propertyIds.length > 0 ? computeLeaseExpiry(data, filters, today) : undefined
  const expiring90 = expiry ? expiry.rows.filter((r) => r.daysUntilExpiry <= 90).length : 0
  const tenantIds = new Set(data.leases.filter((l) => ids.has(l.propertyId)).map((l) => l.tenantId))

  const events = data.events.filter((e) => ids.has(e.propertyId))
  const changes = {
    newEvents: events.filter((e) => inPeriod(e.identifiedOn)).length,
    resolvedEvents: events.filter((e) => inPeriod(dateOf(e.resolvedAt))).length,
    statementsVerified: data.statements.filter((s) => ids.has(s.propertyId) && inPeriod(dateOf(s.verifiedAt))).length,
    arrangementsAgreed: data.arrangements.filter((a) => ids.has(a.propertyId) && inPeriod(a.agreedOn)).length,
    messagesSent: data.communications.filter(
      (c) => c.direction === 'outbound' && c.tenantId !== undefined && tenantIds.has(c.tenantId) && inPeriod(dateOf(c.sentAt)),
    ).length,
  }
  const totals = {
    properties: properties.length,
    units: portfolio?.unitCount ?? 0,
    occupiedUnits: portfolio?.occupiedUnits ?? 0,
    occupancyRate: portfolio?.occupancyRate ?? 0,
    monthlyRentalRoll: portfolio?.monthlyRentalRoll ?? 0,
    totalOutstanding: arrears?.totalOutstanding ?? 0,
    tenantsInArrears: arrears?.tenantCount ?? 0,
    openEvents: portfolio?.openEvents ?? 0,
    leasesExpiringWithin90Days: expiring90,
  }
  const highlights: string[] = []
  const top = arrears?.rows[0]
  if (top) highlights.push(`Largest outstanding balance: ${top.tenantName} (${top.propertyName}) ${formatZAR(top.outstanding)}`)
  const soonest = expiry?.rows[0]
  if (soonest && soonest.daysUntilExpiry <= 90) {
    highlights.push(`Next lease expiry: ${soonest.tenantName} (${soonest.reference}) on ${formatSADate(soonest.expiryDate)}`)
  }
  if (changes.newEvents > 0) highlights.push(`${changes.newEvents} new monitoring item(s) this week`)
  if (changes.arrangementsAgreed > 0) highlights.push(`${changes.arrangementsAgreed} payment arrangement(s) recorded this week`)

  const body =
    properties.length === 0
      ? `Good morning ${firstName(owner)}, you have no properties linked in this workspace. ${data.company?.tradingName ?? data.company?.name ?? ''}`.trim()
      : [
          `Good morning ${firstName(owner)}, your LeaseGuard summary for ${formatSADate(periodStart)} to ${formatSADate(periodEnd)} (${properties
            .map((p) => p.name)
            .join(', ')}):`,
          `Occupancy: ${totals.occupiedUnits} of ${totals.units} units (${pct(totals.occupancyRate)})`,
          `Monthly rental roll: ${formatZAR(totals.monthlyRentalRoll)}`,
          `Outstanding on verified statements: ${formatZAR(totals.totalOutstanding)} across ${totals.tenantsInArrears} tenant(s)`,
          `Open monitoring items: ${totals.openEvents}`,
          `Leases expiring within 90 days: ${totals.leasesExpiringWithin90Days}`,
          `This week: ${changes.newEvents} new item(s), ${changes.resolvedEvents} resolved, ${changes.statementsVerified} statement(s) verified, ${changes.arrangementsAgreed} arrangement(s) recorded.`,
          `Reply to this message with any question. ${data.company?.tradingName ?? data.company?.name ?? ''}`.trim(),
        ].join('\n')

  return { ownerUserId, ownerName: owner.fullName, propertyIds, periodStart, periodEnd, totals, changes, highlights, body }
}

export function buildOwnerWeeklySummary(ownerUserId: EntityId, today: ISODate = todayISO()): OwnerWeeklySummary {
  return buildOwnerWeeklySummaryFrom(getScopedData(), ownerUserId, today)
}

// ---------------------------------------------------------------------------------- owner questions

export const OWNER_QUESTION_INTENTS = [
  'total_outstanding',
  'overdue_tenants',
  'property_outstanding',
  'leases_expiring',
  'weekly_changes',
] as const
export type OwnerQuestionIntent = (typeof OWNER_QUESTION_INTENTS)[number]

export const SUPPORTED_OWNER_QUESTIONS: readonly string[] = [
  'What is my total outstanding?',
  'Which tenants are overdue?',
  'How much is outstanding at <property name>?',
  'Which leases expire next year? / within N months?',
  'What changed this week?',
]

export interface OwnerAnswer {
  question: string
  intent: OwnerQuestionIntent | 'unsupported'
  answered: boolean
  answer: string
  /** Stored communications, only when `record` was requested. */
  communications?: Communication[]
}

function matchProperty(question: string, properties: readonly Property[]): Property | undefined {
  const q = question.toLowerCase()
  return properties.find(
    (p) => q.includes(p.name.toLowerCase()) || new RegExp(`\\b${p.code.toLowerCase()}\\b`).test(q) || q.includes(p.name.toLowerCase().split(' ').slice(0, 2).join(' ')),
  )
}

export function detectOwnerIntent(question: string, properties: readonly Property[]): { intent: OwnerQuestionIntent | 'unsupported'; property?: Property } {
  const q = question.toLowerCase()
  const money = /(outstanding|owe|owed|owing|arrears|balance)/.test(q)
  const property = matchProperty(question, properties)
  if (money && property) return { intent: 'property_outstanding', property }
  if (/(overdue|in arrears|behind|late pay|haven'?t paid|not paid)/.test(q) && /(tenant|who|which)/.test(q)) return { intent: 'overdue_tenants' }
  if (money) return { intent: 'total_outstanding' }
  if (/expir/.test(q)) return { intent: 'leases_expiring' }
  if (/(chang|this week|what'?s new|happened)/.test(q)) return { intent: 'weekly_changes' }
  return { intent: 'unsupported' }
}

const UNSUPPORTED_ANSWER = `I can't answer that yet. I can answer:\n${SUPPORTED_OWNER_QUESTIONS.map((s) => `- ${s}`).join('\n')}`

export function answerOwnerQuestionFrom(data: ScopedData, question: string, ownerUserId: EntityId, today: ISODate): Omit<OwnerAnswer, 'communications'> {
  const { properties } = ownerContext(ownerUserId, data)
  const { intent, property } = detectOwnerIntent(question, properties)
  if (intent === 'unsupported') return { question, intent, answered: false, answer: UNSUPPORTED_ANSWER }
  if (properties.length === 0) {
    return { question, intent, answered: true, answer: 'You have no properties linked in this workspace.' }
  }
  const propertyIds = properties.map((p) => p.id)

  switch (intent) {
    case 'total_outstanding': {
      const r = computeArrears(data, { propertyIds }, today)
      return {
        question,
        intent,
        answered: true,
        answer: `Total outstanding on verified statements across your properties: ${formatZAR(r.totalOutstanding)} (${r.tenantCount} tenant(s)).`,
      }
    }
    case 'property_outstanding': {
      const p = property as Property
      const r = computeArrears(data, { propertyIds: [p.id] }, today)
      return {
        question,
        intent,
        answered: true,
        answer: `Outstanding at ${p.name} on verified statements: ${formatZAR(r.totalOutstanding)} (${r.tenantCount} tenant(s)).`,
      }
    }
    case 'overdue_tenants': {
      const r = computeArrears(data, { propertyIds }, today)
      if (r.rows.length === 0) return { question, intent, answered: true, answer: 'No tenants are in arrears on their latest verified statements.' }
      const lines = r.rows.map(
        (row) =>
          `- ${row.tenantName} (${row.propertyName}): ${formatZAR(row.outstanding)}, ${row.ageDays} days since statement${row.underArrangement ? ', under a payment arrangement' : ''}`,
      )
      return { question, intent, answered: true, answer: [`${r.rows.length} tenant(s) in arrears:`, ...lines].join('\n') }
    }
    case 'leases_expiring': {
      const q = question.toLowerCase()
      const months = /(?:within|next|in)\s+(\d{1,2})\s+months?/.exec(q)
      const nextYear = /next year/.test(q)
      const year = Number(today.slice(0, 4)) + 1
      const from = nextYear ? `${year}-01-01` : today
      const to = nextYear ? `${year}-12-31` : addMonthsISO(today, months ? Number(months[1]) : 12)
      const label = nextYear ? `in ${year}` : `within ${months ? Number(months[1]) : 12} months`
      const ids = new Set(propertyIds)
      const leases = data.leases
        .filter((l) => ids.has(l.propertyId) && MONITORED_LEASE_STATUSES.includes(l.status) && l.expiryDate >= from && l.expiryDate <= to)
        .sort((a, b) => compareISODate(a.expiryDate, b.expiryDate))
      if (leases.length === 0) return { question, intent, answered: true, answer: `No leases expire ${label}.` }
      const tenants = indexById(data.tenants)
      const props = indexById(properties)
      const lines = leases.map(
        (l) => `- ${tenants.get(l.tenantId)?.tradingName ?? l.tenantId} (${l.reference}, ${props.get(l.propertyId)?.name ?? ''}): ${formatSADate(l.expiryDate)}`,
      )
      return { question, intent, answered: true, answer: [`${leases.length} lease(s) expire ${label}:`, ...lines].join('\n') }
    }
    case 'weekly_changes': {
      const s = buildOwnerWeeklySummaryFrom(data, ownerUserId, today)
      const c = s.changes
      return {
        question,
        intent,
        answered: true,
        answer: `Between ${formatSADate(s.periodStart)} and ${formatSADate(s.periodEnd)}: ${c.newEvents} new monitoring item(s), ${c.resolvedEvents} resolved, ${c.statementsVerified} statement(s) verified, ${c.arrangementsAgreed} payment arrangement(s) recorded and ${c.messagesSent} tenant message(s) sent.`,
      }
    }
  }
}

export interface AnswerOwnerQuestionOptions {
  /** Store the question (inbound) and the answer (outbound `owner_query_response`) as communications. */
  record?: boolean
}

/**
 * Answer a supported owner question from report figures only; unsupported questions get an
 * explicit "I can't answer that yet" with the supported list. Nothing is invented.
 */
export function answerOwnerQuestion(
  question: string,
  ownerUserId: EntityId,
  today: ISODate = todayISO(),
  options: AnswerOwnerQuestionOptions = {},
): OwnerAnswer {
  const result = answerOwnerQuestionFrom(getScopedData(), question, ownerUserId, today)
  if (!options.record) return result
  const owner = getUserById(ownerUserId) as User
  const company = getActiveCompany()
  const at = nowISO()
  const inbound = communicationsRepo.create(
    {
      channel: 'whatsapp',
      direction: 'inbound',
      messageType: 'inbound_reply',
      recipientType: 'property_owner',
      ownerUserId,
      counterpartyNumber: owner.whatsappNumber ?? '',
      companyNumber: company.whatsapp.displayNumber,
      body: question,
      status: 'received',
      sentAt: at,
      deliveredAt: at,
    },
    { summary: `Question received from ${owner.fullName}` },
  )
  const response = draftOwnerMessage('owner_query_response', ownerUserId, result.answer)
  return { ...result, communications: [inbound, response] }
}

// ---------------------------------------------------------------------------------- hooks

export function useWhatsAppChannel(): WhatsAppChannelOverview | undefined {
  const data = useScopedData()
  return useMemo(() => (data.company ? buildChannel(data.company, data) : undefined), [data])
}

export function useConversations(): ConversationSummary[] {
  const data = useScopedData()
  return useMemo(() => buildConversations(data), [data])
}

export function useConversationThread(key: string | undefined): Communication[] {
  const data = useScopedData()
  return useMemo(() => (key ? sortConversation(data.communications.filter((c) => conversationKey(c) === key)) : []), [data, key])
}

export function useOwnerWeeklySummary(ownerUserId: EntityId | undefined, today: ISODate = todayISO()): OwnerWeeklySummary | undefined {
  const data = useScopedData()
  return useMemo(() => {
    if (!ownerUserId) return undefined
    try {
      return buildOwnerWeeklySummaryFrom(data, ownerUserId, today)
    } catch {
      return undefined
    }
  }, [data, ownerUserId, today])
}
